// Selectable filters applied to each joint angle. Each one is a discrete
// update of the joint's output `y` towards the reference `r`.

import { RAD, clamp } from './math';
import type { Vec2 } from './types';

export type FilterType =
  | 'none'
  | 'ema'
  | 'mean'
  | 'butter'
  | 'median'
  | 'rate'
  | 'trapezoid'
  | 'scurve'
  | 'spring'
  | 'pd';

export interface FilterParams {
  tau: number;
  meanWindow: number;
  medianWindow: number;
  cutoff: number;
  velocity: number;
  acceleration: number;
  duration: number;
  omega: number;
  zeta: number;
}

export type FilterParam = keyof FilterParams;

// Defaults reproduce the timing of the filters session. Its controllers run at
// 32 ms and this simulation at 1/120 s, so settings counted in samples are
// converted to keep the same duration.
export const DEFAULT_FILTER_PARAMS: FilterParams = {
  tau: 0.62, // alpha = 0.05 at 32 ms
  meanWindow: 58, // N = 15 at 32 ms
  medianWindow: 35, // N = 9 at 32 ms
  cutoff: 0.6,
  velocity: 300 * RAD, // half the MG90S top speed of 0.1 s/60°
  acceleration: 6,
  duration: 1,
  omega: 6,
  zeta: 1,
};

export const FILTER_HINTS: Record<FilterType, string> = {
  none: 'Seguimiento cinemático ideal e instantáneo.',
  ema: 'Suaviza la referencia. Mayor τ produce más retraso.',
  mean: 'Promedio de las últimas N muestras a 120 Hz.',
  butter: 'Paso bajo de segundo orden. Puede presentar sobreimpulso.',
  median: 'Elimina picos. Ante escalones produce retardo, no una rampa suave.',
  rate: 'Limita la velocidad angular del comando.',
  trapezoid: 'Segmentos de reposo a reposo. El objetivo se toma al iniciar cada segmento.',
  scurve: 'Transición quíntica de reposo a reposo. El objetivo se toma al iniciar cada segmento.',
  spring: 'Sistema de segundo orden. ζ controla el amortiguamiento.',
  pd: 'Equivalente al resorte: Kp = ωn² y Kd = 2ζωn. No usa mediciones del servo.',
};

/** Rest-to-rest move in progress (trapezoid and S-curve). */
interface Segment {
  start: number;
  delta: number;
  distance: number;
  accelTime: number;
  peakVelocity: number;
  cruiseTime: number;
  total: number;
  t: number;
}

export class JointFilter {
  private y = 0;
  private v = 0;
  private history: number[] = [];
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  private segment: Segment | null = null;

  constructor(value = 0) {
    this.reset(value);
  }

  reset(value: number) {
    this.y = value;
    this.v = 0;
    this.history = [];
    this.x1 = this.x2 = this.y1 = this.y2 = value;
    this.segment = null;
  }

  step(r: number, dt: number, type: FilterType, p: FilterParams, limits: Vec2): number {
    let y = this.y;
    switch (type) {
      case 'none':
        y = r;
        break;
      case 'ema':
        y += (1 - Math.exp(-dt / p.tau)) * (r - y);
        break;
      case 'mean':
      case 'median':
        y = this.window(r, y, type, type === 'mean' ? p.meanWindow : p.medianWindow);
        break;
      case 'butter':
        y = this.butterworth(r, p.cutoff, dt, limits);
        break;
      case 'rate':
        y += clamp(r - y, -p.velocity * dt, p.velocity * dt);
        break;
      case 'trapezoid':
      case 'scurve':
        y = this.profile(r, y, dt, type, p);
        break;
      case 'spring':
      case 'pd': {
        const a = p.omega * p.omega * (r - y) - 2 * p.zeta * p.omega * this.v;
        this.v += a * dt;
        y += this.v * dt;
        break;
      }
    }
    const bounded = clamp(y, ...limits);
    if (bounded !== y) {
      this.v = 0;
      this.segment = null;
    }
    this.y = bounded;
    return bounded;
  }

  private window(r: number, y: number, type: 'mean' | 'median', size: number) {
    const N = type === 'median' ? (size % 2 ? size : size + 1) : size;
    if (!this.history.length) this.history = Array<number>(N).fill(y);
    this.history.push(r);
    while (this.history.length > N) this.history.shift();
    if (type === 'mean') return this.history.reduce((a, b) => a + b, 0) / this.history.length;
    return [...this.history].sort((a, b) => a - b)[Math.floor(this.history.length / 2)];
  }

  private butterworth(r: number, cutoff: number, dt: number, limits: Vec2) {
    const w = 2 * Math.PI * cutoff * dt;
    const c = Math.cos(w);
    const s = Math.sin(w);
    const alpha = s / Math.sqrt(2);
    const a0 = 1 + alpha;
    const b0 = (1 - c) / 2 / a0;
    const b1 = (1 - c) / a0;
    const a1 = (-2 * c) / a0;
    const a2 = (1 - alpha) / a0;
    const y = b0 * r + b1 * this.x1 + b0 * this.x2 - a1 * this.y1 - a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = r;
    this.y2 = this.y1;
    this.y1 = clamp(y, ...limits);
    return y;
  }

  private profile(r: number, y: number, dt: number, type: 'trapezoid' | 'scurve', p: FilterParams) {
    const acceleration = p.acceleration;
    if (!this.segment) {
      const delta = r - y;
      const distance = Math.abs(delta);
      if (distance < 1e-9) return r;
      const accelTime = Math.min(p.velocity / acceleration, Math.sqrt(distance / acceleration));
      const peakVelocity = acceleration * accelTime;
      const cruiseTime = Math.max(0, (distance - acceleration * accelTime * accelTime) / peakVelocity);
      this.segment = {
        start: y,
        delta,
        distance,
        accelTime,
        peakVelocity,
        cruiseTime,
        total: type === 'scurve' ? p.duration : 2 * accelTime + cruiseTime,
        t: 0,
      };
    }
    const g = this.segment;
    g.t = Math.min(g.total, g.t + dt);
    let result: number;
    if (type === 'scurve') {
      const u = g.t / g.total;
      result = g.start + g.delta * (10 * u ** 3 - 15 * u ** 4 + 6 * u ** 5);
    } else {
      const t = g.t;
      const x =
        t < g.accelTime
          ? 0.5 * acceleration * t * t
          : t < g.accelTime + g.cruiseTime
            ? 0.5 * acceleration * g.accelTime * g.accelTime + g.peakVelocity * (t - g.accelTime)
            : g.distance - 0.5 * acceleration * (g.total - t) ** 2;
      result = g.start + Math.sign(g.delta) * x;
    }
    if (g.t >= g.total) this.segment = null;
    return result;
  }
}
