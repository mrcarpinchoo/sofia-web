// Runs MediaPipe on the webcam and reports what it sees through callbacks.
// Images are processed locally; nothing leaves the browser.

import type { GestureRecognizer, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { Vec2 } from '../core/types';
import {
  GESTURES,
  GESTURE_HOLD_MS,
  GestureLatch,
  MIN_GESTURE_SCORE,
  isGesture,
  torsoCenter,
} from './gestures';
import type { Framing, GestureName, Landmark } from './gestures';
import { isHeart } from './heart';

export type CameraKind = 'body' | 'hand';
export type CameraActivity = 'off' | 'loading' | 'running';

type PoseResult = ReturnType<PoseLandmarker['detectForVideo']>;
type GestureResult = ReturnType<GestureRecognizer['recognizeForVideo']>;

export interface CameraCallbacks {
  onStatus: (message: string) => void;
  onActive: (activity: CameraActivity) => void;
  onBody: (point: Vec2, time: number) => void;
  onGesture: (name: GestureName, time: number, changed: boolean) => void;
}

// Served from public/, see scripts/fetch-assets.mjs.
const ASSETS = `${import.meta.env.BASE_URL}mediapipe`;
const MODELS: Record<CameraKind, string> = {
  body: `${ASSETS}/models/pose_landmarker_lite.task`,
  hand: `${ASSETS}/models/gesture_recognizer.task`,
};

const POSE_EDGES = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27],
  [24, 26], [26, 28],
];
const HAND_EDGES = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

const CAMERA_ERRORS: Record<string, string> = {
  NotAllowedError: 'Permiso denegado. Permite la cámara en el navegador y pulsa Activar cámara.',
  NotFoundError: 'No se encontró ninguna cámara conectada.',
  NotReadableError: 'La cámara está ocupada o no puede abrirse. Cierra otras aplicaciones que la usen.',
};

/** Minimum time between detections, in ms. */
const INFERENCE_INTERVAL_MS = 100;

function timeout<T>(promise: Promise<T>, ms = 45000): Promise<T> {
  let id: ReturnType<typeof setTimeout>;
  const expired = new Promise<never>((_, reject) => {
    id = setTimeout(() => reject(new Error('La carga tardó demasiado. Intenta otra vez.')), ms);
  });
  return Promise.race([promise, expired]).finally(() => clearTimeout(id));
}

export class CameraTracker {
  running = false;
  framing: Framing = 'upper';
  latch = new GestureLatch();
  lastCenter: Vec2 | null = null;

  private video: HTMLVideoElement | null = null;
  private overlay: HTMLCanvasElement | null = null;
  private readonly callbacks: CameraCallbacks;
  private kind: CameraKind = 'body';
  // Incremented by stop(), so that async work from an older start() gives up.
  private epoch = 0;
  private stream: MediaStream | null = null;
  private task: PoseLandmarker | GestureRecognizer | null = null;
  private frameId = 0;
  private lastFrame = -1;
  private lastInference = -Infinity;
  private lastBodyTime = 0;

  constructor(callbacks: CameraCallbacks) {
    this.callbacks = callbacks;
  }

  /** Connects the page elements. Must happen before start(). */
  attach(video: HTMLVideoElement, overlay: HTMLCanvasElement) {
    this.video = video;
    this.overlay = overlay;
  }

  /** Stops the camera and forgets the page elements. */
  detach() {
    this.stop(false);
    this.video = null;
    this.overlay = null;
  }

  /** Landmarks drawn in the last frame. */
  get points() {
    return Number(this.overlay?.dataset.points) || 0;
  }

