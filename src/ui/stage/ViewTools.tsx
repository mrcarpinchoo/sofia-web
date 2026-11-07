import type { ViewName } from '../../scene/SofiaScene';
import { engine, useLab } from '../../state/store';

const VIEWS: { value: ViewName; label: string }[] = [
  { value: 'front', label: 'Frontal' },
  { value: 'iso', label: 'Perspectiva' },
  { value: 'single', label: 'Una unidad' },
];

const BUTTON =
  'bg-[#172333dd] text-12 text-[#aebdd0] aria-pressed:border-[#7fe3d966] aria-pressed:text-accent  ';

export function ViewTools() {
  const view = useLab((s) => s.view);
  const setView = useLab((s) => s.setView);

  return (
    <div
      className="absolute top-18 left-6 flex gap-[5px] medium:left-4"
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
