import { useEffect, useRef } from 'react';
import { safeSpacing } from '../../core/kinematics';
import type { LimitPolicy } from '../../core/types';
import { MAX_SPACING, MIN_SPACING } from '../../simulation/LabEngine';
import { useLab } from '../../state/store';
import { Check } from '../common/Check';
import { Hint } from '../common/Hint';
import { RangeField } from '../common/RangeField';
import { Section } from '../common/Section';

const MIN_LENGTH = 5;
const MAX_LENGTH = 200;

/** Applied when the value is committed: rebuilding the model on each keystroke would be jarring. */
function LengthField({ name, label }: { name: 'z12' | 'z23'; label: string }) {
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const element = input.current;
    if (!element) return;
    function commit() {
      if (!element) return;
      const value = Number(element.value);
      const { setLength, showToast, [name]: current } = useLab.getState();
      if (!Number.isFinite(value) || value < MIN_LENGTH || value > MAX_LENGTH) {
        element.value = String(current);
        showToast(`Introduce una longitud entre ${MIN_LENGTH} y ${MAX_LENGTH} mm.`);
        return;
      }
      setLength(name, value);
    }
    element.addEventListener('change', commit);
    return () => element.removeEventListener('change', commit);
  }, [name]);

  return (
    <div>
      <label htmlFor={name}>{label} · mm</label>
      <input
        ref={input}
        id={name}
        type="number"
        defaultValue={useLab.getState()[name]}
        min={MIN_LENGTH}
        max={MAX_LENGTH}
        step={1}
      />
    </div>
  );
}

export function ModelPanel() {
  const spacing = useLab((s) => s.spacing);
  const z23 = useLab((s) => s.z23);
  const limit = useLab((s) => s.limit);
  const policy = useLab((s) => s.policy);
  const rays = useLab((s) => s.rays);
  const setSpacing = useLab((s) => s.setSpacing);
  const applySafeSpacing = useLab((s) => s.applySafeSpacing);
  const setLimit = useLab((s) => s.setLimit);
  const setPolicy = useLab((s) => s.setPolicy);
  const setRays = useLab((s) => s.setRays);

  const recommended = safeSpacing(z23);
  const safe = spacing >= recommended;

  return (
    <Section number="03" title="Modelo y restricciones">
      <RangeField
        id="spacing"
        label="Separación entre bases"
        value={spacing}
        min={MIN_SPACING}
        max={MAX_SPACING}
        step={1}
        format={(x) => `${x} mm`}
        onChange={setSpacing}
      />
      <button className="mt-2.5 w-full text-13" onClick={applySafeSpacing}>
        Aplicar separación recomendada
      </button>
      <Hint
        className={`border-l-2 pl-2.5 ${safe ? 'border-accent' : 'border-[#ffbf86]'}`}
        role="status"
      >
        {safe ? 'Separación conservadora aplicada. ' : 'Pueden cruzarse placas. '}
        Recomendación: {recommended} mm o más.
      </Hint>
      <Hint size="small">
        Se separan las bases sin cambiar las ecuaciones. La recomendación evita cruces entre placas
        del modelo; no es un límite certificado del montaje físico.
      </Hint>
      <div className="grid grid-cols-[1fr_1fr] gap-3.5">
        <LengthField name="z12" label="z₁₂" />
        <LengthField name="z23" label="z₂₃" />
      </div>
      <Hint size="small">
        Longitudes iniciales de MATLAB; pendientes de medir entre los orígenes del mecanismo.
      </Hint>
      <RangeField
        id="limit"
        label="Límite de ambos giros"
        value={limit}
        min={10}
        max={90}
        format={(x) => `±${x}°`}
        onChange={setLimit}
      />
      <label htmlFor="policy">Si el objetivo está fuera de alcance</label>
      <select
        id="policy"
        value={policy}
        onChange={(event) => setPolicy(event.target.value as LimitPolicy)}
      >
        <option value="clamp">Saturar en el límite</option>
        <option value="hold">Mantener la última pose</option>
      </select>
      <Check checked={rays} onChange={setRays}>
        Mostrar direcciones de mirada
      </Check>
      <Hint size="small">
        Las colisiones se detectan solo entre placas, no entre ejes, servos o cables. No hay modelo
        de torque.
      </Hint>
    </Section>
  );
}
