import { useLab } from '../../state/store';
import { CameraPanel } from '../panels/CameraPanel';
import { ConnectionPanel } from '../panels/ConnectionPanel';
import { ModelPanel } from '../panels/ModelPanel';
import { ResponsePanel } from '../panels/ResponsePanel';
import { TargetPanel } from '../panels/TargetPanel';
import { CameraPreview } from '../stage/CameraPreview';

/** The side panel with every control section. */
export function Sidebar() {
  const open = useLab((s) => s.controlsOpen);
  const setOpen = useLab((s) => s.setControlsOpen);

  return (
    <aside
      className={`w-75 min-h-0 flex-none flex-col overflow-hidden border-r border-line bg-panel [scrollbar-color:#425167_transparent] [scrollbar-width:thin] wide:w-80 ${open ? 'flex' : 'hidden'}`}
    >
      <div className="flex shrink-0 items-center justify-between px-5 pt-4 text-12 tracking-[.13em] text-muted">
        <span>CONFIGURACIÓN</span>
        <button
          className="w-8 border-0 bg-transparent p-0 text-26 tracking-normal"
          title="Ocultar controles"
          aria-label="Ocultar controles"
          onClick={() => setOpen(false)}
        >
          ‹
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]">
        <ConnectionPanel />
        <TargetPanel />
        <ResponsePanel />
        <ModelPanel />
        <CameraPanel />
      </div>
      <CameraPreview />
      <div className="flex shrink-0 justify-between gap-3.5 px-4 py-2 text-12 text-[#8f9fb1] low:hidden">
        <span>16 unidades / 32 articulaciones</span>
        <span>mm · rad · s</span>
      </div>
    </aside>
  );
}
