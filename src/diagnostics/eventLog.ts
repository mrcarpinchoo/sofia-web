// Errors, recoveries and commands reported by the camera, the Maestro link
// and the page, kept as a CSV the user can download: evidence of when each
// problem happened, under which conditions and what the page did about it.
// Same columns and event names as sofia-tracker's events.py
// (see sofia-tracker/docs/MANEJO_DE_ERRORES.md).

export type EventLevel = 'INFO' | 'AVISO' | 'ERROR';
export type EventSource = 'camara' | 'maestro' | 'gui';

export interface LabEvent {
  level: EventLevel;
  source: EventSource;
  /** E.g. CAMARA_PERDIDA, ENLACE_RESTABLECIDO. */
  name: string;
  /** What happened. */
  detail: string;
  /** What the page did about it. */
  action: string;
}

const COLUMNS = ['fecha_hora', 'nivel', 'origen', 'evento', 'detalle', 'accion', 'contexto'];
/** Oldest rows are dropped past this, so a long session can't fill the memory. */
const MAX_ROWS = 20000;

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** Local time, `2026-11-06 23:02:31.594`. */
function timestamp(d: Date) {
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  return `${date} ${time}.${pad(d.getMilliseconds(), 3)}`;
}

function csvField(value: string) {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** One line for a toast: the detail and what was done. */
export function describe(event: LabEvent) {
  return event.action ? `${event.detail} → ${event.action}` : event.detail || event.name;
}

export class EventLog {
  readonly started = new Date();
  private rows: string[][] = [];
  private dropped = 0;

  get size() {
    return this.rows.length + this.dropped;
  }

  record(event: LabEvent, context: string) {
    this.rows.push([
      timestamp(new Date()),
      event.level,
      event.source,
      event.name,
      event.detail,
      event.action,
      context,
    ]);
    if (this.rows.length > MAX_ROWS) {
      this.rows.shift();
      this.dropped++;
    }
  }

  /** With a byte order mark, so Excel shows the accents. */
  toCsv() {
    const lines = [COLUMNS, ...this.rows].map((row) => row.map(csvField).join(','));
    return `\uFEFF${lines.join('\r\n')}\r\n`;
  }

  get fileName() {
    const d = this.started;
    const date = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
    const time = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    return `eventos_web_${date}_${time}.csv`;
  }

  download() {
    const url = URL.createObjectURL(new Blob([this.toCsv()], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = this.fileName;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
