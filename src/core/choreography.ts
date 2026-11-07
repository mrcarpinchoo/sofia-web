// The SOFIA motion played for each of sofia-tracker's gestures. A copy of
// sofia-firmware/src/choreography.cpp, so the simulation moves like the real
// panel: keep both in step. Every motion starts and ends at rest and stays
// within ±30°. Directions are in the panel frame: +x is the viewer's right
// and +y is up, for a viewer in front of the panel. Angles in rad.

import { clamp } from './math';
import type { JointAngles, PanelModule } from './types';

export type TrackerGesture = 'INDEX' | 'V' | 'PALM' | 'SWIPE_LEFT' | 'SWIPE_RIGHT' | 'GRAB';

const DEG = Math.PI / 180;
const LIMIT_DEG = 30;

interface Key {
  t: number;
  value: number;
}

// Look up/down and right/left.
const LOOK_DEG = 25;
const LOOK: Key[] = [
  { t: 0, value: 0 },
  { t: 0.7, value: LOOK_DEG },
  { t: 1.9, value: -LOOK_DEG },
  { t: 2.6, value: 0 },
];

// Horizontal 8 (lemniscate), one loop.
const EIGHT_SECONDS = 4;
const EIGHT_YAW_DEG = 25;
const EIGHT_PITCH_DEG = 12;

// Sweeping wave: a pulse of yaw that travels across the panel.
const WAVE_DEG = 20;
const WAVE_WIDTH_MM = 110;
const WAVE_SPEED_MM_S = 600;
const WAVE_START_MM = 600;
const WAVE_SECONDS = (2 * WAVE_START_MM) / WAVE_SPEED_MM_S;

// Flinch: tilt down quickly, hold, ease back to rest.
const FLINCH_DEG = -15;
const FLINCH: Key[] = [
  { t: 0, value: 0 },
  { t: 0.15, value: FLINCH_DEG },
  { t: 0.35, value: FLINCH_DEG },
  { t: 1.35, value: 0 },
];

/** Smooth step from 0 to 1 with zero speed at both ends. */
function ease(u: number) {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  return 0.5 - 0.5 * Math.cos(Math.PI * u);
}

function keyframes(keys: Key[], t: number) {
  for (let i = 1; i < keys.length; i++) {
    if (t < keys[i].t) {
      const u = (t - keys[i - 1].t) / (keys[i].t - keys[i - 1].t);
      return keys[i - 1].value + (keys[i].value - keys[i - 1].value) * ease(u);
    }
  }
  return keys[keys.length - 1].value;
}

/**
 * Angles that point a module along yaw (towards +x) and pitch (towards +y),
 * in degrees, as if the target were infinitely far away. Same equations as
 * inverse() in kinematics.ts.
 */
export function aim(yawDeg: number, pitchDeg: number): JointAngles {
  const x = Math.tan(yawDeg * DEG);
  const y = Math.tan(pitchDeg * DEG);
  const n = Math.hypot(x, y, 1);
  const limit = (q: number) => clamp(q, -LIMIT_DEG * DEG, LIMIT_DEG * DEG);
  return [limit(Math.atan2(-y / n, 1 / n)), limit(Math.asin(x / n))];
}

export function duration(gesture: TrackerGesture): number {
  switch (gesture) {
    case 'INDEX':
    case 'PALM':
      return LOOK[LOOK.length - 1].t;
    case 'V':
      return EIGHT_SECONDS;
    case 'SWIPE_LEFT':
    case 'SWIPE_RIGHT':
      return WAVE_SECONDS;
    case 'GRAB':
      return FLINCH[FLINCH.length - 1].t;
  }
}

function wave(modules: readonly PanelModule[], t: number, direction: number): JointAngles[] {
  const center = direction * (-WAVE_START_MM + WAVE_SPEED_MM_S * t);
  return modules.map((module) => {
    const z = (module.base[0] - center) / WAVE_WIDTH_MM;
    return aim(direction * WAVE_DEG * Math.exp(-z * z), 0);
  });
}

/**
 * Every module's joint angles `t` seconds after the gesture started. For
 * t >= duration() it returns the rest pose.
 */
export function sample(
  gesture: TrackerGesture,
  t: number,
  modules: readonly PanelModule[],
): JointAngles[] {
  const all = (q: JointAngles) => modules.map((): JointAngles => [...q]);
  if (t >= duration(gesture)) return all(aim(0, 0));
  switch (gesture) {
    case 'INDEX':
      return all(aim(0, keyframes(LOOK, t)));
    case 'PALM':
      return all(aim(keyframes(LOOK, t), 0));
    case 'V': {
      const phi = 2 * Math.PI * ease(t / EIGHT_SECONDS);
      return all(aim(EIGHT_YAW_DEG * Math.sin(phi), EIGHT_PITCH_DEG * Math.sin(2 * phi)));
    }
    case 'SWIPE_LEFT':
      return wave(modules, t, -1);
    case 'SWIPE_RIGHT':
      return wave(modules, t, 1);
    case 'GRAB':
      return all(aim(0, keyframes(FLINCH, t)));
  }
}
