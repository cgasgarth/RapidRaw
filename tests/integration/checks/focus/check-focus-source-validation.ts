#!/usr/bin/env bun

import {
  type FocusStackSourceValidationBlockCodeV1,
  type FocusStackSourceValidationInputV1,
  type FocusStackSourceValidationWarningCodeV1,
  validateFocusStackSourcesV1,
} from '../../../../packages/rawengine-schema/src/focus-stack/focusStackSourceValidation.ts';

const failures: string[] = [];

type SourceOverrides = Partial<FocusStackSourceValidationInputV1>;

const baseSource = (sourceIndex: number, focusDistanceMm: number, overrides: SourceOverrides = {}) =>
  ({
    cameraMake: 'Canon',
    cameraModel: 'EOS R5',
    captureTimestamp: `2026-06-19T12:00:0${sourceIndex}.000Z`,
    contentHash: `sha256:focus-source-${sourceIndex}`,
    exposureEv: 0,
    focusDistanceMm,
    graphRevision: `graph_focus_source_${sourceIndex}`,
    height: 3648,
    imageId: `img_focus_${sourceIndex}`,
    imagePath: `/photos/focus/FOCUS_${sourceIndex}.CR3`,
    iso: 100,
    lensModel: 'RF 100mm F2.8L Macro IS USM',
    rawBlackLevelKnown: true,
    rawWhiteLevelKnown: true,
    sourceIndex,
    whiteBalanceComparable: true,
    width: 5472,
    ...overrides,
  }) satisfies FocusStackSourceValidationInputV1;

const baseStack = () => [baseSource(0, 180), baseSource(1, 240), baseSource(2, 320)];

const expectBlocks = (
  name: string,
  sources: FocusStackSourceValidationInputV1[],
  expectedBlocks: FocusStackSourceValidationBlockCodeV1[],
) => {
  const validation = validateFocusStackSourcesV1({ sources });
  if (validation.accepted) failures.push(`${name}: expected rejected stack.`);
  for (const block of expectedBlocks) {
    if (!validation.blockCodes.includes(block)) failures.push(`${name}: missing block ${block}.`);
  }
};

const expectWarnings = (
  name: string,
  sources: FocusStackSourceValidationInputV1[],
  expectedWarnings: FocusStackSourceValidationWarningCodeV1[],
) => {
  const validation = validateFocusStackSourcesV1({ sources });
  if (!validation.accepted) failures.push(`${name}: warning-only stack should remain accepted.`);
  for (const warning of expectedWarnings) {
    if (!validation.warningCodes.includes(warning)) failures.push(`${name}: missing warning ${warning}.`);
  }
};

const accepted = validateFocusStackSourcesV1({ sources: baseStack() });
if (!accepted.accepted) failures.push('accepted: valid focus stack rejected.');
if (accepted.referenceSourceIndex !== 1) failures.push('accepted: expected middle focus distance as reference.');
if (accepted.focusSpanMm !== 140) failures.push('accepted: expected 140mm focus span.');

expectBlocks('source count', [baseSource(0, 180)], ['source_count_too_low']);
expectBlocks(
  'duplicate source indexes',
  [baseSource(0, 180), baseSource(0, 240), baseSource(2, 320)],
  ['duplicate_source_indexes'],
);
expectBlocks(
  'dimension mismatch',
  [baseSource(0, 180), baseSource(1, 240, { width: 5400 }), baseSource(2, 320)],
  ['dimension_mismatch'],
);

expectWarnings(
  'camera lens mismatch',
  [baseSource(0, 180), baseSource(1, 240, { lensModel: 'Other Macro' }), baseSource(2, 320)],
  ['camera_or_lens_mismatch'],
);
expectWarnings(
  'exposure mismatch',
  [baseSource(0, 180), baseSource(1, 240, { exposureEv: 0.4 }), baseSource(2, 320)],
  ['exposure_or_iso_mismatch'],
);
expectWarnings(
  'white balance mismatch',
  [baseSource(0, 180), baseSource(1, 240, { whiteBalanceComparable: false }), baseSource(2, 320)],
  ['white_balance_mismatch'],
);
expectWarnings(
  'raw geometry unverified',
  [baseSource(0, 180), baseSource(1, 240, { rawWhiteLevelKnown: false }), baseSource(2, 320)],
  ['raw_geometry_unverified'],
);
expectWarnings(
  'order inferred',
  [baseSource(0, 240), baseSource(1, 180), baseSource(2, 320)],
  ['focus_order_inferred'],
);
expectWarnings(
  'missing focus distance',
  [baseSource(0, 180), baseSource(1, 240, { focusDistanceMm: undefined }), baseSource(2, 320)],
  ['focus_order_inferred'],
);
expectWarnings(
  'irregular spacing',
  [baseSource(0, 180), baseSource(1, 205), baseSource(2, 420)],
  ['focus_spacing_irregular'],
);

if (failures.length > 0) {
  console.error('Focus source validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('focus source validation ok');
