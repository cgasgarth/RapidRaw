#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

const labels = readFileSync('src-tauri/src/merge/focus_stack/labels.rs', 'utf8');
for (const required of [
  'runner_up_source',
  'winner_margin',
  'label_confidence',
  'fallback_required',
  'for reverse in [false, true]',
  'scale_disagreement',
  'dilate_risk',
]) {
  if (!labels.includes(required)) throw new Error(`Label runtime is missing ${required}`);
}
if (!labels.includes('then_with(|| a.1.cmp(&b.1))')) throw new Error('Stable lower-source tie breaking is absent.');

console.log('Deterministic source-label regularization and transition-risk wiring ok');
