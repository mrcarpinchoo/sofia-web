import type { ReactNode } from 'react';

interface CheckProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}

export function Check({ checked, onChange, children }: CheckProps) {
  return (
    <label className="flex items-center gap-2 text-13/[1.5]">
      <input
        className="m-[3px] ml-1 size-4 flex-none accent-accent"
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />{' '}
      {children}
    </label>
  );
}
