# SOFIA Web

The SOFIA kinematic lab as a web app: a 3D simulation of the 16-unit panel,
selectable joint filters, and hand tracking and gestures from the webcam. It
runs entirely in the browser, on a laptop or desktop.

Panel 00 also controls the real panel over Wi‑Fi through the SOFIA Maestro
(the ESP32 in `sofia-firmware`); see [Real panel](#real-panel).

## Requirements

- Node.js 22.12 or newer and [pnpm](https://pnpm.io).
- A browser with WebGL.
- Internet once, during `pnpm install`. After that the app needs none.

## Setup

```bash
pnpm install
```

This also runs `scripts/fetch-assets.mjs`, which puts the MediaPipe wasm and
the hand model (the same as `sofia-tracker`'s) in `public/mediapipe/` (about
27 MB, gitignored). If the download fails, everything but the camera still
works; run `node scripts/fetch-assets.mjs` again with internet.

## Usage

```bash
pnpm dev            # development server at http://localhost:5173
pnpm build          # type-check and build into dist/
pnpm preview        # serve the build at http://localhost:4173
pnpm lint           # ESLint
```

The camera needs `http://localhost` or HTTPS; `pnpm dev` and `pnpm preview`
serve on localhost. On a touchscreen, one finger orbits the view and a pinch
zooms; in Cursor mode one finger moves the target and two fingers orbit.

## Files

- `src/core/`: kinematics, filters, trajectories, plate collision detection and
  `choreography.ts`, the motion of each gesture (a copy of
  `sofia-firmware/src/choreography.cpp`). Plain functions with no DOM or React,
  in mm, rad and s.
- `src/perception/`: `CameraTracker` runs MediaPipe on the webcam.
  `handRecognizer.ts` is `sofia-tracker`'s gesture recognizer (a copy of its
  `gestures.py`); `gestures.ts` holds the gesture texts and turns body and hand
  positions into targets.
- `src/simulation/`: `Simulation` is the fixed 120 Hz step. `LabEngine` connects
  it to the scene and the camera and runs the frame loop. `targets.ts` holds the
  target sources and `csv.ts` the data export.
- `src/scene/`: `SofiaScene`, the three.js view, including mouse and touch
  input.
- `src/hardware/`: the link to the Maestro. `protocol.ts` encodes and decodes
  frames (mirrors `sofia-firmware/src/protocol.h`); `MaestroLink` is the
  WebSocket client, with reconnection.
- `src/diagnostics/eventLog.ts`: the session's event log (errors,
  recoveries, commands), downloadable as CSV.
- `src/state/store.ts`: Zustand store with what the UI shows. Its actions call
  the engine and the link.
- `src/ui/`: React components. `panels/` are the control sections, `stage/` what
  sits over the 3D view, `layout/` the page frame and `common/` shared pieces.
- `src/styles/app.css`: Tailwind setup. It holds the theme (colors, text sizes), the layout variants (`wide`, `medium`, `low`) and the default look of buttons and form fields. Everything else is utility classes on the components.
- `scripts/fetch-assets.mjs`: fetches the MediaPipe assets.

The simulation runs outside React. React renders the settings from the store,
and `useTelemetry` delivers the fast values (angles, error, clock, chart) about
12 times per second, so the UI doesn't re-render at 120 Hz.

## Origin

