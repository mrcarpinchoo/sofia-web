import { useState } from 'react';
import { engine, useLab } from '../../state/store';
import { AngleChart } from './AngleChart';
import { useTelemetry } from './useTelemetry';

const UNIT_COUNT = 16;

function Reading({ label, value, digits }: { label: string; value: number | null; digits: number }) {
  return (
    <div>
      <span className="block text-12 text-muted compact:text-11 compact:whitespace-nowrap">
        {label}
      </span>
      <strong className="mt-1.5 block font-mono text-24 font-normal tracking-[-.03em] medium:text-21 short:text-19 compact:mt-px compact:text-15">
        {value === null ? (
          '—'
        ) : (
          <>
            {value.toFixed(digits)}
            <small className="ml-[3px] text-15 text-[#72839a] compact:text-11">°</small>
          </>
        )}
      </strong>
    </div>
  );
}

export function TelemetryCard() {
  const selected = useLab((s) => s.selected);
  const select = useLab((s) => s.select);
  const controlsOpen = useLab((s) => s.controlsOpen);
  const telemetry = useTelemetry();
  // Only small screens can collapse it. Collapsed it's a single row, so the
  // panel stays visible above the sheet.
  const [expanded, setExpanded] = useState(false);
  const collapsed = !expanded;

  return (
    <div
      className={`pointer-events-auto absolute right-6 bottom-23.5 w-82.5 rounded-xl border border-[#344152] bg-[#131c29ec] px-4.5 py-4 shadow-[0_12px_40px_#0003] wide:bottom-25 wide:w-[355px] medium:right-4 medium:bottom-25.5 medium:w-71.5 short:right-3 short:bottom-23.75 short:p-3 compact:right-3 compact:left-3 compact:w-auto compact:pt-1 compact:pr-2 compact:pb-1 compact:pl-3 ${controlsOpen ? 'compact:bottom-2.5' : 'compact:bottom-7'} ${collapsed ? 'compact:flex compact:items-center compact:gap-2' : ''}`}
    >
      <div
        className={`mb-4 flex items-center gap-2.25 short:mb-2 compact:mb-1.5 ${collapsed ? 'compact:contents' : ''}`}
      >
        <label
          className={`m-0 text-11 tracking-[.13em] text-[#8f9fb1] ${collapsed ? 'compact:hidden' : ''}`}
          htmlFor="unit"
        >
          UNIDAD
        </label>
        <select
          className="min-h-7 w-16 px-1.25 py-[3px] font-mono text-12 compact:min-h-9 compact:w-18 compact:text-16"
          id="unit"
          aria-label="Unidad para inspeccionar"
          value={selected}
          onChange={(event) => select(Number(event.target.value))}
        >
          {Array.from({ length: UNIT_COUNT }, (_, i) => (
            <option key={i} value={i}>
              {String(i + 1).padStart(2, '0')}
            </option>
          ))}
        </select>
        <span
          className={`ml-auto text-12 compact:ml-0 ${telemetry.unreachable ? 'text-[#ffbd88]' : 'text-accent'} ${collapsed ? 'compact:hidden' : ''}`}
        >
          {telemetry.unitState}
        </span>
        <button
          className="hidden compact:order-1 compact:ml-auto compact:block compact:w-8 compact:flex-none compact:border-0 compact:bg-transparent compact:p-0 compact:text-15 compact:text-muted"
          aria-expanded={expanded}
          aria-label={expanded ? 'Ocultar gráfica' : 'Mostrar gráfica'}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? '▾' : '▴'}
        </button>
      </div>
      <div
        className={`grid grid-cols-[1fr_1fr_1.1fr] gap-2.5 ${collapsed ? 'compact:flex-1 compact:gap-1' : ''}`}
      >
        <Reading label="Giro q₁" value={telemetry.q1} digits={1} />
        <Reading label="Giro q₂" value={telemetry.q2} digits={1} />
        <Reading label="Error angular" value={telemetry.error} digits={2} />
      </div>
      <div className={collapsed ? 'compact:hidden' : undefined}>
        <AngleChart telemetry={telemetry} />
        <div className="flex gap-3.5 text-11 text-[#8f9fb1]">
          <span className="text-accent">q₁</span>
          <span className="text-[#b3a6ff]">q₂</span>
          <span className="ml-auto">— filtrado &nbsp; ┄ objetivo</span>
        </div>
        <div className="mt-3.5 flex items-center justify-between gap-1 border-t border-[#2b3849] pt-2.5 text-11 text-[#9dacc0] short:mt-2 short:pt-1.5 compact:mt-2 compact:pt-1">
          <span>
            {telemetry.inReach} / {UNIT_COUNT} en alcance
          </span>
          <button
            className="min-h-6.5 border-0 bg-transparent p-0 text-12 text-muted hover:bg-control-hover"
            onClick={() => engine.exportCsv()}
          >
            Exportar datos ↓
          </button>
        </div>
      </div>
    </div>
  );
}
