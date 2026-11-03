interface Option<T> {
  value: T;
  label: string;
}

interface SegmentedProps<T> {
  label: string;
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
}

export function Segmented<T extends string>({ label, options, value, onChange }: SegmentedProps<T>) {
  return (
    <div className="flex rounded-lg border border-line bg-page p-[3px]" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          className="flex-1 border-transparent bg-transparent px-1 py-[7px] aria-pressed:bg-[#293b43] aria-pressed:text-accent"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
