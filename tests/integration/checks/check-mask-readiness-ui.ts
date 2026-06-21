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
  'data-testid="mask-component-quick-add"',
  'data-testid={action.testId}',
  'mask-quick-add-brush',
  'mask-quick-add-gradient',
  'mask-quick-add-range',
  'data-has-brush={String(activeMaskHasBrush)}',
  'data-has-gradient={String(activeMaskHasGradient)}',
  'data-has-range={String(activeMaskHasRange)}',
  'data-component-count={activeContainer.subMasks.length}',
  "t('editor.masks.quickAddBrush')",
  "t('editor.masks.quickAddGradient')",
  "t('editor.masks.quickAddRange')",
  "t('editor.masks.quickAddComplete')",
  'handleAddSubMask(activeContainer.id, action.type)',
]) {
  if (!source.includes(marker)) {
    console.error(`Mask readiness UI missing marker: ${marker}`);
    process.exit(1);
  }
}

console.log('mask readiness UI ok');
