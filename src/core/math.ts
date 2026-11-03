import type { Mat3, Vec3 } from './types';

export const RAD = Math.PI / 180;

export const IDENTITY: Mat3 = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

export const clamp = (x: number, min: number, max: number) => Math.max(min, Math.min(max, x));

export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export const norm = (a: Vec3) => Math.hypot(...a);

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

export const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];

export const divide = (a: Vec3, k: number): Vec3 => [a[0] / k, a[1] / k, a[2] / k];

export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

export const mul = (A: Mat3, v: Vec3): Vec3 => [dot(A[0], v), dot(A[1], v), dot(A[2], v)];

export const transpose = (A: Mat3): Mat3 => [
  [A[0][0], A[1][0], A[2][0]],
  [A[0][1], A[1][1], A[2][1]],
  [A[0][2], A[1][2], A[2][2]],
];

/** Wraps an angle to (-pi, pi]. */
export const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
