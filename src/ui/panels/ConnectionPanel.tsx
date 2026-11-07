import { useRef, useState } from 'react';
import type { PointerEvent, ReactNode } from 'react';
import type { LinkState } from '../../hardware/MaestroLink';
import type { TrackerGesture } from '../../core/choreography';
import type { MaestroMode, MaestroStatus } from '../../hardware/protocol';
import { GESTURES } from '../../perception/gestures';
import { useLab } from '../../state/store';
import { Hint } from '../common/Hint';
import { Section } from '../common/Section';

/** sofia-tracker's gestures, as buttons: short label and the motion played. */
const GESTURE_BUTTONS: { name: TrackerGesture; label: string; motion: string }[] = [
  { name: 'INDEX', label: 'Índice', motion: 'arriba y abajo' },
  { name: 'V', label: 'V', motion: 'ocho horizontal' },
  { name: 'PALM', label: 'Palma', motion: 'derecha e izquierda' },
  { name: 'SWIPE_LEFT', label: 'Barrido ←', motion: 'ola a la izquierda' },
  { name: 'SWIPE_RIGHT', label: 'Barrido →', motion: 'ola a la derecha' },
  { name: 'GRAB', label: 'Agarre', motion: 'sobresalto' },
];

const STATE_LABELS: Record<LinkState, string> = {
  disconnected: 'Desconectado',
  connecting: 'Conectando…',
  online: 'En línea',
  unresponsive: 'Sin respuesta',
};

const MODE_LABELS: Record<MaestroMode, string> = {
  OFF: 'Apagado',
  HOLD: 'Quieto',
  TARGET: 'Siguiendo el objetivo',
  GESTURE: 'Gesto',
  MANUAL: 'Ángulos manuales',
};

const HTTPS = window.location.protocol === 'https:';

function controllerLabel(status: MaestroStatus) {
  if (status.isController) return 'Este navegador';
  if (status.controller === 'udp') return 'sofia-tracker (PC)';
  if (status.controller === 'websocket') return 'Otro navegador';
  return 'Nadie';
}

