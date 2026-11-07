// WebSocket link to the SOFIA Maestro (sofia-firmware/docs/PROTOCOL.md).
//
// Stop-and-wait: one command in flight, answered or abandoned before the
// next. Waiting commands go out in priority order: STOP/OFF, then the
// user's commands (ARM, GESTURE), then the newest hand target (a stream:
// stale targets are dropped, never retransmitted), then polling of the
// real angles (10 Hz) and the Maestro's state (4 Hz). The polling also
// keeps this client in control while it holds it (§8.5).
//
// Recovery, the same rules as sofia-tracker's MaestroClient:
// - 3 commands in a row without a response: the link is 'unresponsive'.
//   After 5 s like that the socket is dropped, since a rebooted ESP32
//   won't answer on the old connection.
// - A socket that closes after it had opened is reopened every 2 s
//   ('reconnecting') until Disconnect. A first connection that fails is
//   reported instead: usually a wrong address or network.
// - When the link comes back, ARM is sent at once if the user had armed:
//   the Maestro releases a browser's control as soon as its socket closes.
//   Not after an outage longer than 30 s, and not once the user sent
//   STOP/OFF or control was taken away while the link was up (another
//   client's STOP): STOP keeps its top priority.
// - STOP/OFF without a response are sent again until acknowledged, also
//   over a new socket.
// - A gesture is only worth playing right away: one waiting is replaced by
//   a newer one, and gestures are dropped while the link is unresponsive.

import type { LabEvent, EventLevel } from '../diagnostics/eventLog';
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

export type LinkState = 'disconnected' | 'connecting' | 'online' | 'unresponsive' | 'reconnecting';

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
  /** Command results, errors and recoveries, for the event log and toasts. */
  onEvent: (event: LabEvent) => void;
}

const TIMEOUT_MS = 200;
const MAX_RETRIES = 3;
const PUMP_MS = 10;
const TARGET_MS = 40; // 25 Hz
const ANGLES_MS = 100;
const STATUS_MS = 250;
const LOST_AFTER = 3; // consecutive commands without a response
const LATENCY_SAMPLES = 500;
const RECONNECT_MS = 2000;
const STALE_SOCKET_MS = 5000; // unresponsive this long: open a new socket
const RESUME_WITHIN_MS = 30000; // take control back only after shorter outages

/** Why the Maestro rejected a command, as the user should read it. */
const REJECTIONS: Record<string, string> = {
  NOT_CONTROLLER: 'otro cliente tiene el control. Pulsa ARMAR cuando quede libre.',
  BUSY: 'hay un gesto en curso.',
  INTERNAL: 'las placas PWM no responden. Revisa el cableado y la alimentación.',
  BAD_PAYLOAD: 'valor fuera de rango.',
};

interface Outgoing {
  name: string;
  command: Command;
  payload?: Uint8Array;
  /** Retransmit on timeout (streams and polls aren't). */
  retry: boolean;
  /** Report the result to the user. */
  user: boolean;
  /** Sent by the recovery logic, not the user. */
  automatic?: boolean;
}

interface Pending extends Outgoing {
  seq: number;
  bytes: Uint8Array<ArrayBuffer>;
  firstSent: number;
  attempts: number;
  timer: ReturnType<typeof setTimeout>;
}

const isStop = (command: Command) => command === Command.stop || command === Command.off;

