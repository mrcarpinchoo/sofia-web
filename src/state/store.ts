// What the UI shows and how it changes it. Each action updates this store and
// tells the engine; values that change every frame stay out of here (see
// ui/stage/useTelemetry).

import { create } from 'zustand';
import { DEFAULT_FILTER_PARAMS } from '../core/filters';
import type { FilterParam, FilterParams, FilterType } from '../core/filters';
import { DEFAULT_SPACING, safeSpacing } from '../core/kinematics';
import type { TrajectoryType } from '../core/trajectories';
import type { LimitPolicy } from '../core/types';
import type { CameraActivity, CameraKind } from '../perception/CameraTracker';
import type { Framing } from '../perception/gestures';
import { PageRecorder } from '../recording/pageRecorder';
import type { ViewName } from '../scene/SofiaScene';
import { LabEngine } from '../simulation/LabEngine';
import type { TargetMode } from '../simulation/targets';

export type ControlTab = 'target' | 'response' | 'model' | 'camera' | 'link';

const TOAST_MS = 4500;
const PHONE_WIDTH = 760;

interface LabStore {
  // Simulation settings
  mode: TargetMode;
  path: TrajectoryType;
  speed: number;
  depth: number;
  filter: FilterType;
  filterParams: FilterParams;
  ideal: boolean;
  spacing: number;
  z12: number;
  z23: number;
  limit: number;
  policy: LimitPolicy;
  rays: boolean;
  selected: number;
  view: ViewName;
  paused: boolean;

  // Camera
  cameraKind: CameraKind;
  framing: Framing;
  mirror: boolean;
  cameraGain: number;
  cameraActivity: CameraActivity;
  cameraStatus: string;
  cameraPoints: number;
  gestureLabel: string;

  // Page
  controlsOpen: boolean;
  controlTab: ControlTab;
  notesOpen: boolean;
  toast: string | null;
  recording: boolean;
  recordBusy: boolean;
  sceneError: string | null;

  setMode: (mode: TargetMode) => void;
  setPath: (path: TrajectoryType) => void;
  setSpeed: (speed: number) => void;
  setDepth: (depth: number) => void;
  setFilter: (filter: FilterType) => void;
  setFilterParam: (key: FilterParam, value: number) => void;
  setIdeal: (ideal: boolean) => void;
  setSpacing: (spacing: number) => void;
  applySafeSpacing: () => void;
  setLength: (key: 'z12' | 'z23', value: number) => void;
  setLimit: (degrees: number) => void;
  setPolicy: (policy: LimitPolicy) => void;
  setRays: (rays: boolean) => void;
  select: (index: number) => void;
  setView: (view: ViewName) => void;
  setPaused: (paused: boolean) => void;
  reset: () => void;

  startCamera: () => void;
  stopCamera: () => void;
  setCameraKind: (kind: CameraKind) => void;
  setFraming: (framing: Framing) => void;
  setMirror: (mirror: boolean) => void;
  setCameraGain: (gain: number) => void;

  setControlsOpen: (open: boolean) => void;
  showTab: (tab: ControlTab) => void;
  setNotesOpen: (open: boolean) => void;
  showToast: (message: string) => void;
  toggleRecording: () => void;
  setSceneError: (message: string) => void;
}

const lab = () => useLab.getState();
let toastTimer: ReturnType<typeof setTimeout>;

export const engine = new LabEngine({
  onToast: (message) => lab().showToast(message),
  onCameraActivity: (cameraActivity) => useLab.setState({ cameraActivity }),
  onCameraStatus: (cameraStatus, cameraPoints) => useLab.setState({ cameraStatus, cameraPoints }),
  onGestureLabel: (gestureLabel) => useLab.setState({ gestureLabel }),
  onHeart: () => {
    lab().setView('front');
    lab().showToast('Corazón: ola del centro hacia afuera, conservando el panal.');
  },
});

