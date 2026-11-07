import type { TrajectoryType } from '../../core/trajectories';
import type { TargetMode } from '../../simulation/targets';
import { useLab } from '../../state/store';
import { Hint } from '../common/Hint';
import { RangeField } from '../common/RangeField';
import { Section } from '../common/Section';
import { Segmented } from '../common/Segmented';

const MODES: { value: TargetMode; label: string }[] = [
  { value: 'auto', label: 'Automático' },
  { value: 'cursor', label: 'Cursor' },
  { value: 'camera', label: 'Cámara' },
];

const MODE_HINTS: Record<TargetMode, string> = {
  auto: 'Los paneles siguen la esfera roja.',
  cursor: 'Mueve el cursor sobre la escena. La esfera se mueve en el plano de profundidad elegido.',
  camera:
    'Activa la cámara en el apartado 04. Personas sigue tu cuerpo; Gestos sigue la mano y reproduce cada gesto una vez.',
};

export function TargetPanel() {
  const mode = useLab((s) => s.mode);
  const path = useLab((s) => s.path);
  const speed = useLab((s) => s.speed);
  const depth = useLab((s) => s.depth);
  const setMode = useLab((s) => s.setMode);
  const setPath = useLab((s) => s.setPath);
  const setSpeed = useLab((s) => s.setSpeed);
  const setDepth = useLab((s) => s.setDepth);
  const showTab = useLab((s) => s.showTab);

  function changeMode(next: TargetMode) {
    setMode(next);
    if (next === 'camera') {
      showTab('camera');
      document.getElementById('cameraSection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  return (
    <Section number="01" title="Objetivo">
      <Segmented label="Modo de seguimiento" options={MODES} value={mode} onChange={changeMode} />
      <Hint>{MODE_HINTS[mode]}</Hint>
      <div hidden={mode !== 'auto'}>
        <label htmlFor="trajectory">Trayectoria</label>
        <select
          id="trajectory"
          value={path}
          onChange={(event) => setPath(event.target.value as TrajectoryType)}
        >
          <option value="eight">Órbita en ocho · 3D</option>
          <option value="circle">Circular</option>
          <option value="step">Escalón · prueba de filtros</option>
        </select>
        <RangeField
          id="speed"
          label="Velocidad"
          value={speed}
          min={0.2}
          max={3}
          step={0.1}
          format={(x) => `${x.toFixed(1)}×`}
          onChange={setSpeed}
        />
      </div>
      <RangeField
        id="depth"
        label="Profundidad del objetivo"
        value={depth}
        min={-120}
        max={700}
        step={5}
        format={(x) => `${x} mm`}
        onChange={setDepth}
      />
    </Section>
  );
}
