// sofia-tracker's gesture recognizer (gestures.py), ported line for line so
// both programs recognise the same gestures from the same hand: keep them in
// step. It classifies the 21 hand landmarks into postures (PALM, FIST,
// INDEX, V) and fires the six SOFIA gestures:
//
//   static  : INDEX, V, PALM (held still for 0.5 s)
//   dynamic : SWIPE_LEFT / SWIPE_RIGHT, GRAB (open palm -> fist)
//
// Points are in pixels of the mirrored image; distances are compared against
// the palm width, so thresholds don't depend on the distance to the camera.

import type { TrackerGesture } from '../core/choreography';

export type Posture = 'PALM' | 'FIST' | 'INDEX' | 'V';
type Point = [number, number];

// Config (same names and values as gestures.py)
const FINGER_EXT_RATIO = 1.15; // tip must be this much farther from wrist than PIP
const THUMB_EXT_RATIO = 1.1; // thumb tip vs IP distance to pinky MCP
const DEBOUNCE_FRAMES = 5; // majority vote window for the posture label

const LANDMARK_ALPHA = 0.5; // EMA on the 21 landmarks (1 = no smoothing)
const CENTROID_ALPHA = 0.35; // EMA on the palm centroid (1 = no smoothing)

const HOLD_TIME = 0.5; // s a static posture must be held
const STILL_RATIO = 0.3; // max displacement during hold (x palm width)
const STATIC_COOLDOWN = 2.0; // s before the same static posture can re-fire

const SWIPE_WINDOW = 0.4; // s
const SWIPE_RATIO = 2.5; // min |dx| (x palm width)
const SWIPE_COOLDOWN = 1.0; // s

const GRAB_WINDOW = 0.6; // s: PALM must have been seen this recently
const GRAB_FIST_FRAMES = 3; // consecutive raw FIST frames
const GRAB_COOLDOWN = 1.0; // s

const HISTORY_SECONDS = 1.0; // must be >= HOLD_TIME, SWIPE_WINDOW and GRAB_WINDOW

const WRIST = 0;
const FINGERS: Record<'index' | 'middle' | 'ring' | 'pinky', [number, number]> = {
  index: [8, 6],
  middle: [12, 10],
  ring: [16, 14],
  pinky: [20, 18],
};
const THUMB_TIP = 4;
const THUMB_IP = 3;
const INDEX_MCP = 5;
const PINKY_MCP = 17;
const PALM_LANDMARK_IDS = [0, 5, 9, 17];

const STATIC_POSTURES = ['INDEX', 'V', 'PALM'] as const;
type StaticPosture = (typeof STATIC_POSTURES)[number];
const isStatic = (p: Posture | null): p is StaticPosture =>
  (STATIC_POSTURES as readonly (Posture | null)[]).includes(p);

export type Extended = Record<'index' | 'middle' | 'ring' | 'pinky' | 'thumb', boolean>;

// Same arithmetic as numpy's norm of a 2-vector, so results match exactly.
const dist = (a: Point, b: Point) => {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return Math.sqrt(dx * dx + dy * dy);
};

/** Exponential moving average: s_t = a*x_t + (1-a)*s_{t-1}. */
class EmaFilter<T extends Point | Point[]> {
  value: T | null = null;
  constructor(private readonly alpha: number) {}

  update(next: T): T {
    if (this.value === null) {
      this.value = next;
    } else {
      const a = this.alpha;
      const mix = (x: Point, s: Point): Point => [a * x[0] + (1 - a) * s[0], a * x[1] + (1 - a) * s[1]];
      this.value = (
        typeof next[0] === 'number'
          ? mix(next as Point, this.value as Point)
          : (next as Point[]).map((p, i) => mix(p, (this.value as Point[])[i]))
      ) as T;
    }
    return this.value;
  }

  reset() {
    this.value = null;
  }
}

/** Per-finger extended flags from pixel landmarks (rotation invariant). */
export function fingerExtended(pts: Point[]): Extended {
  const extended = (name: keyof typeof FINGERS) => {
    const [tip, pip] = FINGERS[name];
    return dist(pts[WRIST], pts[tip]) > dist(pts[WRIST], pts[pip]) * FINGER_EXT_RATIO;
  };
  return {
    index: extended('index'),
    middle: extended('middle'),
    ring: extended('ring'),
    pinky: extended('pinky'),
    thumb: dist(pts[THUMB_TIP], pts[PINKY_MCP]) > dist(pts[THUMB_IP], pts[PINKY_MCP]) * THUMB_EXT_RATIO,
  };
}

/** Map finger flags to INDEX / V / PALM / FIST, or null if unknown. */
export function classifyPosture(ext: Extended): Posture | null {
  const { index: i, middle: m, ring: r, pinky: p, thumb: t } = ext;
  if (i && m && r && p && t) return 'PALM';
  if (!(i || m || r || p)) return 'FIST';
  if (i && !(m || r || p)) return 'INDEX';
  if (i && m && !(r || p)) return 'V';
  return null;
}

interface HistoryEntry {
  t: number;
  centroid: Point;
  posture: Posture | null;
  palmWidth: number;
}

export interface Recognition {
  posture: Posture | null;
  event: TrackerGesture | null;
}

