import { Fragment } from 'react';
import type { CameraActivity, CameraKind } from '../../perception/CameraTracker';
import type { Framing } from '../../perception/gestures';
import { engine, useLab } from '../../state/store';
import { Check } from '../common/Check';
import { Hint } from '../common/Hint';
import { RangeField } from '../common/RangeField';
import { Section } from '../common/Section';
import { Segmented } from '../common/Segmented';

const KINDS: { value: CameraKind; label: string }[] = [
  { value: 'body', label: 'Personas' },
  { value: 'hand', label: 'Gestos de mano' },
];

const GESTURES = [
  { name: '✋ Palma abierta', description: 'Saludo lateral.' },
  { name: '✊ Puño cerrado', description: 'Mirada al centro.' },
  { name: '✌ V de victoria', description: 'Baile en ocho.' },
  { name: '☝ Índice arriba', description: 'Asentimiento vertical.' },
  {
    name: '♡ Corazón con dos manos',
    description:
      'Une índices arriba y pulgares abajo, dejando un hueco de corazón. Se activa una ola de inclinaciones que sale del centro y llega a los paneles de alrededor. Se repite aunque retires las manos, hasta reconocer otro gesto; las bases conservan el acomodo de panal.',
  },
];

const START_LABELS: Record<CameraActivity, string> = {
  off: 'Activar cámara',
  loading: 'Cargando…',
  running: 'Cámara activa',
};

function BodySettings() {
  const framing = useLab((s) => s.framing);
  const gain = useLab((s) => s.cameraGain);
  const setFraming = useLab((s) => s.setFraming);
  const setGain = useLab((s) => s.setCameraGain);

  return (
    <div>
      <label htmlFor="framing">Encuadre de seguimiento</label>
      <select
        id="framing"
        value={framing}
        onChange={(event) => setFraming(event.target.value as Framing)}
      >
        <option value="upper">Medio cuerpo · hombros</option>
        <option value="full">Cuerpo completo · torso y cadera</option>
      </select>
      <Hint>
        Muestra ambos hombros; en cuerpo completo también deben verse las caderas. Sigue a una
        persona a la vez, sin identificarla.
      </Hint>
      <RangeField
        id="cameraGain"
        label="Amplitud del seguimiento"
        value={gain}
        min={0.3}
        max={2}
        step={0.1}
        format={(x) => `${x.toFixed(1)}×`}
        onChange={setGain}
      />
      <button className="mt-2.5 w-full text-13" onClick={() => engine.centerCamera()}>
        Centrar en mi posición actual
      </button>
    </div>
  );
}

function HandSettings() {
  const gestureLabel = useLab((s) => s.gestureLabel);
  return (
    <div>
      <Hint>
        Para los primeros cuatro gestos muestra una mano; para el corazón, las dos. Mantén el gesto
        al menos medio segundo para activarlo. Después puedes retirar las manos: el movimiento
        continúa hasta reconocer otro gesto o apagar la cámara.
      </Hint>
      <dl className="my-3 text-14">
        {GESTURES.map(({ name, description }) => (
          <Fragment key={name}>
            <dt className="mt-2.5 text-[#d5e0ed]">{name}</dt>
            <dd className="mt-[3px] text-13 text-muted">{description}</dd>
          </Fragment>
        ))}
      </dl>
      <Hint>{gestureLabel}</Hint>
    </div>
  );
}

export function CameraPanel() {
  const kind = useLab((s) => s.cameraKind);
  const activity = useLab((s) => s.cameraActivity);
  const status = useLab((s) => s.cameraStatus);
  const mirror = useLab((s) => s.mirror);
  const setKind = useLab((s) => s.setCameraKind);
  const setMirror = useLab((s) => s.setMirror);
  const start = useLab((s) => s.startCamera);
  const stop = useLab((s) => s.stopCamera);
  const active = activity !== 'off';

  return (
    <Section id="cameraSection" number="04" title="Cámara">
      <Segmented label="Uso de cámara" options={KINDS} value={kind} onChange={setKind} />
      {kind === 'body' ? <BodySettings /> : <HandSettings />}
      <Check checked={mirror} onChange={setMirror}>
        Vista y movimiento en espejo
      </Check>
      <div className="mt-3.5 flex gap-2">
        <button
          className="flex-1 bg-[#244441] text-13 text-[#a8fff3]"
          disabled={active}
          onClick={start}
        >
          {START_LABELS[activity]}
        </button>
        <button className="text-13" disabled={!active} onClick={stop}>
          Apagar
        </button>
      </div>
      <Hint size="large" role="status">
        {status}
      </Hint>
      <Hint size="small">
        Solicita permiso solo al activarla. Procesamiento local; no se envían imágenes ni se usa el
        micrófono. En Personas, perder la detección conserva la pose. En Gestos, el último movimiento
        continúa en bucle hasta reconocer otro gesto o apagar la cámara.
      </Hint>
    </Section>
  );
}
