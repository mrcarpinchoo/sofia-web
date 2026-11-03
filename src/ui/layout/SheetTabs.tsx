import { useLab } from '../../state/store';
import type { ControlTab } from '../../state/store';

const TABS: { tab: ControlTab; label: string }[] = [
  { tab: 'target', label: 'Objetivo' },
  { tab: 'response', label: 'Filtro' },
  { tab: 'model', label: 'Modelo' },
  { tab: 'camera', label: 'Cámara' },
  { tab: 'link', label: 'Enlace' },
];

/** Tapping a tab opens the sheet there; tapping the current one closes it. */
export function SheetTabs() {
  const open = useLab((s) => s.controlsOpen);
  const current = useLab((s) => s.controlTab);
  const showTab = useLab((s) => s.showTab);
  const setOpen = useLab((s) => s.setControlsOpen);

  return (
    <nav className="flex flex-none border-b border-line" aria-label="Controles">
      {TABS.map(({ tab, label }) => {
        const active = open && tab === current;
        return (
          <button
            key={tab}
            className="min-h-12 min-w-0 flex-1 rounded-none border-0 border-t-2 border-transparent bg-transparent px-0.5 py-0 text-13 text-muted aria-pressed:border-t-accent aria-pressed:text-accent"
            aria-pressed={active}
            onClick={() => (active ? setOpen(false) : showTab(tab))}
          >
            {label}
          </button>
        );
      })}
    </nav>
  );
}