This project is the modular version of `SOFIA_Camara_TRACK.html`. The
kinematics, filters and camera logic are ported with no intended changes. The
exception is the filters' default settings, which now follow the filters session
(`03 Aplicación de Filtros`): the session runs at 32 ms and this app at 1/120 s,
so settings counted in samples are converted to keep the same duration. CSV
exports therefore differ from the original's for those filters, unless their
settings are changed back. The plate size also differs: it now matches
`module.step` and drawing `Sofia003-E001-04_2`. The default spacing is 150 mm, and
`z12 = 22` and `z23 = 37` come from the technical specification instead of the
MATLAB values of 60 and 100.
The original's USB link wasn't ported: the real panel is reached over Wi‑Fi
instead (below). Its hand gestures (open palm, fist, V, index up and the
two-hand heart, from MediaPipe's gesture recognizer) were replaced by
`sofia-tracker`'s six.

## Hand gestures

Panel 04 (Cámara · gestos de mano) recognises the same six gestures as
`sofia-tracker` (INDEX, V, PALM, SWIPE_LEFT, SWIPE_RIGHT, GRAB) with the same
model and rules, and the panel behaves like the Maestro: each gesture plays its
motion once, between gestures the panel follows the hand, and without a hand
it holds the pose after 0.5 s. While this browser controls the real panel
(panel 00), the gestures and the hand's position are also sent to the Maestro,
as `sofia-tracker` sends them.

Two files are copies that must be kept in step with their originals:

| File | Copy of |
|---|---|
| `src/perception/handRecognizer.ts` | `sofia-tracker/gestures.py` |
| `src/core/choreography.ts` | `sofia-firmware/src/choreography.cpp` |

## Real panel

The Maestro creates the Wi‑Fi network `SOFIA-Maestro` (password
`sofia-maestro`) and accepts the commands of
`sofia-firmware/docs/PROTOCOL.md` over a WebSocket at `ws://192.168.4.1:81/`.

1. Connect the computer to `SOFIA-Maestro` and run `pnpm dev`.
2. Open `http://localhost:5173`, panel **00 Panel real · Wi‑Fi**, and press
   **Conectar**.

The page must be served over plain HTTP (as `pnpm dev` does): an `https://`
page can't open a `ws://` connection.

What the panel does:

- **Armar** takes control and powers the servos (the Maestro switches them on
  one by one). Only one client controls SOFIA at a time; the others, such as
  `sofia-tracker`, are refused until it's released.
- **STOP** (in the panel and over the 3D view) holds the pose and releases
  control. It works from any client, controlling or not. **Apagar servos**
  turns the PWM off.
- **Gestos** plays the motion for each of `sofia-tracker`'s gestures. The
  Maestro computes the motions; the browser only names the gesture.
- **Apuntar** sends the point under the pointer while it's pressed, as
  `sofia-tracker` sends the hand's position. On release the Maestro holds the
  pose after 0.5 s.
- While connected, the 3D view mirrors the real panel: it shows the angles
  the Maestro commands (polled 10 times per second) instead of the
  simulation, and the stage says **PANEL REAL**.
- **Latencia** is the 95th percentile of command-to-response time and the
  share answered within 500 ms, for the paper's targets (≤ 250 ms and
  ≥ 99 %).

With the camera on (panel 04), recognised gestures and
the hand's position are sent too; see [Hand gestures](#hand-gestures).

### Errors and recovery

The same rules and event names as `sofia-tracker` (its
`docs/MANEJO_DE_ERRORES.md` describes them). Two events are only here:
`CONEXION_FALLIDA` (the first connection failed) and `CONEXION_CERRADA` (a
new socket closed again during the same outage).

- **Link lost.** If the WebSocket closes (Maestro rebooted or out of range),
  the state shows *Reconectando…* and the page reconnects every 2 s until
  **Desconectar**. If it stays open but nothing answers, the state shows
  *Sin respuesta*, and after 5 s a new connection is opened. A first
  connection that fails is reported instead (wrong address or network).
- **Control.** The Maestro releases a browser's control as soon as its
  connection closes. If you had pressed **Armar**, the page sends it again as
  soon as the link answers, unless the outage lasted more than 30 s, you
  pressed STOP, or another client took control. A STOP without an answer is
  sent again until the Maestro confirms it. Gestures are dropped while the
  link isn't answering instead of being played late.
- **Camera lost** (unplugged, taken by another program): the camera is
  requested again every 2 s with the hand model kept loaded. A camera that
  can't be opened when pressing **Activar cámara** is reported instead.
  Hiding the tab still turns the camera off.
- **Unexpected errors** are logged and the page keeps running.

Every event (gestures, commands, errors and recoveries, with the page's
state at that moment) goes to the session's event log; **Descargar CSV** in
panel 00 saves it as `eventos_web_<date>_<time>.csv`, with the same columns
as `sofia-tracker`'s log. It lives in memory: download it before closing
the tab. Warnings, errors and recoveries also show as toasts.
