import { readFileSync } from 'node:fs';

const rustEvents = readFileSync('src-tauri/src/events.rs', 'utf8');
const rustLib = readFileSync('src-tauri/src/lib.rs', 'utf8');
const tsEvents = readFileSync('src/utils/tauriEventNames.ts', 'utf8');
const tsListeners = readFileSync('src/hooks/useTauriListeners.ts', 'utf8');

for (const marker of [
  'pub const PREVIEW_UPDATE_UNCROPPED: &str = "preview-update-uncropped";',
  'pub const WGPU_FRAME_READY: &str = "wgpu-frame-ready";',
  "export const PREVIEW_UPDATE_UNCROPPED_EVENT = 'preview-update-uncropped';",
  "export const WGPU_FRAME_READY_EVENT = 'wgpu-frame-ready';",
  'listen<unknown>(PREVIEW_UPDATE_UNCROPPED_EVENT',
  'listen<unknown>(WGPU_FRAME_READY_EVENT',
]) {
  const source = marker.startsWith('pub const')
    ? rustEvents
    : marker.startsWith('export const')
      ? tsEvents
      : tsListeners;
  if (!source.includes(marker)) {
    throw new Error(`Missing WGPU/preview event marker: ${marker}`);
  }
}

if (rustLib.includes('emit(\n                "wgpu-frame-ready"')) {
  throw new Error('WGPU frame-ready emit must use crate::events::WGPU_FRAME_READY.');
}

if (!rustLib.includes('app_handle.emit(\n                crate::events::WGPU_FRAME_READY,')) {
  throw new Error('WGPU frame-ready emit is not using the Rust event constant.');
}

console.log('tauri wgpu/preview events ok');