/** Turns a stream of landmarks into (posture, event) pairs. */
export class GestureRecognizer {
  extended: Extended | null = null;
  rawCentroid: Point | null = null; // unfiltered palm centroid (px)
  centroid: Point | null = null; // smoothed palm centroid (px)

  private readonly landmarkFilter: EmaFilter<Point[]>;
  private readonly centroidFilter: EmaFilter<Point>;
  private history: HistoryEntry[] = [];
  private raw: (Posture | null)[] = [];
  private blockedUntil = 0;
  private staticArmed = true;
  private lastStatic: Posture | null = null;
  private lastStaticTime = -1e9;

  constructor(readonly smoothing = true) {
    this.landmarkFilter = new EmaFilter(smoothing ? LANDMARK_ALPHA : 1);
    this.centroidFilter = new EmaFilter(smoothing ? CENTROID_ALPHA : 1);
  }

  reset() {
    this.history = [];
    this.raw = [];
    this.extended = null;
    this.rawCentroid = null;
    this.centroid = null;
    this.blockedUntil = 0;
    this.staticArmed = true;
    this.lastStatic = null;
    this.lastStaticTime = -1e9;
    this.landmarkFilter.reset();
    this.centroidFilter.reset();
  }

  private debounced(): Posture | null {
    // Majority vote; ties can't reach a majority, so their order doesn't matter.
    const counts = new Map<Posture | null, number>();
    for (const label of this.raw) counts.set(label, (counts.get(label) ?? 0) + 1);
    let best: Posture | null = null;
    let bestCount = 0;
    for (const [label, count] of counts) {
      if (count > bestCount) {
        best = label;
        bestCount = count;
      }
    }
    return bestCount > Math.floor(this.raw.length / 2) ? best : null;
  }

  private fire(event: TrackerGesture, t: number, cooldown: number) {
    this.blockedUntil = t + cooldown;
    this.history = [];
    return event;
  }

  /**
   * `landmarks`: the 21 points normalised to 0-1, in the mirrored image.
   * `t`: time in seconds. `w`, `h`: image size in pixels.
   */
  update(landmarks: readonly { x: number; y: number }[], t: number, w: number, h: number): Recognition {
    const rawPts = landmarks.map((lm): Point => [lm.x * w, lm.y * h]);
    const pts = this.landmarkFilter.update(rawPts);
    this.extended = fingerExtended(pts);
    const rawPosture = classifyPosture(this.extended);
    this.raw.push(rawPosture);
    if (this.raw.length > DEBOUNCE_FRAMES) this.raw.shift();
    const posture = this.debounced();

    const palm = PALM_LANDMARK_IDS.map((i) => rawPts[i]);
    this.rawCentroid = [
      (palm[0][0] + palm[1][0] + palm[2][0] + palm[3][0]) / 4,
      (palm[0][1] + palm[1][1] + palm[2][1] + palm[3][1]) / 4,
    ];
    const centroid = this.centroidFilter.update(this.rawCentroid);
    this.centroid = centroid;
    const palmWidth = Math.max(dist(pts[INDEX_MCP], pts[PINKY_MCP]), 1.0);

    this.history.push({ t, centroid, posture, palmWidth });
    while (this.history.length && t - this.history[0].t > HISTORY_SECONDS) this.history.shift();

    if (posture !== this.lastStatic) this.staticArmed = true;

    if (t < this.blockedUntil) return { posture, event: null };

    // Swipe: large, mostly horizontal displacement in a short window
    const window = this.history.filter((e) => t - e.t <= SWIPE_WINDOW);
    const dx = centroid[0] - window[0].centroid[0];
    const dy = centroid[1] - window[0].centroid[1];
    if (Math.abs(dx) > SWIPE_RATIO * palmWidth && Math.abs(dx) > 2 * Math.abs(dy)) {
      const event = dx > 0 ? 'SWIPE_RIGHT' : 'SWIPE_LEFT';
      return { posture, event: this.fire(event, t, SWIPE_COOLDOWN) };
    }

    // Grab: recent open palm, now a sustained fist
    const fistNow =
      this.raw.length >= GRAB_FIST_FRAMES &&
      this.raw.slice(-GRAB_FIST_FRAMES).every((p) => p === 'FIST');
    const palmRecent = this.history.some((e) => t - e.t <= GRAB_WINDOW && e.posture === 'PALM');
    if (fistNow && palmRecent) return { posture, event: this.fire('GRAB', t, GRAB_COOLDOWN) };

    // Static: same posture held still for HOLD_TIME
    if (isStatic(posture) && this.staticArmed) {
      const hold = this.history.filter((e) => t - e.t <= HOLD_TIME);
      const spansHold = t - this.history[0].t >= HOLD_TIME;
      const same = hold.every((e) => e.posture === posture);
      const still = hold.every((e) => dist(centroid, e.centroid) < STILL_RATIO * palmWidth);
      const cooled = posture !== this.lastStatic || t - this.lastStaticTime >= STATIC_COOLDOWN;
      if (spansHold && same && still && cooled) {
        this.staticArmed = false;
        this.lastStatic = posture;
        this.lastStaticTime = t;
        return { posture, event: posture };
      }
    }

    return { posture, event: null };
  }
}
