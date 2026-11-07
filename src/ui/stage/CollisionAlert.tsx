import { useTelemetry } from './useTelemetry';

const MAX_LISTED = 4;

const unitName = (index: number) => String(index + 1).padStart(2, '0');

export function CollisionAlert() {
  const { collisions } = useTelemetry();
  if (!collisions.length) return null;

  const listed = collisions.slice(0, MAX_LISTED).map(([a, b]) => `${unitName(a)}–${unitName(b)}`);
  const hidden = collisions.length - listed.length;

  return (
    <div
      className="pointer-events-none absolute top-29 left-6 max-w-[calc(100%-48px)] rounded-lg border border-[#ff6b4a] bg-[#3a1c18e6] px-3 py-2 text-12 text-[#ffc9bb] medium:left-4"
      role="status"
    >
      Colisión entre placas: {listed.join(', ')}
      {hidden > 0 && ` y ${hidden} más`}
    </div>
  );
}
