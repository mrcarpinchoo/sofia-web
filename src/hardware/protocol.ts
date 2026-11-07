// SOFIA client <-> Maestro protocol, version 1. The specification is
// sofia-firmware/docs/PROTOCOL.md; this mirrors sofia-firmware/src/protocol.h
// and sofia-tracker/comms/protocol.py. Frame layout (little-endian):
//
//   SOF | VER | TYPE | SEQ (2) | CMD | LEN | PAYLOAD (LEN) | CRC16 (2)
//
// The CRC is CRC-16/CCITT-FALSE over VER .. end of PAYLOAD.

export const START_OF_FRAME = 0xa5;
export const VERSION = 0x01;
export const MAX_PAYLOAD = 64;
const HEADER_SIZE = 7;
const MIN_FRAME_SIZE = HEADER_SIZE + 2;

export const FrameType = { command: 0x01, ack: 0x02, nack: 0x03 } as const;
export type FrameType = (typeof FrameType)[keyof typeof FrameType];

export const Command = {
  ping: 0x01,
  getStatus: 0x02,
  getAngles: 0x03,
  gesture: 0x10,
  setTarget: 0x11,
  arm: 0x12,
  stop: 0x13,
  off: 0x14,
  setAngles: 0x15,
} as const;
export type Command = (typeof Command)[keyof typeof Command];

export const ERROR_NAMES: Record<number, string> = {
  0x01: 'UNKNOWN_CMD',
  0x02: 'BAD_LENGTH',
  0x03: 'BAD_PAYLOAD',
  0x04: 'UNSUPPORTED_VERSION',
  0x05: 'BUSY',
  0x06: 'INTERNAL',
  0x07: 'NOT_CONTROLLER',
};

/** GESTURE IDs, named as sofia-tracker's gestures.py reports them. */
export const GESTURES = [
  { id: 1, name: 'INDEX' },
  { id: 2, name: 'V' },
  { id: 3, name: 'PALM' },
  { id: 4, name: 'SWIPE_LEFT' },
  { id: 5, name: 'SWIPE_RIGHT' },
  { id: 6, name: 'GRAB' },
] as const;
export type GestureId = (typeof GESTURES)[number]['id'];

export const MODES = ['OFF', 'HOLD', 'TARGET', 'GESTURE', 'MANUAL'] as const;
export type MaestroMode = (typeof MODES)[number];

export const TRANSPORTS = ['none', 'udp', 'websocket'] as const;

export const MODULES = 16;
export const LIMIT_DEG = 30;

export interface Frame {
  type: number;
  seq: number;
  command: number;
  payload: Uint8Array;
  version?: number;
}

export function crc16(data: Uint8Array): number {
  let crc = 0xffff;
  for (const byte of data) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

export function encode(frame: Frame): Uint8Array<ArrayBuffer> {
  const length = frame.payload.length;
  if (length > MAX_PAYLOAD) throw new RangeError(`payload longer than ${MAX_PAYLOAD} bytes`);
  const bytes = new Uint8Array(MIN_FRAME_SIZE + length);
  const view = new DataView(bytes.buffer);
  bytes[0] = START_OF_FRAME;
  bytes[1] = frame.version ?? VERSION;
  bytes[2] = frame.type;
  view.setUint16(3, frame.seq, true);
  bytes[5] = frame.command;
  bytes[6] = length;
  bytes.set(frame.payload, HEADER_SIZE);
  view.setUint16(HEADER_SIZE + length, crc16(bytes.subarray(1, HEADER_SIZE + length)), true);
  return bytes;
}

/** Returns null for anything that isn't a valid frame (it must be ignored). */
export function decode(bytes: Uint8Array): Frame | null {
  if (bytes.length < MIN_FRAME_SIZE || bytes[0] !== START_OF_FRAME) return null;
  const length = bytes[6];
  if (length > MAX_PAYLOAD || bytes.length !== MIN_FRAME_SIZE + length) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(HEADER_SIZE + length, true) !== crc16(bytes.subarray(1, HEADER_SIZE + length))) {
    return null;
  }
  return {
    version: bytes[1],
    type: bytes[2],
    seq: view.getUint16(3, true),
    command: bytes[5],
    payload: bytes.slice(HEADER_SIZE, HEADER_SIZE + length),
  };
}

// Payloads -------------------------------------------------------------------

export function targetPayload(x: number, y: number): Uint8Array {
  const scaled = (v: number) => Math.round(Math.min(Math.max(v, 0), 1) * 10000);
  const bytes = new Uint8Array(4);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, scaled(x), true);
  view.setUint16(2, scaled(y), true);
  return bytes;
}

/** 16 (q1, q2) pairs in degrees, as int16 hundredths of a degree. */
export function anglesPayload(angles: readonly (readonly [number, number])[]): Uint8Array {
  const bytes = new Uint8Array(4 * MODULES);
  const view = new DataView(bytes.buffer);
  angles.forEach(([q1, q2], i) => {
    view.setInt16(4 * i, Math.round(q1 * 100), true);
    view.setInt16(4 * i + 2, Math.round(q2 * 100), true);
  });
  return bytes;
}

export function parseAngles(payload: Uint8Array): [number, number][] | null {
  if (payload.length !== 4 * MODULES) return null;
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  return Array.from({ length: MODULES }, (_, i): [number, number] => [
    view.getInt16(4 * i, true) / 100,
    view.getInt16(4 * i + 2, true) / 100,
  ]);
}

export interface PingInfo {
  firmware: string;
  uptimeMs: number;
}

export function parsePing(payload: Uint8Array): PingInfo | null {
  if (payload.length !== 7) return null;
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  return { firmware: `${payload[0]}.${payload[1]}.${payload[2]}`, uptimeMs: view.getUint32(3, true) };
}

export interface MaestroStatus {
  healthy: boolean;
  armed: boolean;
  simulated: boolean;
  mode: MaestroMode;
  gesture: string | null;
  controller: (typeof TRANSPORTS)[number];
  isController: boolean;
  limitDeg: number;
  powered: number;
  watchdogHolds: number;
  nacks: number;
  discarded: number;
}

export function parseStatus(payload: Uint8Array): MaestroStatus | null {
  if (payload.length !== 13) return null;
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const flags = payload[0];
  return {
    healthy: (flags & 1) !== 0,
    armed: (flags & 2) !== 0,
    simulated: (flags & 4) !== 0,
    mode: MODES[payload[1]] ?? 'OFF',
    gesture: GESTURES.find((g) => g.id === payload[2])?.name ?? null,
    controller: TRANSPORTS[payload[3]] ?? 'none',
    isController: payload[4] === 1,
    limitDeg: payload[5],
    powered: payload[6],
    watchdogHolds: view.getUint16(7, true),
    nacks: view.getUint16(9, true),
    discarded: view.getUint16(11, true),
  };
}
