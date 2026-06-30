#!/usr/bin/env bun

import {
  type SuperResolutionSourceValidationBlockCodeV1,
  type SuperResolutionSourceValidationDowngradeReasonV1,
  type SuperResolutionSourceValidationInputV1,
  type SuperResolutionSourceValidationWarningCodeV1,
  validateSuperResolutionSourcesV1,
} from '../../../packages/rawengine-schema/src/superResolutionSourceValidation.ts';

const failures: string[] = [];

type SourceOverrides = Partial<SuperResolutionSourceValidationInputV1>;

const baseSource = (sourceIndex: number, overrides: SourceOverrides = {}) =>
  ({
    cameraMake: 'Sony',
    cameraModel: 'ILCE-7RM5',
    captureTimestamp: `2026-06-19T12:00:0${sourceIndex}.000Z`,
    colorSpaceHint: 'camera-native-linear',
    contentHash: `sha256:sr-source-${sourceIndex}`,
    exposureEv: 0,
    fixtureStatus: 'private_raw',
    graphRevision: `graph_sr_source_${sourceIndex}`,
    height: 6336,
    imageId: `img_sr_${sourceIndex}`,
    imagePath: `/photos/sr/SR_${sourceIndex}.ARW`,
    iso: 100,
    lensModel: 'FE 50mm F1.4 GM',
    rawBlackLevelKnown: true,
    rawDefaultsApplied: true,
    rawWhiteLevelKnown: true,
    shiftX: sourceIndex % 2,
    shiftY: Math.floor(sourceIndex / 2) % 2,
    sourceIndex,
    width: 9504,
    ...overrides,
  }) satisfies SuperResolutionSourceValidationInputV1;

const fourSourceSet = () => [baseSource(0), baseSource(1), baseSource(2), baseSource(3)];

const expectBlocks = (
  name: string,
  sources: SuperResolutionSourceValidationInputV1[],
  expectedBlocks: SuperResolutionSourceValidationBlockCodeV1[],
) => {
  const validation = validateSuperResolutionSourcesV1({ requestedScale: 2, sources });
  if (validation.accepted) failures.push(`${name}: expected rejected source set.`);
  for (const block of expectedBlocks) {
    if (!validation.blockCodes.includes(block)) failures.push(`${name}: missing block ${block}.`);
  }
};

const expectWarnings = (
  name: string,
  sources: SuperResolutionSourceValidationInputV1[],
  expectedWarnings: SuperResolutionSourceValidationWarningCodeV1[],
) => {
  const validation = validateSuperResolutionSourcesV1({ requestedScale: 2, sources });
  if (!validation.accepted) failures.push(`${name}: warning-only source set should remain accepted.`);
  for (const warning of expectedWarnings) {
    if (!validation.warningCodes.includes(warning)) failures.push(`${name}: missing warning ${warning}.`);
  }
};

const expectDowngrades = (
  name: string,
  sources: SuperResolutionSourceValidationInputV1[],
  requestedScale: number,
  expectedScale: number,
  expectedDowngrades: SuperResolutionSourceValidationDowngradeReasonV1[],
) => {
  const validation = validateSuperResolutionSourcesV1({ requestedScale, sources });
  if (!validation.accepted) failures.push(`${name}: downgrade source set should remain accepted.`);
  if (validation.effectiveScale !== expectedScale) {
    failures.push(`${name}: expected effective scale ${expectedScale}, got ${validation.effectiveScale}.`);
  }
  for (const downgrade of expectedDowngrades) {
    if (!validation.downgradeReasons.includes(downgrade)) failures.push(`${name}: missing downgrade ${downgrade}.`);
  }
};

const accepted = validateSuperResolutionSourcesV1({ requestedScale: 2, sources: fourSourceSet() });
if (!accepted.accepted) failures.push('accepted: valid source set rejected.');
if (accepted.effectiveScale !== 2) failures.push('accepted: expected effective x2 scale.');
if (accepted.referenceSourceIndex !== 0) failures.push('accepted: expected zero-shift source as reference.');

expectBlocks('source count', [baseSource(0)], ['source_count_too_low']);
expectBlocks(
  'duplicate source indexes',
  [baseSource(0), baseSource(0), baseSource(2), baseSource(3)],
  ['duplicate_source_indexes'],
);
expectBlocks(
  'dimension mismatch',
  [baseSource(0), baseSource(1, { width: 9000 }), baseSource(2), baseSource(3)],
  ['dimension_mismatch'],
);

expectWarnings(
  'camera lens mismatch',
  [baseSource(0), baseSource(1, { lensModel: 'Other Lens' }), baseSource(2)],
  ['camera_or_lens_mismatch'],
);
expectWarnings(
  'color space mismatch',
  [baseSource(0), baseSource(1, { colorSpaceHint: 'display-p3-linear' })],
  ['color_space_mismatch'],
);
expectWarnings('missing hashes', [baseSource(0), baseSource(1, { contentHash: undefined })], ['content_hash_missing']);
expectWarnings(
  'missing graph revision',
  [baseSource(0), baseSource(1, { graphRevision: undefined })],
  ['graph_revision_missing'],
);
expectWarnings(
  'raw defaults missing',
  [baseSource(0), baseSource(1, { rawDefaultsApplied: false })],
  ['raw_defaults_missing'],
);
expectWarnings('source order inferred', [baseSource(2), baseSource(1), baseSource(0)], ['source_order_inferred']);

expectDowngrades('requested x4 too few sources', fourSourceSet(), 4, 2, [
  'insufficient_source_count_for_requested_scale',
]);
expectDowngrades(
  'missing shift metadata',
  [baseSource(0, { shiftX: undefined, shiftY: undefined }), baseSource(1), baseSource(2), baseSource(3)],
  2,
  1,
  ['missing_subpixel_shift_metadata'],
);
expectDowngrades('raw geometry unverified', [baseSource(0), baseSource(1, { rawWhiteLevelKnown: false })], 2, 1, [
  'raw_geometry_unverified',
]);
expectDowngrades(
  'public fixture metadata',
  [baseSource(0), baseSource(1, { fixtureStatus: 'public_fixture_metadata_only' })],
  2,
  1,
  ['public_fixture_metadata_only'],
);
expectDowngrades('exposure mismatch', [baseSource(0), baseSource(1, { exposureEv: 0.5 })], 2, 1, [
  'exposure_or_iso_mismatch',
]);

if (failures.length > 0) {
  console.error('super-resolution source validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('sr source validation ok');
