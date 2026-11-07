import { useLab } from '../../state/store';

export function Toast() {
  const toast = useLab((s) => s.toast);
  return (
    <div
      className="fixed bottom-7.5 left-1/2 z-20 max-w-[90vw] -translate-x-1/2 rounded-lg bg-[#defaf3] px-5 py-3 text-14 text-[#142c31]"
      role="status"
      hidden={!toast}
    >
      {toast}
    </div>
  );
}
