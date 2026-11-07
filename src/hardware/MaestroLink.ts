// WebSocket link to the SOFIA Maestro (sofia-firmware/docs/PROTOCOL.md).
//
// Stop-and-wait: one command in flight, answered or abandoned before the
// next. Waiting commands go out in priority order: STOP/OFF, then the
// user's commands (ARM, GESTURE), then the newest hand target (a stream:
// stale targets are dropped, never retransmitted), then polling of the
// real angles (10 Hz) and the Maestro's state (4 Hz). The polling also
// keeps this client in control while it holds it (§8.5).

import {
  Command,
  ERROR_NAMES,
  FrameType,
  decode,
  encode,
  parseAngles,
  parsePing,
  parseStatus,
  targetPayload,
} from './protocol';
import type { GestureId, MaestroStatus } from './protocol';

export type LinkState = 'disconnected' | 'connecting' | 'online' | 'unresponsive';

export interface LinkSnapshot {
  state: LinkState;
  firmware: string | null;
  status: MaestroStatus | null;
  /** 95th percentile of command-to-response time, in ms (Infinity if lost). */
  p95: number | null;
  /** Share of commands answered within 500 ms. */
  within500: number | null;
}

export interface LinkEvents {
  onChange: (snapshot: LinkSnapshot) => void;
  /** Commanded joint angles in degrees, or null when no longer known. */
  onAngles: (angles: [number, number][] | null) => void;
  /** A user command was rejected (NACK) or got no response. */
  onRejected: (command: string, reason: string) => void;
}

const TIMEOUT_MS = 200;
const MAX_RETRIES = 3;
const PUMP_MS = 10;
const TARGET_MS = 40; // 25 Hz
const ANGLES_MS = 100;
const STATUS_MS = 250;
const LOST_AFTER = 3; // consecutive commands without a response
const LATENCY_SAMPLES = 500;

interface Outgoing {
  name: string;
  command: Command;
  payload?: Uint8Array;
  /** Retransmit on timeout (streams and polls aren't). */
  retry: boolean;
  /** Report a NACK or a lost command to the user. */
  user: boolean;
}

interface Pending extends Outgoing {
  seq: number;
  bytes: Uint8Array<ArrayBuffer>;
  firstSent: number;
  attempts: number;
  timer: ReturnType<typeof setTimeout>;
}

export class MaestroLink {
  private readonly events: LinkEvents;
  private socket: WebSocket | null = null;
  private pump: ReturnType<typeof setInterval> | null = null;
  private pending: Pending | null = null;
  private urgent: Outgoing[] = [];
  private queue: Outgoing[] = [];
  private target: [number, number] | null = null;
  private lastTargetSent = 0;
  private nextAngles = 0;
  private nextStatus = 0;
  private seq = Math.floor(Math.random() * 0x10000);
  private failures = 0;
  private latencies: number[] = [];
  private snapshot: LinkSnapshot = {
    state: 'disconnected',
    firmware: null,
    status: null,
    p95: null,
    within500: null,
  };

  constructor(events: LinkEvents) {
    this.events = events;
  }

  get state() {
    return this.snapshot.state;
  }