export const recorder = new PageRecorder({
  onToast: (message) => lab().showToast(message),
  onPreparing: () => lab().setControlsOpen(true),
  onRecording: (recording) => useLab.setState({ recording }),
  onBusy: (recordBusy) => useLab.setState({ recordBusy }),
});

export const useLab = create<LabStore>()((set, get) => ({
  mode: 'auto',
  path: 'eight',
  speed: 1,
  depth: 400,
  filter: 'none',
  filterParams: { ...DEFAULT_FILTER_PARAMS },
  ideal: false,
  spacing: DEFAULT_SPACING,
  z12: 60,
  z23: 100,
  limit: 90,
  policy: 'clamp',
  rays: true,
  selected: 7,
  view: 'iso',
  paused: false,

  cameraKind: 'body',
  framing: 'upper',
  mirror: true,
  cameraGain: 1,
  cameraActivity: 'off',
  cameraStatus: 'Cámara apagada.',
  cameraPoints: 0,
  gestureLabel: 'Esperando un gesto.',

  controlsOpen: window.innerWidth >= PHONE_WIDTH,
  controlTab: 'target',
  notesOpen: false,
  toast: null,
  recording: false,
  recordBusy: false,
  sceneError: null,

  setMode: (mode) => {
    engine.setMode(mode);
    set({ mode });
  },
  setPath: (path) => {
    engine.setPath(path);
    set({ path });
  },
  setSpeed: (speed) => {
    engine.setSpeed(speed);
    set({ speed });
  },
  setDepth: (depth) => {
    engine.setDepth(depth);
    set({ depth });
  },
  setFilter: (filter) => {
    engine.setFilter(filter);
    set({ filter });
  },
  setFilterParam: (key, value) => {
    engine.setFilterParam(key, value);
    set({ filterParams: { ...get().filterParams, [key]: value } });
  },
  setIdeal: (ideal) => {
    engine.setIdeal(ideal);
    set({ ideal });
  },
  setSpacing: (spacing) => set({ spacing: engine.setSpacing(spacing) }),
  applySafeSpacing: () => {
    get().setSpacing(safeSpacing(get().z23));
    get().showToast('Separación recomendada aplicada a las placas del modelo.');
  },
  setLength: (key, value) => {
    engine.setLength(key, value);
    set({ [key]: value });
  },
  setLimit: (limit) => {
    engine.setLimit(limit);
    set({ limit });
  },
  setPolicy: (policy) => {
    engine.setPolicy(policy);
    set({ policy });
  },
  setRays: (rays) => {
    engine.setRays(rays);
    set({ rays });
  },
  select: (selected) => {
    engine.select(selected);
    set({ selected });
  },
  setView: (view) => {
    engine.setView(view);
    set({ view });
  },
  setPaused: (paused) => {
    engine.setPaused(paused);
    set({ paused });
  },
  reset: () => engine.reset(),

  startCamera: () => {
    engine.startCamera();
    set({ mode: 'camera' });
  },
  stopCamera: () => engine.stopCamera(),
  setCameraKind: (cameraKind) => {
    engine.setCameraKind(cameraKind, get().cameraActivity !== 'off');
    set({ cameraKind });
  },
  setFraming: (framing) => {
    engine.setFraming(framing);
    set({ framing });
  },
  setMirror: (mirror) => {
    engine.setMirror(mirror);
    set({ mirror });
  },
  setCameraGain: (cameraGain) => {
    engine.setCameraGain(cameraGain);
    set({ cameraGain });
  },

  setControlsOpen: (controlsOpen) => set({ controlsOpen }),
  showTab: (controlTab) => set({ controlTab, controlsOpen: true }),
  setNotesOpen: (notesOpen) => set({ notesOpen }),
  showToast: (toast) => {
    set({ toast });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => set({ toast: null }), TOAST_MS);
  },
  toggleRecording: () => void recorder.toggle(),
  setSceneError: (sceneError) => set({ sceneError }),
}));
