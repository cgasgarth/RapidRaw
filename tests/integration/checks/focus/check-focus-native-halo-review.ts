#!/usr/bin/env bun
import { readFileSync } from 'node:fs';

const blend = readFileSync('src-tauri/src/merge/focus_stack/blend.rs', 'utf8');
const review = readFileSync('src-tauri/src/merge/focus_stack/review.rs', 'utf8');
for (const token of ['strength_percent', '* 8.0 / 100.0', 'owner_expanded_pixels', 'ownership_ambiguous'])
  if (!blend.includes(token)) throw new Error(`halo policy missing ${token}`);
for (const token of [
  'halo_risk_overlay_data_url',
  'fallback_overlay_data_url',
  'edge_owner_overlay_data_url',
  'native_measured_v1',
  'blend_result_hash',
])
  if (!review.includes(token)) throw new Error(`measured review missing ${token}`);
console.log('bounded halo policy and exact-output review maps ok');
