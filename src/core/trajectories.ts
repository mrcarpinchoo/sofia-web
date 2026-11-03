import type { Vec3 } from './types';

export type TrajectoryType = 'eight' | 'circle' | 'step';

export function trajectory(t: number, type: TrajectoryType, speed: number, depth: number): Vec3 {
  const a = (t * speed * 2 * Math.PI) / 12;
  switch (type) {
    case 'circle':
      return [170 * Math.cos(a), 170 * Math.sin(a), depth];
    case 'step':
      return [Math.sin(a) >= 0 ? 170 : -170, 0, depth];
    default:
      return [180 * Math.cos(a), 130 * Math.sin(2 * a), depth + 50 * Math.sin(a)];
  }
}
