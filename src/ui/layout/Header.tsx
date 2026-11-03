import { canRecordPage } from '../../recording/pageRecorder';
import { useLab } from '../../state/store';

export function Header() {
  const recording = useLab((s) => s.recording);
  const busy = useLab((s) => s.recordBusy);
  const toggleRecording = useLab((s) => s.toggleRecording);
  const setNotesOpen = useLab((s) => s.setNotesOpen);

  return (
    <header className="relative z-4 flex h-(--header-height) items-center gap-8 border-b border-line bg-page px-6 compact:gap-2 compact:px-3.5 compact:pt-[env(safe-area-inset-top)]">
      <div className="flex items-center gap-3 whitespace-nowrap">
        <span className="text-38 leading-none text-accent compact:text-30">⬡</span>
        <strong className="text-20 tracking-[.12em] compact:text-17">
          SOFIA<span className="text-15 font-normal text-[#8090a7] compact:text-12"> / LAB</span>
        </strong>
      </div>
      <span className="text-14 text-muted medium:hidden">Laboratorio cinemático</span>
      <div className="ml-auto flex items-center gap-3.5 compact:gap-[3px]">
        <button
          className="border-0 bg-transparent text-muted hover:bg-control-hover compact:px-2 compact:py-1.25 compact:text-12 compact:whitespace-nowrap"
          onClick={() => setNotesOpen(true)}
        >
          Modelo y notas
        </button>
        {canRecordPage() && (
          <button
            className={`border-[#53323b] whitespace-nowrap compact:px-2 compact:py-1.25 compact:text-12 ${recording ? 'bg-[#b82a3e] text-white' : 'bg-[#251e28] text-[#ff8888] hover:bg-control-hover'}`}
            disabled={busy}
            onClick={toggleRecording}
          >
            {recording ? '■ ' : '● '}
            <span className="compact:hidden">{recording ? 'Terminar' : 'Grabar página'}</span>
          </button>
        )}
      </div>
    </header>
  );
}
