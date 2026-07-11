#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

const runtime = readFileSync('src-tauri/src/merge/hdr/runtime.rs', 'utf8');
const app = readFileSync('src-tauri/src/lib.rs', 'utf8');
const sidecar = readFileSync('src-tauri/src/merge/hdr_artifact_sidecar.rs', 'utf8');

const contracts = [
  [runtime, 'pub(crate) fn reconstruct(', 'native full-resolution renderer'],
  [runtime, 'estimate(&samples)', 'radiance reconstruction'],
  [runtime, 'tone_map(image:', 'independent tone-map recipe'],
  [app, 'scene-linear.rgb16f', 'half-float internal artifact'],
  [app, 'motion-probability.bin', 'persisted motion map'],
  [app, 'source-selection.bin', 'persisted source-selection map'],
  [sidecar, '"sceneMergeColorState": "scene_linear"', 'scene-linear provenance'],
  [sidecar, '"resolvedAlignmentMode": "bounded_translation"', 'measured alignment provenance'],
] as const;
const missing = contracts.filter(([text, needle]) => !text.includes(needle)).map(([, , label]) => label);
if (missing.length > 0) throw new Error(`Native scene-linear HDR runtime missing: ${missing.join(', ')}`);
for (const forbidden of ['rapidraw_image_hdr_legacy_v1', 'srgb_display_referred_v1']) {
  if (sidecar.includes(forbidden)) throw new Error(`Native sidecar retains legacy claim: ${forbidden}`);
}
console.log('HDR native scene-linear runtime ok (apply, artifact, tone map, masks, provenance)');
