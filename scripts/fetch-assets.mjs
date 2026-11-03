// Puts everything MediaPipe needs under public/mediapipe, so the camera works
// without internet (the SOFIA-Maestro Wi-Fi network has none).
//
// Runs on `pnpm install`. The wasm comes from node_modules; the two models are
// downloaded once and skipped afterwards.

import { cp, mkdir, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'public', 'mediapipe');

const MODELS = {
  'pose_landmarker_lite.task':
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  'gesture_recognizer.task':
    'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task',
};

async function exists(path) {
  try {
    return (await stat(path)).size > 0;
  } catch {
    return false;
  }
}

async function download(name, url) {
  const path = join(target, 'models', name);
  if (await exists(path)) return;
  console.log(`Downloading ${name}...`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  // Written under another name first, so a failed download isn't mistaken for a finished one.
  await writeFile(`${path}.part`, new Uint8Array(await response.arrayBuffer()));
  await rename(`${path}.part`, path);
}

await cp(join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm'), join(target, 'wasm'), {
  recursive: true,
});
await mkdir(join(target, 'models'), { recursive: true });

try {
  await Promise.all(Object.entries(MODELS).map(([name, url]) => download(name, url)));
} catch (error) {
  // Everything but the camera still works, so don't fail the install.
  console.warn(`Could not download the detection models: ${error.message}`);
  console.warn('The camera won\'t work until you run `node scripts/fetch-assets.mjs` with internet.');
}
