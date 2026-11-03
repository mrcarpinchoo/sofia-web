// Finds overlapping top plates with the separating axis test. Only the plates
// are checked: shafts, servos and cables aren't modeled.

import {
  PLATE_BOTTOM,
  PLATE_RADIUS,
  PLATE_TOP,
  origin,
  plateCorners,
  rotation,
} from './kinematics';
import { add, cross, dot, mul, norm, sub } from './math';
import type { JointAngles, KinematicConfig, PanelModule, Vec3 } from './types';

/** Indices of two units whose plates overlap, lowest first. */
export type CollisionPair = [number, number];

interface Plate {
  center: Vec3;
  corners: Vec3[];
  faceNormals: Vec3[];
  edges: Vec3[];
}

const OUTLINE = plateCorners();

// A hexagon has three edge directions, and its faces repeat them in pairs.
const EDGES: Vec3[] = [0, 1, 2].map((i) => [
  OUTLINE[i + 1][0] - OUTLINE[i][0],
  OUTLINE[i + 1][1] - OUTLINE[i][1],
  0,
]);
const AXIS: Vec3 = [0, 0, 1];
const FACE_NORMALS: Vec3[] = [AXIS, ...EDGES.map((edge) => cross(edge, AXIS))];

/** Plates further apart than this can't touch, whatever their tilt. */
const REACH = 2 * Math.hypot(PLATE_RADIUS, Math.max(PLATE_TOP, -PLATE_BOTTOM));

function plateAt(module: PanelModule, config: KinematicConfig, q: JointAngles): Plate {
  const r = rotation(q);
  const o = origin(module, config);
  const orient = (v: Vec3) => mul(module.mount, mul(r, v));
  const place = (x: number, y: number, z: number) => add(o, orient([x, y, z]));
  const faces = [config.z23 + PLATE_BOTTOM, config.z23 + PLATE_TOP];
  return {
    center: place(0, 0, config.z23),
    corners: faces.flatMap((z) => OUTLINE.map(([x, y]) => place(x, y, z))),
    faceNormals: FACE_NORMALS.map(orient),
    edges: [...EDGES, AXIS].map(orient),
  };
}

function separatedAlong(axis: Vec3, a: Plate, b: Plate) {
  const projectA = a.corners.map((p) => dot(p, axis));
  const projectB = b.corners.map((p) => dot(p, axis));
  return Math.max(...projectA) < Math.min(...projectB) || Math.max(...projectB) < Math.min(...projectA);
}

function overlap(a: Plate, b: Plate) {
  if (norm(sub(a.center, b.center)) > REACH) return false;
  const axes = [...a.faceNormals, ...b.faceNormals];
  for (const edgeA of a.edges) {
    for (const edgeB of b.edges) {
      const axis = cross(edgeA, edgeB);
      // Parallel edges give no axis.
      if (dot(axis, axis) > 1e-9) axes.push(axis);
    }
  }
  return !axes.some((axis) => separatedAlong(axis, a, b));
}

export function findCollisions(
  modules: PanelModule[],
  config: KinematicConfig,
  angles: readonly JointAngles[],
): CollisionPair[] {
  const plates = modules.map((module, i) => plateAt(module, config, angles[i]));
  const pairs: CollisionPair[] = [];
  for (let i = 0; i < plates.length; i++) {
    for (let j = i + 1; j < plates.length; j++) {
      if (overlap(plates[i], plates[j])) pairs.push([i, j]);
    }
  }
  return pairs;
}
