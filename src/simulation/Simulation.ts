// The simulation itself: a fixed-step loop that moves a target and solves all
// 16 units towards it. It knows nothing about React, three.js or the webcam.

import { DEFAULT_FILTER_PARAMS, JointFilter } from '../core/filters';
import type { FilterParams, FilterType } from '../core/filters';
import { DEFAULT_SPACING, angularError, forward, inverse, layout } from '../core/kinematics';
import { RAD } from '../core/math';
import { trajectory } from '../core/trajectories';
import type { TrajectoryType } from '../core/trajectories';
import type {
  InverseResult,
  JointAngles,
  KinematicConfig,
  PanelModule,
  Pose,
  Vec2,
  Vec3,
} from '../core/types';
import { gestureTarget, imageTarget } from '../perception/gestures';
import type { GestureName } from '../perception/gestures';
import { heartTarget } from '../perception/heart';
import type { CameraKind } from '../perception/CameraTracker';
import { TargetInputs } from './targets';
import type { TargetMode } from './targets';

/** Fixed simulation step: 120 Hz, independent of the frame rate. */
export const DT = 1 / 120;

/** Default limit of both joints, in degrees. */
export const DEFAULT_LIMIT = 30;

/** Time constant of the camera target's smoothing, in s. */
const CAMERA_SMOOTHING = 0.12;

/** The pose freezes this long after losing the person, in ms. */
export const DETECTION_FREEZE_MS = 800;

// One sample every 12 steps (10 Hz).
const SAMPLE_EVERY = 12;
const HISTORY_LENGTH = 120;
const MAX_RECORDED_SAMPLES = 3000;

export interface Unit {
  q: JointAngles;
  ik: InverseResult;
  filters: [JointFilter, JointFilter];
  pose: Pose;
  error: number | null;
  target: Vec3;
}

export interface HistorySample {
  t: number;
  q: JointAngles;
  raw: JointAngles;
}

export interface SimulationState {
  mode: TargetMode;
  path: TrajectoryType;
  filter: FilterType;
  speed: number;
  depth: number;
  target: Vec3;
  t: number;
  phase: number;
  paused: boolean;
  selected: number;
  rays: boolean;
  ideal: boolean;
  cameraKind: CameraKind;
  cameraPoint: Vec2 | null;
  cameraCenter: Vec2;
  cameraGain: number;
  mirror: boolean;
  lastCameraSeen: number;
  gesture: GestureName | null;
  gestureStart: number;
  heartActive: boolean;
  heartTime: number;
}

export class Simulation {
  readonly config: KinematicConfig = {
    z12: 22,
    z23: 37,
    spacing: DEFAULT_SPACING,
    limits: [
      [-DEFAULT_LIMIT * RAD, DEFAULT_LIMIT * RAD],
      [-DEFAULT_LIMIT * RAD, DEFAULT_LIMIT * RAD],
    ],
    policy: 'clamp',
  };
  readonly params: FilterParams = { ...DEFAULT_FILTER_PARAMS };
  readonly state: SimulationState = {
    mode: 'auto',
    path: 'eight',
    filter: 'none',
    speed: 1,
    depth: 400,
    target: [180, 0, 400],
    t: 0,
    phase: 0,
    paused: false,
    selected: 7,
    rays: true,
    ideal: false,
    cameraKind: 'body',
    cameraPoint: null,
    cameraCenter: [0.5, 0.45],
    cameraGain: 1,
    mirror: true,
    lastCameraSeen: -Infinity,
    gesture: null,
    gestureStart: 0,
    heartActive: false,
    heartTime: 0,
  };

  modules: PanelModule[] = layout();
  units: Unit[] = [];
  history: HistorySample[] = [];
  /** Recorded samples for the CSV export; each holds one row per unit. */
  rows: string[][][] = [];

  private tick = 0;
  private readonly inputs = new TargetInputs();
  private readonly isCameraRunning: () => boolean;

  constructor(isCameraRunning: () => boolean) {
    this.isCameraRunning = isCameraRunning;
    this.createUnits();
  }

  /** Each unit's commanded joint angles, in rad. */
  get jointAngles(): readonly Readonly<JointAngles>[] {
    return this.units.map((unit) => unit.q);
  }

