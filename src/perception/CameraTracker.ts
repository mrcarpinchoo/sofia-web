// Runs MediaPipe's hand landmarker on the webcam, recognises sofia-tracker's
// gestures and reports them through callbacks. Images are processed
// locally; nothing leaves the browser.
//
// If the camera ends while running (unplugged, taken by another program),
// it is requested again every 2 s ('reconnecting') with the model kept
// loaded, like sofia-tracker's DetectionWorker. A camera that can't be
// opened at start() is an error instead.

import type { HandLandmarker } from '@mediapipe/tasks-vision';
import type { TrackerGesture } from '../core/choreography';
import type { Vec2 } from '../core/types';
import type { EventLevel } from '../diagnostics/eventLog';
import { GESTURES } from './gestures';
import type { Landmark } from './gestures';
import { GestureRecognizer } from './handRecognizer';

export type CameraActivity = 'off' | 'loading' | 'running' | 'reconnecting';

type HandResult = ReturnType<HandLandmarker['detectForVideo']>;

export interface CameraCallbacks {
  onStatus: (message: string) => void;
  onActive: (activity: CameraActivity) => void;
  /** Smoothed palm centroid, 0-1 in the mirrored image, or null without a hand. */
  onHand: (point: Vec2 | null, time: number) => void;
  onGesture: (name: TrackerGesture, time: number) => void;
  /** Errors and recoveries, for the event log. */
  onEvent: (level: EventLevel, name: string, detail: string, action: string) => void;
}

const RETRY_MS = 2000;
const VIDEO = { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } };

// Served from public/, see scripts/fetch-assets.mjs. The same model as sofia-tracker.
const ASSETS = `${import.meta.env.BASE_URL}mediapipe`;
const MODEL = `${ASSETS}/models/hand_landmarker.task`;

const HAND_EDGES = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];
const COLOR = '#7fe3d9';

const POSTURE_NAMES = { PALM: 'palma', FIST: 'puño', INDEX: 'índice', V: 'V' };

const CAMERA_ERRORS: Record<string, string> = {
  NotAllowedError: 'Permiso denegado. Permite la cámara en el navegador y pulsa Activar cámara.',
  NotFoundError: 'No se encontró ninguna cámara conectada.',
  NotReadableError: 'La cámara está ocupada o no puede abrirse. Cierra otras aplicaciones que la usen.',
};

function timeout<T>(promise: Promise<T>, ms = 45000): Promise<T> {
  let id: ReturnType<typeof setTimeout>;
  const expired = new Promise<never>((_, reject) => {
    id = setTimeout(() => reject(new Error('La carga tardó demasiado. Intenta otra vez.')), ms);
  });
  return Promise.race([promise, expired]).finally(() => clearTimeout(id));
}

export class CameraTracker {
  running = false;
  readonly recognizer = new GestureRecognizer();

  private video: HTMLVideoElement | null = null;
  private overlay: HTMLCanvasElement | null = null;
  private readonly callbacks: CameraCallbacks;
  // Incremented by stop(), so that async work from an older start() gives up.
  private epoch = 0;
  private stream: MediaStream | null = null;
  private task: HandLandmarker | null = null;
  private frameId = 0;
  private lastFrame = -1;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

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

  async start() {
    this.stop(false);
    const video = this.video;
    if (!video) return;
    const session = this.epoch;
    const { onActive, onStatus } = this.callbacks;
    onActive('loading');
    onStatus('Esperando permiso para la cámara…');
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('El navegador no permite cámara aquí. Abre la página con HTTPS o localhost.');
      }
      const stream = await navigator.mediaDevices.getUserMedia({ video: VIDEO, audio: false });
      if (session !== this.epoch) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      await this.useStream(stream, session);
      if (session !== this.epoch) return;

      onStatus('Cargando el modelo de manos…');
      const task = await this.createTask(session);
      if (!task || session !== this.epoch) return;

