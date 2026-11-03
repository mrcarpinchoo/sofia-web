import type { ViewName } from '../../scene/SofiaScene';
import { engine, useLab } from '../../state/store';

const VIEWS: { value: ViewName; label: string }[] = [
  { value: 'front', label: 'Frontal' },
  { value: 'iso', label: 'Perspectiva' },
  { value: 'single', label: 'Una unidad' },
];

const BUTTON =
  'bg-[#172333dd] text-12 text-[#aebdd0] aria-pressed:border-[#7fe3d966] aria-pressed:text-accent compact:px-2.25 compact:py-1';

export function ViewTools() {
  const view = useLab((s) => s.view);
  const setView = useLab((s) => s.setView);

  return (
    <div
      className="absolute top-18 left-6 flex gap-[5px] medium:left-4 compact:top-15.5 compact:right-3 compact:left-3 compact:flex-wrap compact:gap-1"
      role="group"
      aria-label="Vista de la simulación"
    >
      {VIEWS.map(({ value, label }) => (
        <button
          key={value}
          className={BUTTON}
          aria-pressed={value === view}
          onClick={() => setView(value)}
        >
          {label}
        </button>
      ))}
      <button className={BUTTON} aria-label="Acercar" onClick={() => engine.zoom(0.85)}>
        +
      </button>
      <button className={BUTTON} aria-label="Alejar" onClick={() => engine.zoom(1.15)}>
        −
      </button>
    </div>
  );
}