export class MaestroLink {
  private readonly events: LinkEvents;
  private url: string | null = null;
  private socket: WebSocket | null = null;
  private pump: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pending: Pending | null = null;
  private urgent: Outgoing[] = [];
  private queue: Outgoing[] = [];
  private target: [number, number] | null = null;
  private lastTargetSent = 0;
  private nextAngles = 0;
  private nextStatus = 0;
  private seq = Math.floor(Math.random() * 0x10000);
  private failures = 0;
  private firstFailureAt = 0;
  private latencies: number[] = [];
  /** When the link was lost (unresponsive or socket closed), or null. */
  private lostSince: number | null = null;
  /** When the current socket stopped answering, or null. */
  private silentSince: number | null = null;
  /** The user armed and hasn't sent STOP/OFF since. */
  private wantsControl = false;
  /** A STOP/OFF is being resent until the Maestro answers. */
  private unconfirmedStop = false;
  private lastInternalError = '';
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
    this.url = url;
    this.latencies = [];
    this.update({ state: 'connecting', p95: null, within500: null });
    this.open();
  }

  /** Closes the link and stops reconnecting. The Maestro holds the pose. */
  disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.closeSocket();
    this.url = null;
    this.urgent = [];
    this.wantsControl = false;
    this.lostSince = null;
    this.unconfirmedStop = false;
    this.update({ state: 'disconnected', status: null });
  }

  dispose() {
    this.disconnect();
  }

  arm() {
    this.wantsControl = true;
    this.queue.push({ name: 'ARMAR', command: Command.arm, retry: true, user: true });
  }

  /** Jumps ahead of everything else waiting. */
  stop() {
    this.pushStop({ name: 'STOP', command: Command.stop, retry: true, user: true });
  }

  off() {
    this.pushStop({ name: 'APAGAR', command: Command.off, retry: true, user: true });
  }

  gesture(id: GestureId, name: string) {
    const out: Outgoing = {
      name: `Gesto ${name}`,
      command: Command.gesture,
      payload: Uint8Array.of(id),
      retry: true,
      user: true,
    };
    const stale = this.queue.filter((o) => o.command === Command.gesture);
    this.queue = this.queue.filter((o) => o.command !== Command.gesture);
    this.queue.push(out);
    for (const o of stale) {
      this.emit('INFO', 'GESTO_DESCARTADO', `${o.name} no se había enviado aún`, `se envía ${out.name} en su lugar`);
    }
  }

  /** Camera point, 0-1 (mirrored, y down). Sent at 25 Hz until endTarget(). */
  setTarget(x: number, y: number) {
    this.target = [x, y];
  }

  endTarget() {
    this.target = null;
  }

  // Socket -------------------------------------------------------------------

  private open() {
    const url = this.url;
    if (!url) return;
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch {
      this.emit('ERROR', 'CONEXION_FALLIDA', `dirección no válida: ${url}`, 'corrige la dirección y pulsa Conectar');
      this.disconnect();
      return;
    }
    socket.binaryType = 'arraybuffer';
    this.socket = socket;
    let opened = false;

    socket.onopen = () => {
      opened = true;
      this.failures = 0;
      this.update({ state: 'online' });
      this.queue.push({ name: 'PING', command: Command.ping, retry: true, user: false });
      this.pump = setInterval(() => this.next(), PUMP_MS);
      // The link counts as back on the first reply (see receive)
    };
    socket.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) this.receive(new Uint8Array(event.data));
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      if (!opened && this.snapshot.state === 'connecting') {
        // The first connection: most likely a wrong address or network
        this.emit(
          'ERROR',
          'CONEXION_FALLIDA',
          `no se pudo abrir ${url}`,
          'revisa la red SOFIA-Maestro y la dirección, y pulsa Conectar',
        );
        this.disconnect();
        return;
      }
      this.lose(opened ? 'se cerró la conexión WebSocket' : null);
    };
  }

  /** Drops the socket and tries again every RECONNECT_MS. */
  private lose(reason: string | null) {
    this.closeSocket();
    // Before the event, so its context shows the lost link
    this.update({ state: 'reconnecting', status: null });
    if (reason !== null) {
      if (this.lostSince === null) {
        this.lostSince = performance.now();
        this.emit('ERROR', 'ENLACE_PERDIDO', reason, `se reintenta conectar cada ${RECONNECT_MS / 1000} s`);
      } else {
        this.emit('INFO', 'CONEXION_CERRADA', reason, `se reintenta conectar cada ${RECONNECT_MS / 1000} s`);
      }
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, RECONNECT_MS);
  }

  /** Closes the socket. Keeps a STOP/OFF waiting, for the next socket. */
  private closeSocket() {
    if (this.pump) clearInterval(this.pump);
    this.pump = null;
    const pending = this.pending;
    if (pending) {
      clearTimeout(pending.timer);
      if (isStop(pending.command)) this.urgent.unshift(pending);
    }
    this.pending = null;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = socket.onmessage = socket.onclose = null;
      if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) {
        socket.close();
      }
    }
    this.queue = [];
    this.target = null;
    this.failures = 0;
    this.silentSince = null;
    this.events.onAngles(null);
  }

  /** The link answers again after being lost: take control back if wanted. */
  private restored() {
    if (this.lostSince === null) return;
    const outage = performance.now() - this.lostSince;
    this.lostSince = null;
    const resume = this.wantsControl && outage <= RESUME_WITHIN_MS;
    const giveUp = this.wantsControl && !resume;
    if (resume) {
      // Ahead of anything waiting (STOP/OFF are in `urgent`, they still go first)
      this.queue.unshift({ name: 'ARMAR', command: Command.arm, retry: true, user: true, automatic: true });
    }
    if (giveUp) this.wantsControl = false;
    this.emit(
      'INFO',
      'ENLACE_RESTABLECIDO',
      `tras ${(outage / 1000).toFixed(1)} s sin respuesta`,
      resume ? 'se envía ARMAR para conservar o retomar el control' : '',
    );
    if (giveUp) {
      this.emit(
        'AVISO',
        'CONTROL_NO_RETOMADO',
        `el enlace estuvo caído ${Math.round(outage / 1000)} s (más de ${RESUME_WITHIN_MS / 1000} s)`,
        'por seguridad no se rearma solo; pulsa ARMAR',
      );
    }
  }

  // Sending ------------------------------------------------------------------

  private pushStop(out: Outgoing) {
    this.wantsControl = false;
    this.target = null;
    this.queue = [];
    // One STOP/OFF waiting is enough
    if (this.pending?.command === out.command || this.urgent.some((o) => o.command === out.command)) return;
    this.urgent.push(out);
  }

  private next() {
    if (this.pending || this.socket?.readyState !== WebSocket.OPEN) return;
    const now = performance.now();
    if (this.silentSince !== null && now - this.silentSince > STALE_SOCKET_MS) {
      this.lose('sin respuesta durante 5 s: se abre una conexión nueva');
      return;
    }
    let out = this.urgent.shift() ?? this.queue.shift() ?? this.nextPeriodic(now);
    while (out?.command === Command.gesture && this.snapshot.state === 'unresponsive') {
      this.emit('AVISO', 'GESTO_DESCARTADO', `${out.name}: enlace sin respuesta`, 'no se envía para no reproducirlo tarde');
      out = this.queue.shift() ?? this.nextPeriodic(now);
    }
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
          // A stream: a NACK (no control yet) is expected, not reported
          return {
            name: 'Objetivo',
            command: Command.setTarget,
            payload: targetPayload(...target),
            retry: false,
            user: false,
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
    this.transmit(bytes);
  }

  private transmit(bytes: Uint8Array<ArrayBuffer>) {
    try {
      this.socket?.send(bytes);
    } catch {
      // Socket closing: the timeout handles it, onclose reconnects
    }
  }

  private timeout() {
    const pending = this.pending;
    if (!pending) return;
    if (pending.retry && pending.attempts < MAX_RETRIES) {
      pending.attempts++;
      pending.timer = setTimeout(() => this.timeout(), TIMEOUT_MS);
      this.transmit(pending.bytes);
      return;
    }
    this.pending = null;
    this.record(Infinity);
    if (this.failures === 0) this.firstFailureAt = performance.now();
    this.failures++;

    if (isStop(pending.command)) {
      // Goes out again before anything else
      this.urgent.unshift(pending);
      if (!this.unconfirmedStop) {
        this.unconfirmedStop = true;
        this.emit(
          'ERROR',
          `${pending.command === Command.stop ? 'STOP' : 'OFF'}_SIN_RESPUESTA`,
          `${pending.name} sin respuesta tras ${MAX_RETRIES} reenvíos`,
          `se reenvía ${pending.name} hasta que el Maestro responda`,
        );
      }
    } else if (pending.user) {
      this.emit(
        'AVISO',
        'COMANDO_SIN_RESPUESTA',
        `${pending.name} sin respuesta tras ${MAX_RETRIES} reenvíos`,
        this.lostSince === null ? 'el comando se descarta' : 'el comando se descarta (enlace perdido)',
      );
    }
    if (pending.command === Command.setTarget) this.target = null;

    if (this.failures === LOST_AFTER) {
      this.silentSince = this.firstFailureAt;
      this.update({ state: 'unresponsive', ...this.latency() });
      if (this.lostSince !== null) return; // still the same outage (a new socket)
      this.lostSince = this.firstFailureAt;
      this.emit(
        'ERROR',
        'ENLACE_PERDIDO',
        `${LOST_AFTER} comandos seguidos sin respuesta`,
        `se sigue consultando el estado; a los ${STALE_SOCKET_MS / 1000} s se abre una conexión nueva`,
      );
    }
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
    this.silentSince = null;
    this.record(performance.now() - pending.firstSent);
    if (this.snapshot.state === 'unresponsive') this.update({ state: 'online' });
    this.restored();

    if (isStop(pending.command) && this.unconfirmedStop) {
      this.unconfirmedStop = false;
      this.emit('INFO', `${pending.command === Command.stop ? 'STOP' : 'OFF'}_CONFIRMADO`, 'el Maestro respondió al reenvío', '');
    }

    try {
      if (frame.type === FrameType.nack) this.nack(pending, frame.payload[0]);
      else this.ack(pending, frame.payload);
      this.lastInternalError = '';
    } catch (error) {
      // Never let one bad reply stop the link; report each new error once
      const detail = `${pending.name}: ${(error as Error).message}`;
      if (detail !== this.lastInternalError) {
        this.lastInternalError = detail;
        this.emit('ERROR', 'ERROR_INTERNO', detail, 'se descarta esa respuesta y el enlace continúa');
      }
    }
    this.next();
  }

  private ack(pending: Pending, payload: Uint8Array) {
    if (pending.command === Command.getAngles) {
      const angles = parseAngles(payload);
      if (!angles) throw new Error('respuesta de GET_ANGLES con tamaño incorrecto');
      this.events.onAngles(angles);
    } else if (pending.command === Command.getStatus) {
      const status = parseStatus(payload);
      if (!status) throw new Error('respuesta de GET_STATUS con tamaño incorrecto');
      this.checkControl(status);
      this.update({ status, ...this.latency() });
    } else if (pending.command === Command.ping) {
      this.update({ firmware: parsePing(payload)?.firmware ?? null });
    } else if (pending.automatic) {
      this.emit('INFO', 'CONTROL_RETOMADO', 'ARMAR aceptado tras restablecerse el enlace', 'los gestos y la mano vuelven a mover el panal');
    } else if (pending.user) {
      const retries = pending.attempts ? `, ${pending.attempts} reenvíos` : '';
      const ms = Math.round(performance.now() - pending.firstSent);
      this.emit('INFO', 'COMANDO_ACEPTADO', `${pending.name} (${ms} ms${retries})`, '');
    }
  }

  private nack(pending: Pending, code: number | undefined) {
    const reason = (code !== undefined && ERROR_NAMES[code]) || `0x${code?.toString(16) ?? '??'}`;
    if (pending.command === Command.setTarget) this.target = null;
    if (pending.command === Command.arm) this.wantsControl = false;
    if (!pending.user) return;
    if (pending.automatic) {
      this.emit('AVISO', 'CONTROL_NO_RETOMADO', `ARMAR rechazado: ${reason}`, 'otro cliente controla SOFIA; pulsa ARMAR cuando lo libere');
    } else {
      this.emit('AVISO', 'COMANDO_RECHAZADO', `${pending.name}: ${reason}`, REJECTIONS[reason] ?? 'el comando se descarta');
    }
  }

  /**
   * The user armed, no ARM is waiting (a NACK clears wantsControl) and the
   * link stayed up, yet this browser isn't in control: someone's STOP took
   * it away. Don't fight it.
   */
  private checkControl(status: MaestroStatus) {
    if (!this.wantsControl || status.isController) return;
    if (this.queue.some((o) => o.command === Command.arm)) return;
    this.wantsControl = false;
    this.emit(
      'AVISO',
      'CONTROL_LIBERADO',
      'otro cliente detuvo SOFIA o tomó el control',
      'no se rearma solo (STOP tiene prioridad); pulsa ARMAR',
    );
  }

  private emit(level: EventLevel, name: string, detail: string, action: string) {
    this.events.onEvent({ level, source: 'maestro', name, detail, action });
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
