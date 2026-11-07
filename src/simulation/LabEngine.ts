// Connects the simulation, the 3D scene and the camera, and runs the frame
// loop. Everything here happens outside React: the store calls these methods,
// and the engine reports back through EngineEvents.

import { findCollisions } from '../core/collisions';
import type { CollisionPair } from '../core/collisions';
import type { FilterParam, FilterType } from '../core/filters';
import { layout } from '../core/kinematics';
import { RAD, clamp } from '../core/math';
import type { TrajectoryType } from '../core/trajectories';
import type { LimitPolicy } from '../core/types';
import { CameraTracker } from '../perception/CameraTracker';
import type { CameraActivity, CameraKind } from '../perception/CameraTracker';
import type { TrackerGesture } from '../core/choreography';
import type { Vec2 } from '../core/types';
import { GESTURES } from '../perception/gestures';
import type { Framing } from '../perception/gestures';
import { SofiaScene } from '../scene/SofiaScene';
import type { ViewName } from '../scene/SofiaScene';
import { download, toCsv } from './csv';
import { DETECTION_FREEZE_MS, DT, HISTORY_LENGTH, Simulation } from './Simulation';
import type { Unit } from './Simulation';
import type { TargetMode } from './targets';

export const MIN_SPACING = 120;
export const MAX_SPACING = 500;

/** Longest step the loop catches up on after a slow frame, in s. */
const MAX_FRAME_TIME = 0.05;
const TRAIL_INTERVAL = 0.04;
const TELEMETRY_INTERVAL = 0.08;

export interface Telemetry {
  q1: number;
  q2: number;
  error: number | null;
  unitState: string;
  unreachable: boolean;
  inReach: number;
  clock: string;
  collisions: CollisionPair[];
}

export interface EngineEvents {
  onToast: (message: string) => void;
  onCameraActivity: (activity: CameraActivity) => void;
  onCameraStatus: (message: string, points: number) => void;
  onGestureLabel: (label: string) => void;
  /** A gesture recognised by the camera (hand mode). */
  onGesture: (name: TrackerGesture) => void;
  /** The hand's position, 0-1 in the mirrored image, or null when lost. */
  onHand: (point: Vec2 | null) => void;
}

const NO_GESTURE = 'Esperando un gesto.';

/** While mirroring the real panel: no target, rays or ideal pose to draw. */
const MIRROR_FLAGS = { rays: false, ideal: false, showTarget: false };

export class LabEngine {
  readonly sim: Simulation;
  readonly camera: CameraTracker;

  private readonly events: EngineEvents;
  private scene: SofiaScene | null = null;
  private view: ViewName = 'iso';
  private colliding = new Set<number>();
  /** The real panel's angles from the Maestro; while set, the simulation pauses. */
  private mirror: Unit[] | null = null;
  private telemetry: Telemetry;
  private readonly telemetryListeners = new Set<() => void>();

  constructor(events: EngineEvents) {
    this.events = events;
    this.sim = new Simulation(() => this.camera.running);
    this.camera = new CameraTracker({
      onStatus: (message) => this.cameraStatus(message),
      onActive: (activity) => this.cameraActivity(activity),
      onBody: (point, time) => {
        this.sim.state.cameraPoint = point;
        this.sim.state.lastCameraSeen = time;
      },
      onHand: (point, time) => this.hand(point, time),
      onGesture: (name) => this.gesture(name),
    });
    this.telemetry = this.readTelemetry();
  }

