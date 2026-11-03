import { FILTER_HINTS } from '../../core/filters';
import type { FilterParam, FilterType } from '../../core/filters';
import { RAD } from '../../core/math';
import { useLab } from '../../state/store';
import { Check } from '../common/Check';
import { Hint } from '../common/Hint';
import { RangeField } from '../common/RangeField';
import { Section } from '../common/Section';

const FILTERS: { value: FilterType; label: string }[] = [
  { value: 'none', label: 'Sin filtro · ideal' },
  { value: 'ema', label: 'Exponencial · EMA' },
  { value: 'mean', label: 'Media móvil' },
  { value: 'butter', label: 'Butterworth · 2.º orden' },
  { value: 'median', label: 'Mediana' },
  { value: 'rate', label: 'Limitador de velocidad' },
  { value: 'trapezoid', label: 'Perfil trapezoidal' },
  { value: 'scurve', label: 'Perfil en S' },
  { value: 'spring', label: 'Resorte amortiguado' },
  { value: 'pd', label: 'PD como suavizador' },
];

interface ParamDefinition {
  label: string;
  min: number;
  max: number;
  step: number;
  suffix: string;
  digits: number;
}

const PARAMS: Record<FilterParam, ParamDefinition> = {
  tau: { label: 'Constante τ', min: 0.03, max: 2, step: 0.01, suffix: ' s', digits: 2 },
  meanWindow: { label: 'Ventana N', min: 3, max: 61, step: 1, suffix: ' muestras', digits: 0 },
  medianWindow: { label: 'Ventana N', min: 3, max: 61, step: 2, suffix: ' muestras', digits: 0 },
  cutoff: { label: 'Frecuencia de corte', min: 0.1, max: 5, step: 0.1, suffix: ' Hz', digits: 2 },
  velocity: { label: 'Velocidad máxima', min: 10, max: 360, step: 5, suffix: ' °/s', digits: 0 },
  acceleration: {
    label: 'Aceleración máxima',
    min: 0.5,
    max: 15,
    step: 0.5,
    suffix: ' rad/s²',
    digits: 2,
  },
  duration: { label: 'Duración del segmento', min: 0.2, max: 3, step: 0.1, suffix: ' s', digits: 2 },
  omega: { label: 'Frecuencia natural', min: 1, max: 15, step: 0.5, suffix: ' rad/s', digits: 2 },
  zeta: { label: 'Amortiguamiento ζ', min: 0.2, max: 2, step: 0.1, suffix: '', digits: 2 },
};

const PARAMS_BY_FILTER: Record<FilterType, FilterParam[]> = {
  none: [],
  ema: ['tau'],
  mean: ['meanWindow'],
  median: ['medianWindow'],
  butter: ['cutoff'],
  rate: ['velocity'],
  trapezoid: ['velocity', 'acceleration'],
  scurve: ['duration'],
  spring: ['omega', 'zeta'],
  pd: ['omega', 'zeta'],
};

export function ResponsePanel() {
  const filter = useLab((s) => s.filter);
  const params = useLab((s) => s.filterParams);
  const ideal = useLab((s) => s.ideal);
  const setFilter = useLab((s) => s.setFilter);
  const setFilterParam = useLab((s) => s.setFilterParam);
  const setIdeal = useLab((s) => s.setIdeal);

  return (
    <Section number="02" title="Respuesta del movimiento">
      <label htmlFor="filter">Filtro de los ángulos</label>
      <select
        id="filter"
        value={filter}
        onChange={(event) => setFilter(event.target.value as FilterType)}
      >
        {FILTERS.map(({ value, label }) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <Hint>{FILTER_HINTS[filter]}</Hint>
      <div>
        {PARAMS_BY_FILTER[filter].map((key) => {
          const { label, min, max, step, suffix, digits } = PARAMS[key];
          // Velocity is kept in rad/s and edited in °/s.
          const unit = key === 'velocity' ? RAD : 1;
          return (
            <RangeField
              key={key}
              id={`param-${key}`}
              label={label}
              value={params[key] / unit}
              min={min}
              max={max}
              step={step}
              format={(x) => x.toFixed(digits) + suffix}
              onChange={(x) => setFilterParam(key, x * unit)}
            />
          );
        })}
      </div>
      <Check checked={ideal} onChange={setIdeal}>
        Mostrar pose ideal en alambre
      </Check>
    </Section>
  );
}