  createUnits() {
    const { config, state } = this;
    this.units = this.modules.map((module) => {
      const ik = inverse(module, config, state.target);
      return {
        q: [...ik.q],
        ik,
        filters: [new JointFilter(ik.q[0]), new JointFilter(ik.q[1])],
        pose: forward(module, config, ik.q),
        error: 0,
        target: state.target,
      };
    });
  }

  resetFilters() {
    for (const unit of this.units) {
      unit.filters.forEach((filter, j) => filter.reset(unit.q[j]));
    }
  }

  /** Clears the run, keeping the settings. The caller rebuilds the units. */
  resetRun() {
    const { state } = this;
    state.t = 0;
    state.phase = 0;
    this.tick = 0;
    this.rows = [];
    this.history = [];
    state.target =
      state.mode === 'auto'
        ? trajectory(0, state.path, state.speed, state.depth)
        : [0, 0, state.depth];
  }

  step(now: number) {
    const { state, config, params } = this;
    state.t += DT;
    if (state.mode === 'auto') state.phase += DT * state.speed;
    state.target = this.inputs.sample(state.mode, state);

    const gesture = state.gesture;
    const frozen =
      state.mode === 'camera' &&
      (!this.isCameraRunning() ||
        (state.cameraKind === 'hand'
          ? !gesture
          : now - state.lastCameraSeen > DETECTION_FREEZE_MS));

    if (state.mode === 'camera' && !frozen) {
      const goal =
        state.cameraKind === 'body'
          ? imageTarget(state.cameraPoint as Vec2, {
              mirror: state.mirror,
              gain: state.cameraGain,
              depth: state.depth,
              center: state.cameraCenter,
            })
          : gestureTarget(gesture as GestureName, state.t - state.gestureStart, state.depth);
      const a = 1 - Math.exp(-DT / CAMERA_SMOOTHING);
      state.target = [
        state.target[0] + a * (goal[0] - state.target[0]),
        state.target[1] + a * (goal[1] - state.target[1]),
        state.target[2] + a * (goal[2] - state.target[2]),
      ];
    }

    state.heartActive =
      state.mode === 'camera' && state.cameraKind === 'hand' && gesture === 'Heart';
    if (state.heartActive && !frozen) state.heartTime += DT;

    this.units.forEach((unit, i) => {
      const module = this.modules[i];
      unit.target = state.heartActive ? heartTarget(module, config, state.heartTime) : state.target;
      unit.ik = inverse(module, config, unit.target, unit.q);
      if (
        frozen ||
        unit.ik.undefinedDirection ||
        (unit.ik.unreachable && config.policy === 'hold')
      ) {
        unit.filters.forEach((filter, j) => filter.reset(unit.q[j]));
      } else {
        unit.q = [
          unit.filters[0].step(unit.ik.q[0], DT, state.filter, params, config.limits[0]),
          unit.filters[1].step(unit.ik.q[1], DT, state.filter, params, config.limits[1]),
        ];
      }
      unit.pose = forward(module, config, unit.q);
      unit.error = angularError(unit.pose, unit.target);
    });

    if (++this.tick % SAMPLE_EVERY === 0) this.record(frozen);
  }

  private record(frozen: boolean) {
    const { state, config, params } = this;
    const unit = this.units[state.selected];
    this.history.push({ t: state.t, q: [...unit.q], raw: [...unit.ik.raw] });
    if (this.history.length > HISTORY_LENGTH) this.history.shift();

    const degrees = (x: number) => (x / RAD).toFixed(5);
    this.rows.push(
      this.units.map((u, i) => [
        state.t.toFixed(3),
        String(i + 1),
        ...u.target.map((x) => x.toFixed(4)),
        ...u.ik.raw.map(degrees),
        ...u.ik.q.map(degrees),
        ...u.q.map(degrees),
        u.error === null ? '' : u.error.toFixed(6),
        String(Number(u.ik.unreachable)),
        String(Number(u.ik.singular)),
        state.mode,
        state.path,
        state.filter,
        String(state.speed),
        String(config.z12),
        String(config.z23),
        String(config.limits[0][1] / RAD),
        config.policy,
        JSON.stringify(params),
        String(config.spacing),
        state.mode === 'camera' ? state.cameraKind : '',
        state.mode === 'camera' ? (state.gesture ?? '') : '',
        String(Number(frozen)),
      ]),
    );
    if (this.rows.length > MAX_RECORDED_SAMPLES) this.rows.shift();
  }
}
