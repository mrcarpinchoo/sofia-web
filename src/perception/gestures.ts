// Turns MediaPipe landmarks into targets: the body's center, the hand's
// position and the six gestures of sofia-tracker (recognised by
// handRecognizer.ts).

import type { TrackerGesture } from '../core/choreography';
import { clamp } from '../core/math';
import type { Vec2, Vec3 } from '../core/types';

/** Minimal landmark shape shared by the pose and hand models. */
export interface Landmark {
  x: number;
  y: number;
  visibility?: number;
}

export type Framing = 'upper' | 'full';

/**
 * sofia-tracker's gestures: the GESTURE command ID (PROTOCOL.md §6.4), and
 * the texts shown to the user.
 */
export const GESTURES: Record<
  TrackerGesture,
  { id: 1 | 2 | 3 | 4 | 5 | 6; name: string; motion: string; help: string }
> = {
  INDEX: {
    id: 1,
    name: 'Índice',
    motion: 'mirar arriba, luego abajo',
    help: 'Extiende solo el índice y mantén la mano quieta medio segundo.',
  },
  V: {
    id: 2,
    name: 'V',
    motion: 'dibujar un 8 horizontal',
    help: 'Extiende índice y medio, recoge los demás y mantén la mano quieta medio segundo.',
  },
  PALM: {
    id: 3,
    name: 'Palma abierta',
    motion: 'mirar a la derecha, luego a la izquierda',
    help: 'Abre los cinco dedos y mantén la mano quieta medio segundo.',
  },
  SWIPE_LEFT: {
    id: 4,
    name: 'Barrido a la izquierda',
    motion: 'ola hacia la izquierda',
    help: 'Desliza la mano rápido hacia tu izquierda.',
  },
  SWIPE_RIGHT: {
    id: 5,
    name: 'Barrido a la derecha',
    motion: 'ola hacia la derecha',
    help: 'Desliza la mano rápido hacia tu derecha.',
  },
  GRAB: {
    id: 6,
    name: 'Agarre',
    motion: 'sobresalto y volver al reposo',
    help: 'Pasa de la palma abierta al puño en menos de medio segundo.',
  },
};

// The hand target, as the Maestro maps SET_TARGET (sofia-firmware config.h):
// the image edges are ±230 mm from the panel's centre.
const HAND_SPAN_MM = 230;

/**
 * Target for the hand's position: `point` is the smoothed palm centroid,
 * 0-1 in the mirrored image (y down), as sofia-tracker reports it.
 */
export function handTarget(point: Vec2, depth: number): Vec3 {
  return [(2 * point[0] - 1) * HAND_SPAN_MM, (1 - 2 * point[1]) * HAND_SPAN_MM, depth];
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
