import { useLab } from '../../state/store';

export function Header() {
  const setNotesOpen = useLab((s) => s.setNotesOpen);

  return (
    <header className="relative z-4 flex h-(--header-height) items-center gap-8 border-b border-line bg-page px-6">
      <div className="flex items-center gap-3 whitespace-nowrap">
        <span className="text-38 leading-none text-accent">⬡</span>
        <strong className="text-20 tracking-[.12em]">
          SOFIA<span className="text-15 font-normal text-[#8090a7]"> / LAB</span>
        </strong>
      </div>
      <span className="text-14 text-muted medium:hidden">Laboratorio cinemático</span>
      <button
        className="ml-auto border-0 bg-transparent text-muted hover:bg-control-hover"
        onClick={() => setNotesOpen(true)}
      >
        Modelo y notas
      </button>
    </header>
  );
}
