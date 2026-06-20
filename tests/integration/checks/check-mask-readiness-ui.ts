#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

const source = readFileSync('src/components/panel/right/MasksPanel.tsx', 'utf8');

for (const marker of [
  'activeMaskHasBrush',
  'activeMaskHasGradient',
  'activeMaskHasRange',
  'data-testid="mask-readiness-summary"',
  'data-testid="mask-readiness-components"',
  'data-testid="mask-readiness-brush"',
  'data-testid="mask-readiness-gradient"',
  'data-testid="mask-readiness-range"',
  'data-has-brush={String(activeMaskHasBrush)}',
  'data-has-gradient={String(activeMaskHasGradient)}',
  'data-has-range={String(activeMaskHasRange)}',
  'data-component-count={activeContainer.subMasks.length}',
]) {
  if (!source.includes(marker)) {
    console.error(`Mask readiness UI missing marker: ${marker}`);
    process.exit(1);
  }
}

console.log('mask readiness UI ok');
