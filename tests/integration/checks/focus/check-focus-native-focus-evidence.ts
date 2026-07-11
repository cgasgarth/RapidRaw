#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

const runtime = readFileSync('src-tauri/src/merge/focus_stack/runtime.rs', 'utf8');
const measure = readFileSync('src-tauri/src/merge/focus_stack/focus_measure.rs', 'utf8');
const artifact = readFileSync('src-tauri/src/merge/focus_stack/map_artifact.rs', 'utf8');

for (const required of ['focus_measure::compute', 'select_and_regularize', 'map_artifact::build']) {
  if (!runtime.includes(required)) throw new Error(`Native runtime is missing ${required}`);
}
if (runtime.includes('cells:')) throw new Error('Production focus runtime still accepts caller-supplied cells.');
for (const required of ['exposure_normalization.scalar', 'response_at_scale', 'noise_sigma', 'clip_guard']) {
  if (!measure.includes(required)) throw new Error(`Focus response does not expose ${required}`);
}
for (const required of ['RRFSMAP', 'blake3::hash', 'focus_map_length_mismatch', 'focus_map_nonfinite_or_negative']) {
  if (!artifact.includes(required)) throw new Error(`Map artifact contract is missing ${required}`);
}

console.log('Native aligned focus evidence and strict map artifact wiring ok');