      this.task = task;
      this.running = true;
      this.lastFrame = -1;
      this.recognizer.reset();
      onActive('running');
      onStatus('Muestra una mano a la cámara.');
      this.loop(session);
    } catch (error) {
      if (session !== this.epoch) return;
      this.stop(false);
      const { name, message } = error as Error;
      const text = CAMERA_ERRORS[name] ?? `No se pudo iniciar la detección. ${message} Vuelve a intentarlo.`;
      onStatus(text);
      const camera = name in CAMERA_ERRORS || !navigator.mediaDevices?.getUserMedia;
      this.callbacks.onEvent(
        'ERROR',
        camera ? 'CAMARA_NO_DISPONIBLE' : 'ERROR_DETECCION',
        `${name}: ${message}`,
        camera
          ? 'detección detenida; revisar el permiso o la cámara y pulsar Activar cámara'
          : 'detección detenida y cámara liberada; pulsar Activar cámara',
      );
    }
  }

  private async useStream(stream: MediaStream, session: number) {
    const video = this.video;
    if (!video) return;
    this.stream = stream;
    video.srcObject = stream;
    stream.getVideoTracks().forEach((track) => {
      track.onended = () => {
        if (session === this.epoch) this.lose(session);
      };
    });
    await timeout(video.play(), 12000);
  }

  /** The camera ended while running: request it again every RETRY_MS. */
  private lose(session: number) {
    const { onActive, onEvent, onHand, onStatus } = this.callbacks;
    if (!this.running) {
      // Ended while the model was loading: a failed start
      this.stop(false);
      onStatus('La cámara se desconectó. Vuelve a activarla.');
      onEvent('ERROR', 'CAMARA_NO_DISPONIBLE', 'la pista de video terminó al iniciar', 'pulsar Activar cámara');
      return;
    }
    this.running = false;
    cancelAnimationFrame(this.frameId);
    this.releaseStream();
    this.draw([]);
    this.recognizer.reset();
    onHand(null, performance.now());
    onActive('reconnecting');
    onStatus('La cámara se desconectó. Reintentando cada 2 s…');
    onEvent('ERROR', 'CAMARA_PERDIDA', 'la pista de video terminó', `se pide la cámara de nuevo cada ${RETRY_MS / 1000} s`);

    const lostAt = performance.now();
    let attempts = 0;
    const retry = async () => {
      this.retryTimer = null;
      if (session !== this.epoch) return;
      attempts++;
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: VIDEO, audio: false });
      } catch {
        if (session === this.epoch) this.retryTimer = setTimeout(retry, RETRY_MS);
        return;
      }
      if (session !== this.epoch) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      try {
        await this.useStream(stream, session);
      } catch {
        this.releaseStream();
        if (session === this.epoch) this.retryTimer = setTimeout(retry, RETRY_MS);
        return;
      }
      if (session !== this.epoch || !this.task) return;
      this.running = true;
      this.lastFrame = -1;
      this.recognizer.reset(); // the hand moved while the camera was gone
      onActive('running');
      onStatus('Cámara recuperada. Muestra una mano a la cámara.');
      onEvent(
        'INFO',
        'CAMARA_RECUPERADA',
        `cámara reabierta tras ${((performance.now() - lostAt) / 1000).toFixed(1)} s (${attempts} intentos)`,
        'se reanuda la detección con el historial de gestos reiniciado',
      );
      this.loop(session);
    };
    this.retryTimer = setTimeout(retry, RETRY_MS);
  }

  private releaseStream() {
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
  }

  stop(announce = true) {
    this.epoch++;
    this.running = false;
    cancelAnimationFrame(this.frameId);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.releaseStream();
    this.task?.close();
    this.task = null;
    if (this.overlay) {
      this.overlay.getContext('2d')?.clearRect(0, 0, this.overlay.width, this.overlay.height);
    }
    this.recognizer.reset();
    this.callbacks.onActive('off');
    if (announce) this.callbacks.onStatus('Cámara apagada. Los paneles conservan la última pose.');
  }

  private async createTask(session: number) {
    const vision = await timeout(import('@mediapipe/tasks-vision'));
    if (session !== this.epoch) return null;
    const files = await timeout(vision.FilesetResolver.forVisionTasks(`${ASSETS}/wasm`));
    if (session !== this.epoch) return null;

    // Same settings as sofia-tracker's detection.py
    const loading = vision.HandLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: MODEL, delegate: 'CPU' },
      runningMode: 'VIDEO',
      numHands: 1,
      minHandDetectionConfidence: 0.6,
      minTrackingConfidence: 0.6,
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

  /**
   * Detects on every new video frame, like sofia-tracker: its recognizer
   * counts frames (majority vote, GRAB).
   */
  private loop(session: number) {
    if (!this.running || session !== this.epoch) return;
    const video = this.video;
    const now = performance.now();
    if (
      video &&
      this.task &&
      video.readyState >= 2 &&
      video.videoWidth &&
      video.currentTime !== this.lastFrame
    ) {
      this.lastFrame = video.currentTime;
      try {
        this.process(this.task.detectForVideo(video, now), now);
      } catch (error) {
        this.stop(false);
        const { message } = error as Error;
        this.callbacks.onStatus(`La detección se detuvo: ${message}. Puedes volver a activar la cámara.`);
        this.callbacks.onEvent(
          'ERROR',
          'ERROR_DETECCION',
          message,
          'detección detenida y cámara liberada; pulsar Activar cámara',
        );
        return;
      }
    }
    this.frameId = requestAnimationFrame(() => this.loop(session));
  }

  private process(result: HandResult, now: number) {
    const { onGesture, onHand, onStatus } = this.callbacks;
    const hand = result.landmarks?.[0];
    this.draw(hand ?? []);
    if (!hand) {
      this.recognizer.reset(); // also clears the smoothing, as in sofia-tracker
      onHand(null, now);
      onStatus('No se ve una mano. Acércala a la cámara.');
      return;
    }

    // sofia-tracker mirrors the frame before detecting, so mirror the
    // landmarks: the same hand gives the same postures, swipes and target.
    const w = this.video?.videoWidth || 640;
    const h = this.video?.videoHeight || 480;
    const mirrored = hand.map((p) => ({ x: 1 - p.x, y: p.y }));
    const { posture, event } = this.recognizer.update(mirrored, now / 1000, w, h);
    const centroid = this.recognizer.centroid;
    if (centroid) onHand([centroid[0] / w, centroid[1] / h], now);
    if (event) {
      onGesture(event, now);
      onStatus(`${GESTURES[event].name} → ${GESTURES[event].motion}`);
    } else {
      onStatus(posture ? `Postura: ${POSTURE_NAMES[posture]}. Siguiendo la mano.` : 'Siguiendo la mano.');
    }
  }

  /** Draws the hand's skeleton in image coordinates (the preview mirrors it). */
  private draw(points: Landmark[]) {
    const overlay = this.overlay;
    const ctx = overlay?.getContext('2d');
    if (!overlay || !ctx) return;
    const w = this.video?.videoWidth || 640;
    const h = this.video?.videoHeight || 480;
    if (overlay.width !== w || overlay.height !== h) {
      overlay.width = w;
      overlay.height = h;
    }
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = COLOR;
    ctx.fillStyle = COLOR;
    ctx.lineWidth = 3;

    const valid = (p: Landmark | undefined): p is Landmark =>
      !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
    overlay.dataset.points = String(points.filter(valid).length);

    for (const [a, b] of HAND_EDGES) {
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
      ctx.strokeStyle = COLOR;
      ctx.lineWidth = 3;
    }
  }
}
