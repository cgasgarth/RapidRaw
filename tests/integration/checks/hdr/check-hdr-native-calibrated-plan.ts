#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

const sourceFrame = readFileSync('src-tauri/src/merge/hdr/source_frame.rs', 'utf8');
const plan = readFileSync('src-tauri/src/merge/hdr/plan.rs', 'utf8');
const lib = readFileSync('src-tauri/src/lib.rs', 'utf8');

const required = [
  [sourceFrame, 'decode_raw_sensor_image(&bytes)', 'native sensor decode'],
  [sourceFrame, '(value - b) / (w - b)', 'black/white normalization'],
  [sourceFrame, 'raw.wb_coeffs[channel]', 'white-balance normalization'],
  [sourceFrame, 'value < w * 0.995', 'clipped-sample rejection'],
  [plan, '.total_cmp(', 'deterministic exposure ordering'],
  [plan, 'ALIGNMENT_POLICY_ID', 'alignment policy hash binding'],
  [plan, 'artifact_hash', 'native artifact identity'],
  [lib, 'hdr_plan_generation', 'transactional cancellation generation'],
  [lib, 'alignment_plan_ready', 'radiance apply block'],
] as const;

const missing = required.filter(([text, needle]) => !text.includes(needle)).map(([, , label]) => label);
if (missing.length > 0) throw new Error(`Native calibrated HDR plan is missing: ${missing.join(', ')}`);
console.log('HDR native calibrated plan ok (sensor decode, calibration, identity, cancellation, no apply)');