  async start(kind: CameraKind) {
    this.stop(false);
    const video = this.video;
    if (!video) return;
    const session = this.epoch;
    const { onActive, onStatus } = this.callbacks;
    this.kind = kind;
    onActive('loading');
    onStatus('Esperando permiso para la cámara…');
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('El navegador no permite cámara aquí. Abre la página con HTTPS o localhost.');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      if (session !== this.epoch) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.stream = stream;
      video.srcObject = stream;
      stream.getVideoTracks().forEach((track) => {
        track.onended = () => {
          if (session === this.epoch) {
            this.stop(false);
            onStatus('La cámara se desconectó. Vuelve a activarla.');
          }
        };
      });
      await timeout(video.play(), 12000);
      if (session !== this.epoch) return;

      onStatus(`Cargando el modelo ${kind === 'body' ? 'corporal' : 'de gestos'}…`);
      const task = await this.createTask(kind, session);
      if (!task || session !== this.epoch) return;

      this.task = task;
      this.running = true;
      this.lastFrame = -1;
      this.lastInference = -Infinity;
      this.lastCenter = null;
      this.lastBodyTime = 0;
      this.latch.reset();
      onActive('running');
      onStatus(
        kind === 'body' ? 'Buscando una persona…' : 'Muestra una mano y mantén uno de los cinco gestos.',
      );
      this.loop(session);
    } catch (error) {
      if (session !== this.epoch) return;
      this.stop(false);
      const { name, message } = error as Error;
      onStatus(CAMERA_ERRORS[name] ?? `No se pudo iniciar la detección. ${message} Vuelve a intentarlo.`);
    }
  }

  stop(announce = true) {
    this.epoch++;
    this.running = false;
    cancelAnimationFrame(this.frameId);
    const stream = this.stream;
    this.stream = null;
    stream?.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
    if (this.video) {
      this.video.pause();
      this.video.srcObject = null;
    }
    this.task?.close();
    this.task = null;
    if (this.overlay) {
      this.overlay.getContext('2d')?.clearRect(0, 0, this.overlay.width, this.overlay.height);
    }
    this.latch.reset();
    this.callbacks.onActive('off');
    if (announce) this.callbacks.onStatus('Cámara apagada. Los paneles conservan la última pose.');
  }

  private async createTask(kind: CameraKind, session: number) {
    const vision = await timeout(import('@mediapipe/tasks-vision'));
    if (session !== this.epoch) return null;
    const files = await timeout(vision.FilesetResolver.forVisionTasks(`${ASSETS}/wasm`));
    if (session !== this.epoch) return null;

    const options = {
      baseOptions: { modelAssetPath: MODELS[kind], delegate: 'CPU' as const },
      runningMode: 'VIDEO' as const,
    };
    const loading: Promise<PoseLandmarker | GestureRecognizer> =
      kind === 'body'
        ? vision.PoseLandmarker.createFromOptions(files, {
            ...options,
            numPoses: 3,
            minPoseDetectionConfidence: 0.55,
            minPosePresenceConfidence: 0.55,
            minTrackingConfidence: 0.55,
            outputSegmentationMasks: false,
          })
        : vision.GestureRecognizer.createFromOptions(files, {
            ...options,
            numHands: 2,
            minHandDetectionConfidence: 0.55,
            minHandPresenceConfidence: 0.55,
            minTrackingConfidence: 0.55,
          });
    let expired = false;
    // If the camera stopped meanwhile, nobody else will close this task.
    const guarded = loading.then((task) => {
      if (expired || session !== this.epoch) {
        task.close();
        return null;
      }
      return task;
    });
    try {
      return await timeout(guarded);
    } catch (error) {
      expired = true;
      throw error;
    }
  }

  private loop(session: number) {
    if (!this.running || session !== this.epoch) return;
    const video = this.video;
    const now = performance.now();
    if (
      video &&
      this.task &&
      video.readyState >= 2 &&
      video.videoWidth &&
      now - this.lastInference >= INFERENCE_INTERVAL_MS &&
      video.currentTime !== this.lastFrame
    ) {
      this.lastFrame = video.currentTime;
      this.lastInference = now;
      try {
        if (this.kind === 'body') {
          this.processBody((this.task as PoseLandmarker).detectForVideo(video, now), now);
        } else {
          this.processHand((this.task as GestureRecognizer).recognizeForVideo(video, now), now);
        }
      } catch (error) {
        this.stop(false);
        this.callbacks.onStatus(
          `La detección se detuvo: ${(error as Error).message}. Puedes volver a activar la cámara.`,
        );
        return;
      }
    }
    this.frameId = requestAnimationFrame(() => this.loop(session));
  }

  private processBody(result: PoseResult, now: number) {
    const { onBody, onStatus } = this.callbacks;
    const candidates = (result.landmarks ?? []).flatMap((landmarks) => {
      const center = torsoCenter(landmarks, this.framing);
      return center ? [{ landmarks, center }] : [];
    });
    const ref: Vec2 = this.lastCenter && now - this.lastBodyTime < 1200 ? this.lastCenter : [0.5, 0.5];
    const distance = (center: Vec2) => Math.hypot(center[0] - ref[0], center[1] - ref[1]);
    candidates.sort((a, b) => distance(a.center) - distance(b.center));

    let selected = candidates.at(0);
    // A sudden jump is probably another person, not the one being followed.
    if (selected && this.lastCenter && now - this.lastBodyTime < 800 && distance(selected.center) > 0.3) {
      selected = undefined;
    }
    if (!selected) {
      this.draw([], POSE_EDGES);
      onStatus(
        this.framing === 'full'
          ? 'Sin torso y caderas visibles. Retrocede o selecciona Medio cuerpo.'
          : 'Sin hombros visibles. Colócate de frente y con buena luz.',
      );
      return;
    }
    this.lastCenter = selected.center;
    this.lastBodyTime = now;
    this.draw(selected.landmarks, POSE_EDGES, selected.center);
    onBody(selected.center, now);
    onStatus(
      `Siguiendo ${this.framing === 'full' ? 'torso y cadera' : 'hombros'} · ${candidates.length} persona(s) visible(s).`,
    );
  }

  private processHand(result: GestureResult, now: number) {
    const { onGesture, onStatus } = this.callbacks;
    const hands = result.landmarks ?? [];
    this.drawHands(hands);
    const aspect = (this.video?.videoWidth || 640) / (this.video?.videoHeight || 480);
    const heart = isHeart(hands, aspect);
    // With two hands, only the heart is actionable; avoid accidental single-hand commands.
    const top = hands.length === 1 ? result.gestures?.[0]?.[0] : null;
    const name = heart ? 'Heart' : top?.categoryName;
    const score = heart ? 1 : (top?.score ?? 0);
    const accepted = isGesture(name) && score >= MIN_GESTURE_SCORE;
    const changed = this.latch.update(name, score, now);

    if (accepted && this.latch.active === name && now - this.latch.since >= GESTURE_HOLD_MS) {
      const gesture = GESTURES[name];
      onGesture(name, now, Boolean(changed));
      onStatus(
        `${gesture.name} · ${name === 'Heart' ? 'geometría reconocida' : `${Math.round(score * 100)}%`} · ${gesture.motion}`,
      );
    } else if (accepted) {
      onStatus(`Mantén ${GESTURES[name].name.toLowerCase()} medio segundo…`);
    } else if (hands.length === 2) {
      onStatus('Une índices arriba y pulgares abajo para formar el corazón.');
    } else if (hands.length) {
      onStatus('Gesto no asignado. Usa palma, puño, V, índice o corazón con dos manos.');
    } else {
      onStatus('No se ve una mano. Acércala a la cámara.');
    }
  }

  private drawHands(hands: Landmark[][]) {
    this.draw([], []);
    hands.forEach((points, i) => {
      this.draw(points, HAND_EDGES, null, true, i === 0 ? '#7fe3d9' : '#ffbf86', false);
    });
  }

  private draw(
    points: Landmark[],
    edges: number[][],
    center: Vec2 | null = null,
    append = false,
    color = '#7fe3d9',
    useVisibility = true,
  ) {
    const overlay = this.overlay;
    const ctx = overlay?.getContext('2d');
    if (!overlay || !ctx) return;
    const w = this.video?.videoWidth || 640;
    const h = this.video?.videoHeight || 480;
    if (overlay.width !== w || overlay.height !== h) {
      overlay.width = w;
      overlay.height = h;
    }
    if (!append) ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 3;

    // Hand landmarks have visibility=0 in the SDK; only body landmarks use that score.
    const valid = (p: Landmark | undefined): p is Landmark =>
      !!p &&
      Number.isFinite(p.x) &&
      Number.isFinite(p.y) &&
      (!useVisibility || (p.visibility ?? 1) > 0.45);
    const previous = append ? Number(overlay.dataset.points) || 0 : 0;
    overlay.dataset.points = String(previous + points.filter(valid).length);

    for (const [a, b] of edges) {
      const from = points[a];
      const to = points[b];
      if (valid(from) && valid(to)) {
        ctx.beginPath();
        ctx.moveTo(from.x * w, from.y * h);
        ctx.lineTo(to.x * w, to.y * h);
        ctx.stroke();
      }
    }
    for (const p of points) {
      if (!valid(p)) continue;
      ctx.beginPath();
      ctx.arc(p.x * w, p.y * h, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#10202a';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
    }
    if (center) {
      ctx.strokeStyle = '#ff6579';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(center[0] * w, center[1] * h, 10, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}
