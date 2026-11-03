// Shared types of the kinematic model. Lengths in mm, angles in rad, time in s.

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type Mat3 = [Vec3, Vec3, Vec3];

/** Joint angles [q1, q2]. */
export type JointAngles = [number, number];

/** [min, max] of q1 and q2. */
export type JointLimits = [Vec2, Vec2];

/** What to do when a target has no solution inside the joint limits. */
export type LimitPolicy = 'clamp' | 'hold';

export interface KinematicConfig {
  z12: number;
  z23: number;
  spacing: number;
  limits: JointLimits;
  policy: LimitPolicy;
}

/** One unit's fixed mounting: its base position and orientation. */
export interface PanelModule {
  base: Vec3;
  mount: Mat3;
}

export interface Pose {
  origin: Vec3;
  center: Vec3;
  direction: Vec3;
  rotation: Mat3;
}

export interface InverseResult {
  raw: JointAngles;
  q: JointAngles;
  singular: boolean;
  unreachable: boolean;
  undefinedDirection: boolean;
}
