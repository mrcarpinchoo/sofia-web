// Turns MediaPipe landmarks into targets: the body's center and the five
// recognized gestures.

import { clamp } from '../core/math';
import type { Vec2, Vec3 } from '../core/types';

export type GestureName = 'Open_Palm' | 'Closed_Fist' | 'Victory' | 'Heart' | 'Pointing_Up';

/** Minimal landmark shape shared by the pose and hand models. */
export interface Landmark {
  x: number;
  y: number;
  visibility?: number;
}

export type Framing = 'upper' | 'full';

export const GESTURES: Record<GestureName, { name: string; motion: string; help: string }> = {
  Open_Palm: {
    name: 'Palma abierta',
    motion: 'Saludo lateral',
    help: 'Abre los cinco dedos y muestra la palma.',
  },
  Closed_Fist: {
    name: 'Puño cerrado',
    motion: 'Mirada al centro',
    help: 'Cierra los dedos formando un puño.',
  },
  Victory: {
    name: 'V de victoria',
    motion: 'Baile en ocho',
    help: 'Extiende índice y medio; recoge los demás.',
  },
  Heart: {
    name: 'Corazón con dos manos',
    motion: 'Ola del centro hacia afuera',
    help: 'Une las puntas de ambos índices arriba y de ambos pulgares abajo, dejando un hueco de corazón.',
  },
  Pointing_Up: {
    name: 'Índice arriba',
    motion: 'Asentimiento vertical',
    help: 'Extiende solo el índice apuntando hacia arriba.',
  },
};

export const isGesture = (name: string | null | undefined): name is GestureName =>
  Object.hasOwn(GESTURES, name ?? '');

/** Minimum classifier confidence for a gesture to count. */
export const MIN_GESTURE_SCORE = 0.65;

/** How long a gesture must be held before it fires, in ms. */
export const GESTURE_HOLD_MS = 450;

export function gestureTarget(name: GestureName, t: number, depth: number): Vec3 {
  const a = (t * 2 * Math.PI) / 4;
  switch (name) {
    case 'Open_Palm':
      return [190 * Math.sin(a), 0, depth];
    case 'Victory':
      return [160 * Math.sin(a), 100 * Math.sin(2 * a), depth];
    case 'Pointing_Up':
      return [0, 140 * Math.sin(a), depth];
    default:
      return [0, 0, depth];
  }
}

const visible = (p: Landmark | undefined): p is Landmark =>
  !!p &&
  Number.isFinite(p.x) &&
  Number.isFinite(p.y) &&
  (p.visibility ?? 1) > 0.5 &&
  p.x > -0.1 &&
  p.x < 1.1 &&
  p.y > -0.1 &&
  p.y < 1.1;

/** Center of the shoulders (or shoulders and hips) in image coordinates. */
export function torsoCenter(landmarks: Landmark[] | undefined, framing: Framing = 'upper'): Vec2 | null {
  if (!landmarks || !visible(landmarks[11]) || !visible(landmarks[12])) return null;
  let indices = [11, 12];
  if (framing === 'full') {
    if (!visible(landmarks[23]) || !visible(landmarks[24])) return null;
    indices = [11, 12, 23, 24];
  }
  return indices.reduce<Vec2>(
    (sum, i) => [sum[0] + landmarks[i].x / indices.length, sum[1] + landmarks[i].y / indices.length],
    [0, 0],
  );
}

interface ImageTargetOptions {
  mirror?: boolean;
  gain?: number;
  depth?: number;
  center?: Vec2;
}

/** Maps a point in the image to a target on the plane at `depth`. */
export function imageTarget(
  point: Vec2,
  { mirror = true, gain = 1, depth = 400, center = [0.5, 0.45] }: ImageTargetOptions = {},
): Vec3 {
  return [
    clamp((point[0] - center[0]) * (mirror ? -1 : 1) * 1100 * gain, -650, 650),
    clamp((center[1] - point[1]) * 800 * gain, -550, 550),
    depth,
  ];
}

/** Fires a gesture once it has been held long enough, and only once. */
export class GestureLatch {
  candidate: GestureName | null = null;
  since = 0;
  active: GestureName | null = null;
  lastSeen = -Infinity;

  reset() {
    this.candidate = null;
    this.since = 0;
    this.active = null;
    this.lastSeen = -Infinity;
  }

  update(name: string | undefined, score: number, now: number): GestureName | null {
    if (!isGesture(name) || score < MIN_GESTURE_SCORE) {
      this.candidate = null;
      return null;
    }
    this.lastSeen = now;
    if (this.candidate !== name) {
      this.candidate = name;
      this.since = now;
    }
    if (now - this.since >= GESTURE_HOLD_MS && this.active !== name) {
      this.active = name;
      return name;
    }
    return null;
  }
}
