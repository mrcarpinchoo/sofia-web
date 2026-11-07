// The six gestures of sofia-tracker (recognised by handRecognizer.ts) and
// the target for the hand's position.

import type { TrackerGesture } from '../core/choreography';
import type { Vec2, Vec3 } from '../core/types';

/** A hand landmark, 0-1 in the image. */
export interface Landmark {
  x: number;
  y: number;
}

/**
 * sofia-tracker's gestures: the GESTURE command ID (PROTOCOL.md §6.4), and
 * the texts shown to the user. How to make each one is in NotesDialog.
 */
export const GESTURES: Record<
  TrackerGesture,
  { id: 1 | 2 | 3 | 4 | 5 | 6; name: string; motion: string }
> = {
  INDEX: {
    id: 1,
    name: 'Índice',
    motion: 'mirar arriba, luego abajo',
  },
  V: {
    id: 2,
    name: 'V',
    motion: 'dibujar un 8 horizontal',
  },
  PALM: {
    id: 3,
    name: 'Palma abierta',
    motion: 'mirar a la derecha, luego a la izquierda',
  },
  SWIPE_LEFT: {
    id: 4,
    name: 'Barrido a la izquierda',
    motion: 'ola hacia la izquierda',
  },
  SWIPE_RIGHT: {
    id: 5,
    name: 'Barrido a la derecha',
    motion: 'ola hacia la derecha',
  },
  GRAB: {
    id: 6,
    name: 'Agarre',
    motion: 'sobresalto y volver al reposo',
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
