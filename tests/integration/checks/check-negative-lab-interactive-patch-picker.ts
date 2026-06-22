#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import { $ } from 'bun';

const modalSource = readFileSync('src/components/modals/NegativeConversionModal.tsx', 'utf8');
const smokeSource = readFileSync('scripts/capture-visual-smoke.ts', 'utf8');
const proofSource = readFileSync('scripts/lib/visual-smoke-proofs.ts', 'utf8');
const helperSource = readFileSync('src/utils/negativeLabPatchPicker.ts', 'utf8');

for (const marker of [
  'buildNegativeLabPickedPatchRect',
  'negative-lab-pick-viewer-patch',
  'negative-lab-patch-role-${role}',
  'negative-lab-preview-image',
  'negative-lab-patch-pick-draft-overlay',
  'handlePatchPickPointerDown',
  'handlePatchPickPointerMove',
  'handlePatchPickPointerUp',
]) {
  if (!modalSource.includes(marker) && !helperSource.includes(marker)) {
    throw new Error(`Negative Lab interactive patch picker marker missing: ${marker}`);
  }
}

for (const marker of [
  'negative-lab-pick-viewer-patch',
  'negative-lab-preview-image',
  'estimate_negative_base_fog',
  'negativeLabPickedNeutralPatchSampleSchema',
]) {
  if (!smokeSource.includes(marker) && !proofSource.includes(marker)) {
    throw new Error(`Negative Lab interactive patch picker smoke marker missing: ${marker}`);
  }
}

await $`bun test tests/pure-ts/negative-lab-patch-picker.test.ts`.quiet();

console.log('negative lab interactive patch picker ok');
