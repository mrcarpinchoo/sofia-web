import { useEffect, useRef } from 'react';
import { engine, useLab } from '../../state/store';

const LAYER = 'absolute inset-0 size-full object-contain';
const NOTE = 'mt-1.5 text-12/[1.6] text-muted compact:hidden';

/** Stays mounted while the camera is off: the tracker holds on to these elements. */
export function CameraPreview() {
  const activity = useLab((s) => s.cameraActivity);
  const mirror = useLab((s) => s.mirror);
  const status = useLab((s) => s.cameraStatus);
  const points = useLab((s) => s.cameraPoints);
  const kind = useLab((s) => s.cameraKind);
  const video = useRef<HTMLVideoElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const flip = mirror ? '-scale-x-100' : '';

  useEffect(() => {
    if (!video.current || !overlay.current) return;
    engine.attachCamera(video.current, overlay.current);
    return () => engine.detachCamera();
  }, []);

  return (
    // On phones it floats over the scene, so it stays visible on any tab.
    <div
      className="shrink-0 border-t border-[#40556a] bg-[#101b29] px-4 py-2.5 phone:fixed phone:top-[calc(var(--header-height)+108px)] phone:right-3 phone:z-4 phone:w-26 phone:border-0 phone:bg-transparent phone:p-0"
      hidden={activity === 'off'}
    >
      <div className="text-14 text-[#d3e9ed] compact:hidden">Cámara · puntos y esqueleto</div>
      <div className="relative mt-[7px] h-47.5 max-h-[28dvh] overflow-hidden rounded-lg border border-line bg-[#0b1018] low:h-31.25 phone:m-0 phone:h-19.5 phone:max-h-none phone:shadow-[0_6px_20px_#0006]">
        <video className={`z-0 ${LAYER} ${flip}`} ref={video} muted playsInline />
        <canvas
          className={`pointer-events-none z-1 ${LAYER} ${flip}`}
          ref={overlay}
          aria-label="Puntos detectados del cuerpo o mano"
        />
      </div>
      <p className={NOTE} role="status">
        {status}
      </p>
      <p className={NOTE}>
        {points} puntos visibles · {kind === 'hand' ? '21 por mano' : 'esqueleto corporal'}
      </p>
    </div>
  );
}
