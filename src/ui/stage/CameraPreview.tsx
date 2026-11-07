import { useEffect, useRef } from 'react';
import { engine, useLab } from '../../state/store';

const LAYER = 'absolute inset-0 size-full object-contain';
const NOTE = 'mt-1.5 text-12/[1.6] text-muted';

/** Stays mounted while the camera is off: the tracker holds on to these elements. */
export function CameraPreview() {
  const activity = useLab((s) => s.cameraActivity);
  const status = useLab((s) => s.cameraStatus);
  const points = useLab((s) => s.cameraPoints);
  const video = useRef<HTMLVideoElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  // Mirrored, like the image sofia-tracker works on.
  const flip = '-scale-x-100';

  useEffect(() => {
    if (!video.current || !overlay.current) return;
    engine.attachCamera(video.current, overlay.current);
    return () => engine.detachCamera();
  }, []);

  return (
    <div
      className="shrink-0 border-t border-[#40556a] bg-[#101b29] px-4 py-2.5"
      hidden={activity === 'off'}
    >
      <div className="text-14 text-[#d3e9ed]">Cámara · mano</div>
      <div className="relative mt-[7px] h-47.5 max-h-[28dvh] overflow-hidden rounded-lg border border-line bg-[#0b1018] low:h-31.25">
        <video className={`z-0 ${LAYER} ${flip}`} ref={video} muted playsInline />
        <canvas
          className={`pointer-events-none z-1 ${LAYER} ${flip}`}
          ref={overlay}
          aria-label="Puntos detectados de la mano"
        />
      </div>
      <p className={NOTE} role="status">
        {status}
      </p>
      <p className={NOTE}>{points} de 21 puntos visibles</p>
    </div>
  );
}