  connect(url: string) {
    this.disconnect();
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch {
      this.events.onRejected('Conectar', `dirección no válida: ${url}`);
      return;
    }
    socket.binaryType = 'arraybuffer';
    this.socket = socket;
    this.update({ state: 'connecting' });

    socket.onopen = () => {
      this.failures = 0;
      this.latencies = [];
      this.update({ state: 'online', p95: null, within500: null });
      this.queue.push({ name: 'PING', command: Command.ping, retry: true, user: false });
      this.pump = setInterval(() => this.next(), PUMP_MS);
    };
    socket.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) this.receive(new Uint8Array(event.data));
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      const wasOpen = this.snapshot.state !== 'connecting';
      this.reset();
      if (!wasOpen) this.events.onRejected('Conectar', `no se pudo abrir ${url}`);
    };
  }

  disconnect() {
    const socket = this.socket;
    this.reset();
    socket?.close();
  }

  dispose() {
    this.disconnect();
  }

  arm() {
    this.queue.push({ name: 'ARMAR', command: Command.arm, retry: true, user: true });
  }

  /** Jumps ahead of everything else waiting. */
  stop() {
    this.target = null;
    this.queue = [];
    this.urgent.push({ name: 'STOP', command: Command.stop, retry: true, user: true });
  }

  off() {
    this.target = null;
    this.queue = [];
    this.urgent.push({ name: 'APAGAR', command: Command.off, retry: true, user: true });
  }

  gesture(id: GestureId, name: string) {
    this.queue.push({
      name: `Gesto ${name}`,
      command: Command.gesture,
      payload: Uint8Array.of(id),
      retry: true,
      user: true,
    });
  }

  /** Camera point, 0-1 (mirrored, y down). Sent at 25 Hz until endTarget(). */
  setTarget(x: number, y: number) {
    this.target = [x, y];
  }

  endTarget() {
    this.target = null;
  }

  private reset() {
    if (this.pump) clearInterval(this.pump);
    if (this.pending) clearTimeout(this.pending.timer);
    if (this.socket) {
      this.socket.onopen = this.socket.onmessage = this.socket.onclose = null;
    }
    this.socket = null;
    this.pump = null;
    this.pending = null;
    this.urgent = [];
    this.queue = [];
    this.target = null;
    this.update({ state: 'disconnected', status: null });
    this.events.onAngles(null);
  }

  private next() {
    if (this.pending || this.socket?.readyState !== WebSocket.OPEN) return;
    const now = performance.now();
    const out = this.urgent.shift() ?? this.queue.shift() ?? this.nextPeriodic(now);
    if (out) this.send(out);
  }

  /**
   * The periodic message (target stream, angle or status poll) that has been
   * due the longest, so none starves when a round trip outlasts its period.
   */
  private nextPeriodic(now: number): Outgoing | null {
    const target = this.target;
    const candidates: { due: number; take: () => Outgoing }[] = [
      {
        due: this.nextAngles,
        take: () => {
          this.nextAngles = now + ANGLES_MS;
          return { name: 'GET_ANGLES', command: Command.getAngles, retry: false, user: false };
        },
      },
      {
        due: this.nextStatus,
        take: () => {
          this.nextStatus = now + STATUS_MS;
          return { name: 'GET_STATUS', command: Command.getStatus, retry: false, user: false };
        },
      },
    ];
    if (target) {
      candidates.push({
        due: this.lastTargetSent + TARGET_MS,
        take: () => {
          this.lastTargetSent = now;
          return {
            name: 'Objetivo',
            command: Command.setTarget,
            payload: targetPayload(...target),
            retry: false,
            user: true,
          };
        },
      });
    }
    const oldest = candidates.reduce((a, b) => (b.due < a.due ? b : a));
    return oldest.due <= now ? oldest.take() : null;
  }

  private send(out: Outgoing) {
    this.seq = (this.seq + 1) & 0xffff;
    const bytes = encode({
      type: FrameType.command,
      seq: this.seq,
      command: out.command,
      payload: out.payload ?? new Uint8Array(0),
    });
    const now = performance.now();
    this.pending = {
      ...out,
      seq: this.seq,
      bytes,
      firstSent: now,
      attempts: 0,
      timer: setTimeout(() => this.timeout(), TIMEOUT_MS),
    };
    this.socket?.send(bytes);
  }

  private timeout() {
    const pending = this.pending;
    if (!pending) return;
    if (pending.retry && pending.attempts < MAX_RETRIES) {
      pending.attempts++;
      pending.timer = setTimeout(() => this.timeout(), TIMEOUT_MS);
      this.socket?.send(pending.bytes);
      return;
    }
    this.pending = null;
    this.record(Infinity);
    this.failures++;
    if (this.failures >= LOST_AFTER) this.update({ state: 'unresponsive' });
    if (pending.user) this.events.onRejected(pending.name, 'sin respuesta del Maestro');
    if (pending.command === Command.setTarget) this.target = null;
  }

  private receive(bytes: Uint8Array) {
    const frame = decode(bytes);
    const pending = this.pending;
    if (
      !frame ||
      !pending ||
      frame.seq !== pending.seq ||
      frame.command !== pending.command ||
      (frame.type !== FrameType.ack && frame.type !== FrameType.nack)
    ) {
      return; // corrupted, or a late answer to an abandoned command
    }
    clearTimeout(pending.timer);
    this.pending = null;
    this.failures = 0;
    this.record(performance.now() - pending.firstSent);
    if (this.snapshot.state === 'unresponsive') this.update({ state: 'online' });

    if (frame.type === FrameType.nack) {
      const code = frame.payload[0];
      if (pending.user) this.events.onRejected(pending.name, ERROR_NAMES[code] ?? `0x${code?.toString(16)}`);
      if (pending.command === Command.setTarget) this.target = null;
    } else if (pending.command === Command.getAngles) {
      const angles = parseAngles(frame.payload);
      if (angles) this.events.onAngles(angles);
    } else if (pending.command === Command.getStatus) {
      const status = parseStatus(frame.payload);
      if (status) this.update({ status, ...this.latency() });
    } else if (pending.command === Command.ping) {
      this.update({ firmware: parsePing(frame.payload)?.firmware ?? null });
    }
    this.next();
  }

  private record(ms: number) {
    this.latencies.push(ms);
    if (this.latencies.length > LATENCY_SAMPLES) this.latencies.shift();
  }

  private latency(): Pick<LinkSnapshot, 'p95' | 'within500'> {
    const n = this.latencies.length;
    if (!n) return { p95: null, within500: null };
    const sorted = [...this.latencies].sort((a, b) => a - b);
    return {
      p95: sorted[Math.min(n - 1, Math.ceil(0.95 * n) - 1)],
      within500: this.latencies.filter((ms) => ms <= 500).length / n,
    };
  }

  private update(change: Partial<LinkSnapshot>) {
    this.snapshot = { ...this.snapshot, ...change };
    this.events.onChange(this.snapshot);
  }
}
