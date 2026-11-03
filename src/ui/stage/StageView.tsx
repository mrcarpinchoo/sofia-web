import { useEffect, useRef } from 'react';
import { engine, useLab } from '../../state/store';
import { useIsPhone } from '../common/useIsPhone';
import { CollisionAlert } from './CollisionAlert';
import { TelemetryCard } from './TelemetryCard';
import { Transport } from './Transport';
import { ViewTools } from './ViewTools';

const TOUCH = window.matchMedia('(pointer: coarse)').matches;
const SEPARATOR = 'mx-[7px] compact:mx-[3px]';

export function StageView() {
  const stage = useRef<HTMLDivElement>(null);
  const paused = useLab((s) => s.paused);
  const controlsOpen = useLab((s) => s.controlsOpen);
  const sceneError = useLab((s) => s.sceneError);
  const setControlsOpen = useLab((s) => s.setControlsOpen);
  const setSceneError = useLab((s) => s.setSceneError);
  const mode = useLab((s) => s.mode);
  const phone = useIsPhone();

  useEffect(() => {
    if (!stage.current) return;
    try {
      return engine.mount(stage.current);
    } catch (error) {
      console.error(error);
      setSceneError(
        'No fue posible iniciar la escena 3D. Comprueba que la aceleración gráfica esté habilitada y vuelve a cargar la página.',
      );
    }
  }, [setSceneError]);

  return (
    <main className="relative min-w-0 flex-1 overflow-hidden bg-[#101823] phone:order-1 phone:min-h-0">
      <div
        className="absolute inset-0 outline-none [&_canvas]:block [&_canvas]:size-full [&_canvas]:touch-none"
        ref={stage}
        aria-label="Simulación tridimensional de los paneles SOFIA"
        tabIndex={0}
      />
      <div
        className="absolute top-37.5 right-7.5 left-7.5 z-6 border border-[#ce627a] bg-[#442732] p-5"
        role="alert"
        hidden={!sceneError}
      >
        {sceneError}
      </div>
      <div className="pointer-events-none absolute top-5.5 right-6 left-6 flex items-center gap-4 medium:left-4 compact:top-3 compact:right-3 compact:left-3 compact:gap-2">
        <button
          className="pointer-events-auto"
          aria-label="Mostrar controles"
          hidden={controlsOpen || phone}
          onClick={() => setControlsOpen(true)}
        >
          ☰ Controles
        </button>
        <div className="flex items-center gap-2 rounded-[4px] border border-[#7fe3d930] bg-[#13252abf] px-2.5 py-2 text-11 tracking-[.12em] text-accent compact:text-9">
          <span className={`size-[5px] rounded-full ${paused ? 'bg-[#98a7b7]' : 'bg-accent'}`} />
          <span>{paused ? 'EN PAUSA' : 'EN MOVIMIENTO'}</span>
        </div>
        <span className="text-12 tracking-[.09em] text-[#a0b0c3] medium:hidden">
          PANAL SOFIA <span className="ml-[7px] text-[#5c7087]">/ 16 × 2 GDL</span>
        </span>
      </div>
      <ViewTools />
      <CollisionAlert />
      <TelemetryCard />
      <Transport />
      <div
        className={`pointer-events-none absolute bottom-[7px] left-6 text-10 text-[#697f98] compact:right-3 compact:left-3 compact:whitespace-nowrap ${controlsOpen ? 'compact:hidden' : ''}`}
      >
        {TOUCH ? (
          <>
            {mode === 'cursor' ? 'Un dedo: mover la esfera · Dos: orbitar' : 'Un dedo: orbitar'}{' '}
            <span className={SEPARATOR}>·</span> Pellizco: zoom
          </>
        ) : (
          <>
            Cursor: apunta en modo Cursor <span className={SEPARATOR}>·</span> Arrastre derecho /
            Mayús: orbitar <span className={SEPARATOR}>·</span> Rueda: zoom
          </>
        )}
      </div>
    </main>
  );
}
