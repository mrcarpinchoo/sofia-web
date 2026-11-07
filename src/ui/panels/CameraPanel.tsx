import type { CameraActivity } from '../../perception/CameraTracker';
import { GESTURES } from '../../perception/gestures';
import { useLab } from '../../state/store';
import { Hint } from '../common/Hint';
import { Section } from '../common/Section';

const START_LABELS: Record<CameraActivity, string> = {
  off: 'Activar cámara',
  loading: 'Cargando…',
  running: 'Cámara activa',
};

export function CameraPanel() {
  const activity = useLab((s) => s.cameraActivity);
  const status = useLab((s) => s.cameraStatus);
  const gestureLabel = useLab((s) => s.gestureLabel);
  const start = useLab((s) => s.startCamera);
  const stop = useLab((s) => s.stopCamera);
  const active = activity !== 'off';

  return (
    <Section id="cameraSection" number="04" title="Cámara · gestos de mano">
      <ul className="my-3 space-y-1.5 text-13">
        {Object.entries(GESTURES).map(([key, { name, motion }]) => (
          <li key={key}>
            <span className="text-[#d5e0ed]">{name}</span>
            <span className="text-muted"> → {motion}</span>
          </li>
        ))}
      </ul>
      <Hint>{gestureLabel}</Hint>
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
      {/* While the camera runs, its status shows under the preview instead. */}
      {!active && (
        <Hint size="large" role="status">
          {status}
        </Hint>
      )}
    </Section>
  );
}
