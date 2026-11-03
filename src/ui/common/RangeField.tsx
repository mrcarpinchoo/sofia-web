interface RangeFieldProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
}

export function RangeField({ id, label, value, min, max, step, format, onChange }: RangeFieldProps) {
  return (
    <>
      <label className="flex items-center justify-between gap-1" htmlFor={id}>
        {label} <output className="font-mono text-13 text-accent">{format(value)}</output>
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </>
  );
}
