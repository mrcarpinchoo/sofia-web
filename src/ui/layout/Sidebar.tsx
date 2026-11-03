import { useLab } from '../../state/store';
import type { ControlTab } from '../../state/store';
import { useIsPhone } from '../common/useIsPhone';
import { CameraPanel } from '../panels/CameraPanel';
import { ConnectionPanel } from '../panels/ConnectionPanel';
import { ModelPanel } from '../panels/ModelPanel';
import { ResponsePanel } from '../panels/ResponsePanel';
import { TargetPanel } from '../panels/TargetPanel';
import { CameraPreview } from '../stage/CameraPreview';
import { SheetTabs } from './SheetTabs';

const PANELS: { tab: ControlTab; Panel: () => React.JSX.Element }[] = [
  { tab: 'link', Panel: ConnectionPanel },
  { tab: 'target', Panel: TargetPanel },
  { tab: 'response', Panel: ResponsePanel },
  { tab: 'model', Panel: ModelPanel },
  { tab: 'camera', Panel: CameraPanel },
];

/** The side panel on desktop. On phones the same element is a bottom sheet with tabs. */
export function Sidebar() {
  const open = useLab((s) => s.controlsOpen);
  const tab = useLab((s) => s.controlTab);
  const setOpen = useLab((s) => s.setControlsOpen);
  const phone = useIsPhone();
  const panels = phone ? PANELS.filter((panel) => panel.tab === tab) : PANELS;

  return (
    <aside
      className={`w-75 min-h-0 flex-none flex-col overflow-hidden border-r border-line bg-panel [scrollbar-color:#425167_transparent] [scrollbar-width:thin] wide:w-80 phone:order-2 phone:w-full phone:border-t phone:border-r-0 phone:pb-[env(safe-area-inset-bottom)] ${open ? 'flex phone:h-[min(46dvh,420px)]' : 'hidden phone:flex'}`}
    >
      {phone ? (
        <SheetTabs />
      ) : (
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
      )}
      <div
        className={`min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin] ${open ? '' : 'phone:hidden'}`}
      >
        {panels.map(({ tab: id, Panel }) => (
          <Panel key={id} />
        ))}
      </div>
      <CameraPreview />
      <div className="flex shrink-0 justify-between gap-3.5 px-4 py-2 text-12 text-[#8f9fb1] low:hidden phone:hidden">
        <span>16 unidades / 32 articulaciones</span>
        <span>mm · rad · s</span>
      </div>
    </aside>
  );
}