function formatLatency(p95: number | null, within500: number | null) {
  if (p95 === null || within500 === null) return '—';
  const percentile = Number.isFinite(p95) ? `${Math.round(p95)} ms` : '> 800 ms';
  return `p95 ${percentile} · ${(within500 * 100).toFixed(1)} % < 500 ms`;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-[3px]">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

/** Drag to point the panel; the point is sent while the pointer is down. */
function TargetPad({ disabled }: { disabled: boolean }) {
  const aim = useLab((s) => s.aimPanel);
  const end = useLab((s) => s.endPanelTarget);
  const [point, setPoint] = useState<[number, number] | null>(null);
  const [active, setActive] = useState(false);
  const pad = useRef<HTMLDivElement>(null);

  function move(event: PointerEvent<HTMLDivElement>) {
    const box = pad.current?.getBoundingClientRect();
    if (!box) return;
    const x = Math.min(Math.max((event.clientX - box.left) / box.width, 0), 1);
    const y = Math.min(Math.max((event.clientY - box.top) / box.height, 0), 1);
    setPoint([x, y]);
    aim(x, y);
  }

  function release() {
    if (!active) return;
    setActive(false);
    end();
  }

  return (
    <div
      ref={pad}
      className={`relative aspect-[4/3] touch-none rounded-lg border border-line bg-page select-none ${disabled ? 'opacity-45' : 'cursor-crosshair'}`}
      role="application"
      aria-label="Área para apuntar el panal"
      aria-disabled={disabled}
      onPointerDown={(event) => {
        if (disabled) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        setActive(true);
        move(event);
      }}
      onPointerMove={(event) => {
        if (active) move(event);
      }}
      onPointerUp={release}
      onPointerCancel={release}
    >
      <div className="pointer-events-none absolute top-1/2 right-0 left-0 border-t border-dashed border-line" />
      <div className="pointer-events-none absolute top-0 bottom-0 left-1/2 border-l border-dashed border-line" />
      {point && (
        <div
          className={`pointer-events-none absolute size-4 -translate-1/2 rounded-full border-2 border-accent ${active ? 'bg-accent' : ''}`}
          style={{ left: `${point[0] * 100}%`, top: `${point[1] * 100}%` }}
        />
      )}
      <span className="pointer-events-none absolute bottom-1.5 left-2 text-11 text-muted">
        {disabled ? 'Toma el control para apuntar' : 'Mantén presionado y arrastra'}
      </span>
    </div>
  );
}

export function ConnectionPanel() {
  const host = useLab((s) => s.linkHost);
  const link = useLab((s) => s.link);
  const setHost = useLab((s) => s.setLinkHost);
  const connect = useLab((s) => s.connectLink);
  const disconnect = useLab((s) => s.disconnectLink);
  const arm = useLab((s) => s.armPanel);
  const stop = useLab((s) => s.stopPanel);
  const off = useLab((s) => s.offPanel);
  const playGesture = useLab((s) => s.playGesture);

  const { state, status } = link;
  const linked = state !== 'disconnected';
  const answering = state === 'online' || state === 'unresponsive';
  const controlling = Boolean(status?.isController);

  return (
    <Section number="00" title="Panel real · Wi‑Fi">
      {!linked && (
        <Hint>
          Conecta este equipo a la red <code>SOFIA-Maestro</code> (contraseña{' '}
          <code>sofia-maestro</code>). Mientras haya enlace, la escena 3D muestra el panel real.
        </Hint>
      )}
      {HTTPS && (
        <Hint className="text-[#ffbd88]">
          Esta página usa HTTPS y el navegador bloquea la conexión al Maestro (<code>ws://</code>).
          Ábrela con <code>pnpm dev</code> en <code>http://localhost</code>.
        </Hint>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (linked) disconnect();
          else connect();
        }}
      >
        <label htmlFor="maestroHost" className="mt-0">
          Dirección del Maestro
        </label>
        <div className="flex gap-2">
          <input
            id="maestroHost"
            className="min-w-0 flex-1 rounded-[7px] border border-line bg-control px-2.5 py-2 font-mono text-14 disabled:opacity-60 compact:min-h-11 compact:text-16"
            value={host}
            disabled={linked}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setHost(event.target.value)}
          />
          <button type="submit" className="min-w-28">
            {linked ? 'Desconectar' : 'Conectar'}
          </button>
        </div>
      </form>

      <dl className="mt-3.5 text-13">
        <Row label="Estado">
          <span
            className={
              state === 'online'
                ? 'text-accent'
                : state === 'unresponsive'
                  ? 'text-[#ffbd88]'
                  : undefined
            }
          >
            {STATE_LABELS[state]}
            {state === 'online' && link.firmware && ` · firmware ${link.firmware}`}
          </span>
        </Row>
        {answering && status && (
          <>
            <Row label="Modo">
              {MODE_LABELS[status.mode]}
              {status.gesture && ` (${status.gesture})`}
            </Row>
            <Row label="Control">{controllerLabel(status)}</Row>
            <Row label="Servos">
              {status.simulated ? (
                'simulados (sin placas PWM)'
              ) : status.healthy ? (
                `${status.powered} / 32 encendidos`
              ) : (
                <span className="text-[#ffbd88]">placas PWM sin respuesta</span>
              )}
            </Row>
            <Row label="Latencia">{formatLatency(link.p95, link.within500)}</Row>
          </>
        )}
      </dl>

      {answering && (
        <>
          <button
            className="mt-4 w-full border-[#ff6b4a] bg-[#5a1f1a] py-2.5 text-16 font-semibold tracking-[.08em] text-[#ffd9cf] hover:bg-[#7a2a22]"
            onClick={stop}
          >
            STOP
          </button>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button onClick={arm} disabled={controlling}>
              {status?.armed ? 'Tomar control' : 'Armar'}
            </button>
            <button onClick={off}>Apagar servos</button>
          </div>
          <Hint size="small">
            Armar centra los servos y los enciende uno por uno. STOP detiene el panal desde
            cualquier cliente y libera el control.
          </Hint>

          <h3 className="mt-4.5 mb-2 text-14 font-normal text-[#cad5e3]">Gestos</h3>
          <div className="grid grid-cols-2 gap-2">
            {GESTURE_BUTTONS.map((gesture) => (
              <button
                key={gesture.name}
                className="flex flex-col items-start px-2.5 py-1.5 text-left"
                disabled={!controlling || status?.mode === 'GESTURE'}
                onClick={() => playGesture(GESTURES[gesture.name].id, gesture.name)}
              >
                <span>{gesture.label}</span>
                <span className="text-11 text-muted">{gesture.motion}</span>
              </button>
            ))}
          </div>

          <h3 className="mt-4.5 mb-2 text-14 font-normal text-[#cad5e3]">Apuntar</h3>
          <TargetPad disabled={!controlling} />
          <Hint size="small">
            El área es la imagen de la cámara vista como espejo: el panal mira hacia el punto. Al
            soltar, el Maestro conserva la pose.
          </Hint>
        </>
      )}
    </Section>
  );
}
