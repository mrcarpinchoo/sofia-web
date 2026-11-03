import { useEffect, useRef } from 'react';
import { RAD } from '../../core/math';
import type { HistorySample } from '../../simulation/Simulation';
import { engine } from '../../state/store';
import type { Telemetry } from '../../simulation/LabEngine';

const WINDOW_SECONDS = 12;
const MIN_RANGE = 90;

function draw(canvas: HTMLCanvasElement, history: HistorySample[]) {
  const dpr = Math.min(devicePixelRatio, 2);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx || !w || !h) return;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const left = 28;
  const right = w - 3;
  const top = 5;
  const bottom = h - 14;
  const middle = (top + bottom) / 2;
  const range = Math.max(
    MIN_RANGE,
    ...history.flatMap((v) => [...v.q, ...v.raw].map((x) => Math.abs(x / RAD))),
  );

  ctx.font = '9px ui-monospace,monospace';
  ctx.fillStyle = '#71869e';
  ctx.strokeStyle = '#2c3b4d';
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  for (const [value, y] of [
    [range, top],
    [0, middle],
    [-range, bottom],
  ]) {
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();
    ctx.fillText(String(Math.round(value)), 0, y + 3);
  }
  ctx.fillText(`−${WINDOW_SECONDS} s`, left, h - 1);
  ctx.fillText('0', w - 10, h - 1);
  if (!history.length) return;

  const now = history[history.length - 1].t;
  for (let joint = 0; joint < 2; joint++) {
    for (const raw of [true, false]) {
      ctx.strokeStyle = joint ? '#b3a6ff' : '#7fe3d9';
      ctx.globalAlpha = raw ? 0.42 : 1;
      ctx.lineWidth = raw ? 1 : 1.7;
      ctx.setLineDash(raw ? [3, 3] : []);
      ctx.beginPath();
      history.forEach((sample, i) => {
        const x = right + ((sample.t - now) / WINDOW_SECONDS) * (right - left);
        const angle = (raw ? sample.raw[joint] : sample.q[joint]) / RAD;
        const y = middle - (angle / range) * ((bottom - top) / 2);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
}

/** Redraws on every telemetry update. */
export function AngleChart({ telemetry }: { telemetry: Telemetry }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvas.current) draw(canvas.current, engine.sim.history);
  }, [telemetry]);

  return (
    <canvas
      ref={canvas}
      className="mt-4 block h-21 w-full wide:h-26.25 short:h-11.25 compact:mt-2 compact:h-15"
      aria-label="Gráfica de ángulos solicitados y filtrados de la unidad seleccionada"
    />
  );
}
