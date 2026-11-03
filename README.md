# SOFIA Web

The SOFIA kinematic lab as a web app: a 3D simulation of the 16-unit panel,
selectable joint filters, and body and gesture tracking from the webcam. It
runs entirely in the browser and also works on a phone.

At this stage it only simulates. Nothing here moves the servos yet; see
[Planned ESP32 link](#planned-esp32-link).

## Requirements

- Node.js 22.12 or newer and [pnpm](https://pnpm.io).
- A browser with WebGL. Chrome or Edge are needed to record the page.
- Internet once, during `pnpm install`. After that the app needs none.

## Setup

```bash
pnpm install
```

This also runs `scripts/fetch-assets.mjs`, which puts the MediaPipe wasm and
the two detection models in `public/mediapipe/` (about 33 MB, gitignored). If
the download fails, everything but the camera still works; run
`node scripts/fetch-assets.mjs` again with internet.

## Usage

```bash
pnpm dev            # development server at http://localhost:5173
pnpm build          # type-check and build into dist/
pnpm preview        # serve the build at http://localhost:4173
pnpm lint           # ESLint
```

### On a phone

Connect the phone to the same network as the computer, then:

```bash
pnpm dev:phone
```

Open the `https://` Network address it prints on the phone, and accept the
certificate warning. The certificate is self-signed; HTTPS is needed because
phones block the camera on plain `http://`.

Below 760 px the controls become a bottom sheet with tabs. One finger orbits
the view and a pinch zooms. In Cursor mode one finger moves the target and two
fingers orbit.

## Files

- `src/core/`: kinematics, filters, trajectories and plate collision detection.
  Plain functions with no DOM or React, in mm, rad and s.
- `src/perception/`: `CameraTracker` runs MediaPipe on the webcam; `gestures.ts`
  and `heart.ts` turn landmarks into targets.
- `src/simulation/`: `Simulation` is the fixed 120 Hz step. `LabEngine` connects
  it to the scene and the camera and runs the frame loop. `targets.ts` holds the
  target sources and `csv.ts` the data export.
- `src/scene/`: `SofiaScene`, the three.js view, including mouse and touch
  input.
- `src/recording/`: records the browser tab to a video.
- `src/state/store.ts`: Zustand store with what the UI shows. Its actions call
  the engine.
- `src/ui/`: React components. `panels/` are the control sections, `stage/` what
  sits over the 3D view, `layout/` the page frame and `common/` shared pieces.
- `src/styles/app.css`: Tailwind setup. It holds the theme (colors, text sizes), the layout variants (`wide`, `medium`, `short`, `low`, `compact`, `phone`) and the default look of buttons and form fields. Everything else is utility classes on the components.
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
The USB link wasn't ported, so that HTML and
`SOFIA_Tracking.ino` remain the way to drive the bench servos for now.

## Planned ESP32 link

The physical panel will connect over Wi‑Fi to the SOFIA Maestro, the ESP32 in
`sofia-firmware`: network `SOFIA-Maestro`, address `192.168.4.1:4210`, using the
protocol in `sofia-firmware/docs/PROTOCOL.md`. This is still to be designed.
Points to settle:

- **Browsers can't send UDP.** The Maestro speaks UDP, so something has to sit
  between the web app and it.
- **The firmware has no motion yet.** It only answers PING and has no servo
  code. The PCA9685 and motion code is in `SOFIA_Tracking.ino`.
- **The protocol has no motion commands that fit.** `SET_TARGET` carries only a
  normalized x, y, and `PROTOCOL.md` defines no ARM, STOP or OFF.

`Simulation.jointAngles` already exposes each unit's filtered angles for
whatever ends up sending them.
