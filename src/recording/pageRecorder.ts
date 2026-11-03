// Records the visible browser tab to a video file.

import { download } from '../simulation/csv';

export const canRecordPage = () =>
  Boolean(window.MediaRecorder && navigator.mediaDevices?.getDisplayMedia);

export interface RecorderCallbacks {
  onToast: (message: string) => void;
  /** Called when the browser is about to ask which tab to record. */
  onPreparing: () => void;
  onRecording: (recording: boolean) => void;
  onBusy: (busy: boolean) => void;
}

const MIME_TYPES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/mp4', 'video/webm'];

export class PageRecorder {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private pending = false;
  private readonly callbacks: RecorderCallbacks;

  constructor(callbacks: RecorderCallbacks) {
    this.callbacks = callbacks;
  }

  async toggle() {
    const { onToast, onPreparing, onRecording, onBusy } = this.callbacks;
    if (this.recorder?.state === 'recording') {
      onBusy(true);
      this.recorder.stop();
      return;
    }
    if (this.recorder || this.pending) return;
    if (!canRecordPage()) {
      onToast(
        'La grabación de la página requiere Chrome o Edge de escritorio con captura de pestañas disponible.',
      );
      return;
    }
    this.pending = true;
    onBusy(true);
    onPreparing();
    onToast('Selecciona esta pestaña de SOFIA para grabar controles, cámara y paneles.');

    let stream: MediaStream | undefined;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30 } },
        audio: false,
        preferCurrentTab: true,
        selfBrowserSurface: 'include',
        surfaceSwitching: 'exclude',
      } as DisplayMediaStreamOptions);
      this.stream = stream;
      const type = MIME_TYPES.find((x) => MediaRecorder.isTypeSupported(x));
      const current = new MediaRecorder(stream, type ? { mimeType: type } : {});
      this.recorder = current;

      const parts: Blob[] = [];
      current.ondataavailable = (event) => {
        if (event.data.size) parts.push(event.data);
      };
      current.onstop = () => {
        this.releaseStream();
        this.recorder = null;
        onRecording(false);
        onBusy(false);
        if (parts.length) {
          const mime = current.mimeType;
          const extension = mime.includes('mp4') ? 'mp4' : 'webm';
          download(new Blob(parts, { type: mime }), `SOFIA-pagina-y-camara.${extension}`);
          onToast('Video descargado con el contenido visible de la pestaña.');
        } else {
          onToast('La grabación terminó sin video. Vuelve a intentarlo.');
        }
      };
      current.onerror = () => {
        onToast('Se interrumpió la grabación.');
        if (current.state !== 'inactive') {
          current.stop();
        } else {
          this.releaseStream();
          this.recorder = null;
          onRecording(false);
        }
      };
      stream.getVideoTracks()[0].onended = () => {
        if (current.state !== 'inactive') current.stop();
      };
      current.start(1000);
      onRecording(true);
      onToast('Grabando la página visible. La cámara permanece junto a los controles.');
    } catch (error) {
      stream?.getTracks().forEach((t) => t.stop());
      this.stream = null;
      this.recorder = null;
      onRecording(false);
      onToast(
        (error as Error).name === 'NotAllowedError'
          ? 'Grabación cancelada o permiso denegado. Puedes volver a pulsar Grabar página.'
          : 'No se pudo grabar. Abre SOFIA en Chrome o Edge y selecciona esta pestaña.',
      );
    } finally {
      this.pending = false;
      onBusy(false);
    }
  }

  /** Ends any recording when the page goes away. */
  shutdown() {
    if (this.recorder?.state === 'recording') this.recorder.stop();
    this.releaseStream();
  }

  private releaseStream() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
}
