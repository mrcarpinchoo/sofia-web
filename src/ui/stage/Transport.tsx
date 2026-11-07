import type { TargetMode } from '../../simulation/targets';
import { useLab } from '../../state/store';
import { useTelemetry } from './useTelemetry';

const TARGET_LABELS: Record<TargetMode, string> = {
  auto: 'ESFERA ROJA',
  cursor: 'CURSOR',
  camera: 'CÁMARA',
};

export function Transport() {
  const paused = useLab((s) => s.paused);
  const mode = useLab((s) => s.mode);
  const setPaused = useLab((s) => s.setPaused);
  const reset = useLab((s) => s.reset);
  const { clock } = useTelemetry();

  return (
    <div className="absolute bottom-7 left-6 flex items-center gap-2.5 rounded-xl border border-[#344152] bg-[#172130e8] px-3.5 py-2.5 shadow-[0_8px_30px_#0003] medium:left-4">
      <button
        className="w-9 border-0 bg-accent p-1 text-18 text-[#132b31]"
        aria-label={paused ? 'Reanudar simulación' : 'Pausar simulación'}
        onClick={() => setPaused(!paused)}
      >
        {paused ? '▶' : 'Ⅱ'}
      </button>
      <button
        className="w-9 border-0 bg-transparent p-1 text-21"
        aria-label="Reiniciar simulación"
        title="Reiniciar"
        onClick={reset}
      >
        ↺
      </button>
      <div className="mr-3.5 ml-2">
        <strong className="block font-mono text-17 font-normal">{clock}</strong>
        <span className="mt-[3px] block text-9 tracking-[.08em] text-[#8b9db4]">
          TIEMPO DE SIMULACIÓN
        </span>
      </div>
      <div className="mr-2.5 h-6.5 w-px bg-[#344152] medium:hidden" />
      <span className="text-10 tracking-[.06em] text-[#b8c3d1] medium:hidden">
        {TARGET_LABELS[mode]}
      </span>
      <span className="size-[7px] rounded-full bg-[#ff5066] medium:hidden" />
    </div>
  );
}
