// SOFIA, Modelado cinemático, pp. 9–12. mm / rad / s.

import { IDENTITY, add, clamp, divide, dot, mul, norm, scale, sub, transpose, wrap } from './math';
import type {
  InverseResult,
  JointAngles,
  KinematicConfig,
  Mat3,
  PanelModule,
  Pose,
  Vec2,
  Vec3,
} from './types';

/** Units per row of the honeycomb. */
const ROWS = [3, 4, 5, 4];

/** Base spacing given for the real panel, in mm. */
export const DEFAULT_SPACING = 150;

/** Center to tip of the hexagonal plate, in mm (module.step, drawing Sofia003-E001-04_2). */
export const PLATE_RADIUS = 60;

// Plate faces along its axis, relative to o3. 5 mm thick, as in module.step.
export const PLATE_BOTTOM = -0.7;
export const PLATE_TOP = 4.3;

/** Corners of a plate outline, with its tips along the y axis. */
export function plateCorners(radius = PLATE_RADIUS): Vec2[] {
  return [0, 1, 2, 3, 4, 5].map((i) => {
    const a = (i * Math.PI) / 3 + Math.PI / 6;
    return [radius * Math.cos(a), radius * Math.sin(a)];
  });
}

export function rotation([a, b]: JointAngles): Mat3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const d = Math.cos(b);
  const t = Math.sin(b);
  return [
    [d, 0, t],
    [s * t, c, -s * d],
    [-c * t, s, c * d],
  ];
}

/** Base positions of the 16 units, centered on the origin. */
export function layout(pitch = DEFAULT_SPACING): PanelModule[] {
  const modules: PanelModule[] = [];
  ROWS.forEach((count, row) => {
    for (let k = 0; k < count; k++) {
      modules.push({
        base: [(k - (count - 1) / 2) * pitch, ((1.5 - row) * pitch * Math.sqrt(3)) / 2, 0],
        mount: IDENTITY,
      });
    }
  });
  const centerY = modules.reduce((sum, m) => sum + m.base[1], 0) / modules.length;
  modules.forEach((m) => {
    m.base[1] -= centerY;
  });
  return modules;
}

export function origin(module: PanelModule, config: KinematicConfig): Vec3 {
  return add(module.base, mul(module.mount, [0, 0, config.z12]));
}

export function forward(module: PanelModule, config: KinematicConfig, q: JointAngles): Pose {
  const r = rotation(q);
  const o = origin(module, config);
  const direction = mul(module.mount, mul(r, [0, 0, 1]));
  return { origin: o, center: add(o, scale(direction, config.z23)), direction, rotation: r };
}

export function inverse(
  module: PanelModule,
  config: KinematicConfig,
  target: Vec3,
  previous: JointAngles = [0, 0],
): InverseResult {
  const d = sub(target, origin(module, config));
  const n = norm(d);
  if (n < 1e-8) {
    return {
      raw: [...previous],
      q: [...previous],
      singular: true,
      unreachable: true,
      undefinedDirection: true,
    };
  }
  const u = mul(transpose(module.mount), divide(d, n));
  const singular = Math.hypot(u[1], u[2]) < 1e-8;
  const b = Math.asin(clamp(u[0], -1, 1));
  const a = singular ? previous[0] : Math.atan2(-u[1], u[2]);
  const candidates: JointAngles[] = [
    [a, b],
    [wrap(a + Math.PI), wrap(Math.PI - b)],
  ];
  const withinLimits = (q: JointAngles) =>
    q.every((x, j) => x >= config.limits[j][0] - 1e-10 && x <= config.limits[j][1] + 1e-10);
  const valid = candidates.filter(withinLimits);
  // Distance in the actual bounded servo interval, not a fictitious wrap-around.
  const distance = (q: JointAngles) => (q[0] - previous[0]) ** 2 + (q[1] - previous[1]) ** 2;
  valid.sort((x, y) => distance(x) - distance(y));
  const raw = valid[0] ?? candidates[0];
  const q: JointAngles = valid.length
    ? raw
    : config.policy === 'hold'
      ? [...previous]
      : [clamp(raw[0], ...config.limits[0]), clamp(raw[1], ...config.limits[1])];
  return { raw: [...raw], q: [...q], singular, unreachable: !valid.length, undefinedDirection: false };
}

/** Angle in degrees between a pose's axis and its target, or null if undefined. */
export function angularError(pose: Pose, target: Vec3): number | null {
  const d = sub(target, pose.origin);
  const n = norm(d);
  return n < 1e-8 ? null : (Math.acos(clamp(dot(pose.direction, d) / n, -1, 1)) * 180) / Math.PI;
}

/**
 * Smallest base spacing that keeps plates from crossing at any angle.
 * Conservative bound for the plate around its fixed pivot, plus a 10 mm margin
 * between envelopes. It says nothing about hardware clearance.
 */
export function safeSpacing(z23: number) {
  return Math.ceil(2 * Math.hypot(z23 + PLATE_TOP, PLATE_RADIUS) + 10);
}
