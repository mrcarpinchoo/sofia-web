// The two-hand heart gesture and the radial wave it triggers.

import { mul } from '../core/math';
import { origin, rotation } from '../core/kinematics';
import type { JointAngles, KinematicConfig, PanelModule, Vec3 } from '../core/types';
import type { Landmark } from './gestures';

/**
 * A geometric two-hand gesture, not a class supplied by MediaPipe.
 * Distances use image aspect ratio and palm width, so thresholds are scale independent.
 */
export function isHeart(hands: Landmark[][] | undefined, aspect = 4 / 3): boolean {
  if (hands?.length !== 2 || !Number.isFinite(aspect) || aspect <= 0) return false;
  const needed = [0, 4, 5, 6, 8, 17];
  const missing = (hand: Landmark[]) =>
    needed.some((i) => !hand[i] || !Number.isFinite(hand[i].x) || !Number.isFinite(hand[i].y));
  if (hands.some(missing)) return false;

  const [a, b] = hands;
  const dist = (p: Landmark, q: Landmark) => Math.hypot((p.x - q.x) * aspect, p.y - q.y);
  const widthA = dist(a[5], a[17]);
  const widthB = dist(b[5], b[17]);
  const scale = (widthA + widthB) / 2;
  if (scale < 0.025 || Math.max(widthA, widthB) / Math.min(widthA, widthB) > 2.2) return false;

  const mid = (p: Landmark, q: Landmark) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
  const top = mid(a[8], b[8]);
  const bottom = mid(a[4], b[4]);
  return (
    dist(a[8], b[8]) < 0.65 * scale &&
    dist(a[4], b[4]) < 0.65 * scale &&
    bottom.y - top.y > 0.35 * scale &&
    bottom.y - top.y < 2.8 * scale &&
    Math.abs(top.x - bottom.x) * aspect < 0.8 * scale &&
    dist(a[0], b[0]) > 1.0 * scale &&
    (a[5].x - top.x) * (b[5].x - top.x) < 0 &&
    dist(a[5], b[5]) > 1.1 * scale &&
    a[6].y < top.y + 0.25 * scale &&
    b[6].y < top.y + 0.25 * scale
  );
}

/**
 * A smooth radial pulse: each ring starts later than the one inside it.
 * t is accumulated active time; loss of detection freezes the wave.
 */
export function heartWave(radiusInCells: number, t: number): number {
  const local = t - 0.45 * radiusInCells;
  if (local < 0) return 0;
  const phase = local % 3.6;
  const duration = 1.25;
  if (phase >= duration) return 0;
  return Math.sin((2 * Math.PI * phase) / duration) * Math.sin((Math.PI * phase) / duration) ** 2;
}

/** Each unit gets its own target during the wave. */
export function heartTarget(module: PanelModule, config: KinematicConfig, t: number): Vec3 {
  const [x, y] = module.base;
  const r = Math.hypot(x, y);
  const amplitude = ((32 * Math.PI) / 180) * heartWave(r / config.spacing, t);
  const q: JointAngles = r > 1e-8 ? [(-y / r) * amplitude, (x / r) * amplitude] : [amplitude, 0];
  const direction = mul(module.mount, mul(rotation(q), [0, 0, 1]));
  const o = origin(module, config);
  return [o[0] + 400 * direction[0], o[1] + 400 * direction[1], o[2] + 400 * direction[2]];
}