  /** Starts drawing into `container`. Returns the function that stops it. */
  mount(container: HTMLElement): () => void {
    const scene = new SofiaScene(container, (target) => {
      this.sim.state.target = target;
    });
    const { sim } = this;
    this.scene = scene;
    scene.mode = sim.state.mode;
    scene.depth = sim.state.depth;
    scene.select(sim.state.selected);
    scene.build(sim.modules, sim.config);
    scene.setView(this.view);

    let last = performance.now();
    let accumulated = 0;
    let sinceTrail = 0;
    let sinceTelemetry = 0;
    let frameId = 0;

    const frame = (now: number) => {
      frameId = requestAnimationFrame(frame);
      const elapsed = Math.min(MAX_FRAME_TIME, (now - last) / 1000);
      last = now;
      const { mirror } = this;
      if (mirror) {
        sim.state.t += elapsed;
        accumulated = 0;
      } else if (sim.state.paused) {
        accumulated = 0;
      } else {
        accumulated += elapsed;
        while (accumulated >= DT) {
          sim.step(performance.now());
          accumulated -= DT;
        }
      }
      sinceTrail += elapsed;
      const sampleTrail = sinceTrail > TRAIL_INTERVAL;
      scene.update(
        mirror ?? sim.units,
        sim.state.target,
        mirror
          ? MIRROR_FLAGS
          : // A gesture moves each unit on its own: no shared target to draw.
            { rays: sim.state.rays && !sim.state.gesture, ideal: sim.state.ideal, showTarget: !sim.state.gesture },
        this.colliding,
        !mirror && !sim.state.paused && sampleTrail,
      );
      if (sampleTrail) sinceTrail = 0;
      sinceTelemetry += elapsed;
      if (sinceTelemetry > TELEMETRY_INTERVAL) {
        this.publishTelemetry();
        sinceTelemetry = 0;
      }
    };
    frameId = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(frameId);
      scene.dispose();
      this.scene = null;
    };
  }

  subscribeTelemetry = (listener: () => void) => {
    this.telemetryListeners.add(listener);
    return () => {
      this.telemetryListeners.delete(listener);
    };
  };

  getTelemetry = () => this.telemetry;

  /**
   * Shows the real panel: the angles the Maestro commands, in degrees, in
   * module order. null goes back to the simulation.
   */
  showRealPanel(angles: readonly (readonly [number, number])[] | null) {
    const { sim } = this;
    if (!angles) {
      if (this.mirror) sim.history = [];
      this.mirror = null;
      return;
    }
    if (!this.mirror) {
      sim.history = [];
      this.scene?.clearTrail();
    }
    this.mirror = sim.units.map((unit, i) => {
      const q: [number, number] = [(angles[i]?.[0] ?? 0) * RAD, (angles[i]?.[1] ?? 0) * RAD];
      return {
        ...unit,
        q,
        ik: { raw: [...q], q: [...q], singular: false, unreachable: false, undefinedDirection: false },
        error: null,
      };
    });
    const selected = this.mirror[sim.state.selected];
    sim.history.push({ t: sim.state.t, q: [...selected.q], raw: [...selected.q] });
    if (sim.history.length > HISTORY_LENGTH) sim.history.shift();
  }

  setMode(mode: TargetMode) {
    const { state } = this.sim;
    if (mode !== 'camera' && state.mode === 'camera') this.camera.stop();
    state.mode = mode;
    if (this.scene) this.scene.mode = mode;
    this.scene?.clearTrail();
  }

  setPath(path: TrajectoryType) {
    this.sim.state.path = path;
    this.scene?.clearTrail();
  }

  setSpeed(speed: number) {
    this.sim.state.speed = speed;
  }

  setDepth(depth: number) {
    const { state } = this.sim;
    state.depth = depth;
    if (this.scene) this.scene.depth = depth;
    if (state.mode === 'cursor') state.target[2] = depth;
  }

  setFilter(filter: FilterType) {
    this.sim.state.filter = filter;
    this.sim.resetFilters();
  }

  setFilterParam(key: FilterParam, value: number) {
    this.sim.params[key] = value;
    this.sim.resetFilters();
  }

  setIdeal(ideal: boolean) {
    this.sim.state.ideal = ideal;
  }

  setRays(rays: boolean) {
    this.sim.state.rays = rays;
  }

  /** Applies a new base spacing and returns the value actually used. */
  setSpacing(value: number) {
    const { sim } = this;
    sim.config.spacing = clamp(Math.round(value), MIN_SPACING, MAX_SPACING);
    sim.modules = layout(sim.config.spacing);
    this.scene?.reposition(sim.modules, sim.config);
    sim.history = [];
    this.scene?.clearTrail();
    return sim.config.spacing;
  }

  setLength(key: 'z12' | 'z23', value: number) {
    this.sim.config[key] = value;
    this.rebuild();
  }

  setLimit(degrees: number) {
    const { sim } = this;
    const limit = degrees * RAD;
    sim.config.limits = [
      [-limit, limit],
      [-limit, limit],
    ];
    for (const unit of sim.units) {
      unit.q = [clamp(unit.q[0], -limit, limit), clamp(unit.q[1], -limit, limit)];
    }
    sim.resetFilters();
  }

  setPolicy(policy: LimitPolicy) {
    this.sim.config.policy = policy;
    this.sim.resetFilters();
  }

  select(index: number) {
    this.sim.state.selected = index;
    this.scene?.select(index);
    this.sim.history = [];
    this.publishTelemetry();
  }
  setView(view: ViewName) {
    this.view = view;
    this.scene?.setView(view);
  }

  zoom(factor: number) {
    this.scene?.zoom(factor);
  }

  setPaused(paused: boolean) {
    this.sim.state.paused = paused;
  }

  reset() {
    this.sim.resetRun();
    this.rebuild();
    this.publishTelemetry();
  }

  exportCsv() {
    if (!this.sim.rows.length) {
      this.events.onToast('Inicia la simulación para registrar datos.');
      return;
    }
    download(toCsv(this.sim.rows), 'SOFIA-datos-simulados.csv');
  }

  attachCamera(video: HTMLVideoElement, overlay: HTMLCanvasElement) {
    this.camera.attach(video, overlay);
  }

  detachCamera() {
    this.camera.detach();
  }

  startCamera() {
    const { state } = this.sim;
    this.setMode('camera');
    state.lastCameraSeen = -Infinity;
    void this.camera.start(state.cameraKind);
  }

  stopCamera() {
    this.camera.stop();
  }

  setCameraKind(kind: CameraKind, restart: boolean) {
    const { state } = this.sim;
    state.cameraKind = kind;
    state.lastCameraSeen = -Infinity;
    state.gesture = null;
    state.handPoint = null;
    state.cameraPoint = null;
    this.camera.lastCenter = null;
    this.camera.recognizer.reset();
    this.events.onGestureLabel(NO_GESTURE);
    if (restart) void this.camera.start(kind);
  }

  setFraming(framing: Framing) {
    const { state } = this.sim;
    this.camera.framing = framing;
    this.camera.lastCenter = null;
    state.cameraCenter = [0.5, 0.45];
    state.lastCameraSeen = -Infinity;
  }

  setMirror(mirror: boolean) {
    this.sim.state.mirror = mirror;
  }

  setCameraGain(gain: number) {
    this.sim.state.cameraGain = gain;
  }

  /** Makes the person's current position the center of the panel. */
  centerCamera() {
    const { state } = this.sim;
    if (
      state.cameraKind !== 'body' ||
      !state.cameraPoint ||
      performance.now() - state.lastCameraSeen > DETECTION_FREEZE_MS
    ) {
      this.events.onToast('Activa el seguimiento y muestra tus hombros antes de centrar.');
      return;
    }
    state.cameraCenter = [...state.cameraPoint];
    this.events.onToast('Tu posición actual corresponde al centro del panal.');
  }

  private rebuild() {
    const { sim } = this;
    sim.createUnits();
    if (this.scene) {
      this.scene.build(sim.modules, sim.config);
      this.scene.select(sim.state.selected);
      this.scene.setView(this.view);
      this.scene.clearTrail();
    }
    sim.history = [];
  }

  private cameraStatus(message: string) {
    this.events.onCameraStatus(message, this.camera.points);
  }

  private cameraActivity(activity: CameraActivity) {
    if (activity === 'off') {
      this.sim.state.lastCameraSeen = -Infinity;
      this.events.onGestureLabel(NO_GESTURE);
    }
    this.events.onCameraActivity(activity);
  }

  private hand(point: Vec2 | null, time: number) {
    const { state } = this.sim;
    if (point) {
      state.handPoint = point;
      state.lastCameraSeen = time;
    }
    this.events.onHand(point);
  }

  /** Plays the gesture once, as the Maestro does; ignored while one plays. */
  private gesture(name: TrackerGesture) {
    const { state } = this.sim;
    if (!state.gesture) {
      state.gesture = name;
      state.gestureStart = state.t;
    }
    this.events.onGestureLabel(`${GESTURES[name].name} → ${GESTURES[name].motion}`);
    this.events.onGesture(name);
  }

  private readTelemetry(): Telemetry {
    const { state, modules, config } = this.sim;
    const units = this.mirror ?? this.sim.units;
    const unit = units[state.selected];
    const { ik } = unit;
    const minutes = String(Math.floor(state.t / 60)).padStart(2, '0');
    const seconds = (state.t % 60).toFixed(1).padStart(4, '0');
    return {
      q1: unit.q[0] / RAD,
      q2: unit.q[1] / RAD,
      error: unit.error,
      unitState: this.mirror
        ? 'Panel real'
        : ik.undefinedDirection
          ? 'Dirección indefinida'
          : ik.singular
            ? 'Singularidad'
            : ik.unreachable
              ? 'Fuera de alcance'
              : 'En alcance',
      unreachable: ik.unreachable,
      inReach: units.filter((u) => !u.ik.unreachable).length,
      clock: `${minutes}:${seconds}`,
      collisions: findCollisions(
        modules,
        config,
        units.map((u) => u.q),
      ),
    };
  }

  private publishTelemetry() {
    this.telemetry = this.readTelemetry();
    this.colliding = new Set(this.telemetry.collisions.flat());
    this.telemetryListeners.forEach((listener) => listener());
  }
}
