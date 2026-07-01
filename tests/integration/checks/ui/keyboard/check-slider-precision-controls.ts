#!/usr/bin/env bun

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const sliderSource = readFileSync('src/components/ui/primitives/Slider.tsx', 'utf8');
const adjustmentSliderSource = readFileSync('src/components/adjustments/AdjustmentSlider.tsx', 'utf8');
const tokensSource = readFileSync('src/components/ui/inspectorTokens.ts', 'utf8');
const unitCoverageSource = readFileSync('tests/pure-ts/adjustments/adjustment-slider.test.ts', 'utf8');

assertContains(sliderSource, 'testId?: string;', 'Slider exposes optional stable test hooks.');
assertContains(adjustmentSliderSource, 'testId?: string;', 'AdjustmentSlider forwards optional stable test hooks.');
assertContains(sliderSource, 'data-testid={testId ? `${testId}-range` : undefined}', 'Range input has stable hook.');
assertContains(sliderSource, 'data-testid={testId ? `${testId}-value` : undefined}', 'Value button has stable hook.');
assertContains(sliderSource, 'data-testid={testId ? `${testId}-input` : undefined}', 'Numeric input has stable hook.');
assertContains(sliderSource, 'e.stopPropagation();', 'Numeric edit keydown isolates global shortcuts.');
assertContains(sliderSource, 'skipNextBlurCommitRef.current = true;', 'Enter/Escape prevent duplicate blur commits.');
assertContains(sliderSource, "e.key === 'Escape'", 'Numeric edit supports Escape cancel.');
assertContains(sliderSource, "e.key === 'ArrowUp' || e.key === 'ArrowDown'", 'Numeric edit supports arrow increments.');
assertContains(
  sliderSource,
  'snapToStep(displayValueRef.current + direction * step)',
  'Shift-wheel uses current displayed value.',
);
assertContains(
  tokensSource,
  'grid-cols-[minmax(4.5rem,0.74fr)_minmax(5.25rem,1fr)_3.25rem]',
  'Compact row reserves numeric slot.',
);
assertContains(tokensSource, "valueSlot: 'w-[3.25rem] shrink-0 text-right'", 'Compact numeric value slot is fixed.');
assertContains(
  unitCoverageSource,
  'numeric edits commit, cancel, and increment predictably',
  'Unit coverage includes edit keyboard path.',
);
assertContains(
  unitCoverageSource,
  'shift wheel edits and label reset hooks',
  'Unit coverage includes compact wheel/reset path.',
);

console.log('slider precision controls keyboard/ui ok');

function assertContains(source: string, snippet: string, message: string) {
  assert.ok(source.includes(snippet), message);
}
