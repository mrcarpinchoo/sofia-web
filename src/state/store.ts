// What the UI shows and how it changes it. Each action updates this store and
// tells the engine; values that change every frame stay out of here (see
// ui/stage/useTelemetry).

import { create } from 'zustand';
import { DEFAULT_FILTER_PARAMS } from '../core/filters';
import type { FilterParam, FilterParams, FilterType } from '../core/filters';
import { DEFAULT_SPACING, safeSpacing } from '../core/kinematics';
import type { TrajectoryType } from '../core/trajectories';
import type { LimitPolicy } from '../core/types';
import { MaestroLink } from '../hardware/MaestroLink';
import type { LinkSnapshot } from '../hardware/MaestroLink';
import type { GestureId } from '../hardware/protocol';
import type { CameraActivity } from '../perception/CameraTracker';
import { GESTURES } from '../perception/gestures';
import type { ViewName } from '../scene/SofiaScene';
import { LabEngine } from '../simulation/LabEngine';
import { DEFAULT_LIMIT } from '../simulation/Simulation';
import type { TargetMode } from '../simulation/targets';


const TOAST_MS = 4500;

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
  cameraActivity: CameraActivity;
  cameraStatus: string;
  cameraPoints: number;
  gestureLabel: string;

  // Real panel (Maestro link)
  linkHost: string;
  link: LinkSnapshot;
  /** The 3D view shows the real panel's angles instead of the simulation. */
  mirroring: boolean;

  // Page
  controlsOpen: boolean;
  notesOpen: boolean;
  toast: string | null;
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

  setLinkHost: (host: string) => void;
  connectLink: () => void;
  disconnectLink: () => void;
  armPanel: () => void;
  stopPanel: () => void;
  offPanel: () => void;
  playGesture: (id: GestureId, name: string) => void;
  /** Camera point, 0-1 (mirrored, y down); repeated until endPanelTarget. */
  aimPanel: (x: number, y: number) => void;
  endPanelTarget: () => void;

  setControlsOpen: (open: boolean) => void;
  setNotesOpen: (open: boolean) => void;
  showToast: (message: string) => void;
  setSceneError: (message: string) => void;
}

const lab = () => useLab.getState();
let toastTimer: ReturnType<typeof setTimeout>;

export const engine = new LabEngine({
  onToast: (message) => lab().showToast(message),
  onCameraActivity: (cameraActivity) => useLab.setState({ cameraActivity }),
  onCameraStatus: (cameraStatus, cameraPoints) => useLab.setState({ cameraStatus, cameraPoints }),
  onGestureLabel: (gestureLabel) => useLab.setState({ gestureLabel }),
  // The camera also drives the real panel while this browser controls it,
  // sending what sofia-tracker sends: the gesture and the hand's position.
  onGesture: (name) => {
    if (controlsPanel()) link.gesture(GESTURES[name].id, name);
  },
  onHand: (point) => {
    if (!controlsPanel()) return;
    if (point) link.setTarget(...point);
    else link.endTarget();
  },
});

function controlsPanel() {
  const { link: snapshot } = lab();
  return snapshot.state === 'online' && Boolean(snapshot.status?.isController);
}

/** Why the Maestro rejected a command, as the user should read it. */
const REJECTIONS: Record<string, string> = {
  NOT_CONTROLLER: 'otro cliente tiene el control. Pulsa ARMAR cuando quede libre.',
  BUSY: 'hay un gesto en curso.',
  INTERNAL: 'las placas PWM no responden. Revisa el cableado y la alimentación.',
  BAD_PAYLOAD: 'valor fuera de rango.',
};

export const link = new MaestroLink({
  onChange: (snapshot) => useLab.setState({ link: snapshot }),
  onAngles: (angles) => {
    engine.showRealPanel(angles);
    const mirroring = angles !== null;
    if (lab().mirroring !== mirroring) useLab.setState({ mirroring });
  },
  onRejected: (command, reason) =>
    lab().showToast(`${command}: ${REJECTIONS[reason] ?? reason}`),
});
// Hot reload creates a new link; close the old socket so it releases control.
import.meta.hot?.dispose(() => link.dispose());

export const useLab = create<LabStore>()((set, get) => ({
  mode: 'auto',
  path: 'eight',
  speed: 1,
  depth: 400,
  filter: 'none',
  filterParams: { ...DEFAULT_FILTER_PARAMS },
  ideal: false,
  spacing: DEFAULT_SPACING,
  z12: 22,
  z23: 37,
  limit: DEFAULT_LIMIT,
  policy: 'clamp',
  rays: true,
  selected: 7,
  view: 'iso',
  paused: false,

  cameraActivity: 'off',
  cameraStatus: 'Cámara apagada.',
  cameraPoints: 0,
  gestureLabel: 'Esperando un gesto.',

  linkHost: '192.168.4.1:81',
  link: { state: 'disconnected', firmware: null, status: null, p95: null, within500: null },
  mirroring: false,

  controlsOpen: true,
  notesOpen: false,
  toast: null,
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

  setLinkHost: (linkHost) => set({ linkHost }),
  connectLink: () => {
    const host = get().linkHost.trim().replace(/^wss?:\/\//, '').replace(/\/+$/, '');
    link.connect(`ws://${host}/`);
  },
  disconnectLink: () => link.disconnect(),
  armPanel: () => link.arm(),
  stopPanel: () => link.stop(),
  offPanel: () => link.off(),
  playGesture: (id, name) => link.gesture(id, name),
  aimPanel: (x, y) => link.setTarget(x, y),
  endPanelTarget: () => link.endTarget(),

  setControlsOpen: (controlsOpen) => set({ controlsOpen }),
  setNotesOpen: (notesOpen) => set({ notesOpen }),
  showToast: (toast) => {
    set({ toast });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => set({ toast: null }), TOAST_MS);
  },
  setSceneError: (sceneError) => set({ sceneError }),
}));
