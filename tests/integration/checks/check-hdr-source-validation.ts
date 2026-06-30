#!/usr/bin/env bun

import {
  detectHdrBracketV1,
  type HdrBracketDetectionOptionsV1,
  type HdrBracketDetectionSourceInputV1,
  hdrBracketDetectionRequestV1Schema,
} from '../../../packages/rawengine-schema/src/hdrBracketDetection.ts';
import type {
  HdrBracketDetectionResultV1,
  HdrMergeBlockCodeV1,
  HdrMergeWarningCodeV1,
} from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';

const failures: string[] = [];

type SourceOverrides = Partial<
  Omit<HdrBracketDetectionSourceInputV1, 'height' | 'imagePath' | 'sourceIndex' | 'width'>
>;

const baseSource = (sourceIndex: number, declaredExposureEv: number, overrides: SourceOverrides = {}) =>
  ({
    cameraMake: 'Nikon',
    cameraModel: 'Z8',
    bitDepth: 14,
    captureTimestamp: `2026-06-19T12:00:0${sourceIndex}.000Z`,
    cfaPattern: 'rggb',
    contentHash: `sha256:hdr-source-${sourceIndex}`,
    cropFactor: 1,
    declaredExposureEv,
    focalLengthMm: 35,
    graphRevision: `graph_hdr_source_${sourceIndex}`,
    height: 4024,
    imageId: `img_hdr_${sourceIndex}`,
    imagePath: `/photos/hdr/HDR_${sourceIndex}.NEF`,
    lensModel: 'NIKKOR Z 24-70mm f/2.8 S',
    lensProfileId: 'nikon-z-24-70-2-8-s',
    rawActiveArea: { height: 4024, width: 6048, x: 0, y: 0 },
    rawBlackLevelKnown: true,
    rawOrientation: 'normal',
    rawWhiteLevelKnown: true,
    sourceIndex,
    whiteBalanceComparable: true,
    width: 6048,
    ...overrides,
  }) satisfies HdrBracketDetectionSourceInputV1;

const baseBracket = () => [baseSource(0, -2), baseSource(1, 0), baseSource(2, 2)];

const expectBlocks = (
  name: string,
  sources: HdrBracketDetectionSourceInputV1[],
  expectedBlocks: HdrMergeBlockCodeV1[],
  options?: HdrBracketDetectionOptionsV1,
) => {
  const detection = detectHdrBracketV1({ options, sources });
  if (detection.accepted) failures.push(`${name}: expected rejected bracket.`);
  for (const block of expectedBlocks) {
    if (!detection.blockCodes.includes(block)) failures.push(`${name}: missing block ${block}.`);
  }
};

const expectAcceptedWithoutBlocks = (
  name: string,
  sources: HdrBracketDetectionSourceInputV1[],
  options?: HdrBracketDetectionOptionsV1,
) => {
  const detection = detectHdrBracketV1({ options, sources });
  if (!detection.accepted) failures.push(`${name}: expected accepted bracket, got ${detection.blockCodes.join(',')}.`);
  if (detection.blockCodes.length > 0) failures.push(`${name}: expected no blocks.`);
};

const expectOnlyBlocks = (
  name: string,
  sources: HdrBracketDetectionSourceInputV1[],
  expectedBlocks: HdrMergeBlockCodeV1[],
) => {
  const detection = detectHdrBracketV1({ sources });
  if (detection.accepted) failures.push(`${name}: expected rejected bracket.`);
  if (detection.blockCodes.length !== expectedBlocks.length) {
    failures.push(`${name}: expected blocks ${expectedBlocks.join(',')}, got ${detection.blockCodes.join(',')}.`);
  }
  for (const block of expectedBlocks) {
    if (!detection.blockCodes.includes(block)) failures.push(`${name}: missing block ${block}.`);
  }
};

const expectWarnings = (
  name: string,
  sources: HdrBracketDetectionSourceInputV1[],
  expectedWarnings: HdrMergeWarningCodeV1[],
) => {
  const detection = detectHdrBracketV1({ sources });
  if (!detection.accepted) failures.push(`${name}: warning-only bracket should remain accepted.`);
  for (const warning of expectedWarnings) {
    if (!detection.warningCodes.includes(warning)) failures.push(`${name}: missing warning ${warning}.`);
  }
};

const accepted = detectHdrBracketV1({ sources: baseBracket() });
if (!accepted.accepted) failures.push('accepted: valid bracket rejected.');
if (accepted.referenceSourceIndex !== 1) failures.push('accepted: expected 0 EV source as reference.');
if (accepted.bracketSpanEv !== 4) failures.push('accepted: expected 4 EV bracket span.');

expectOnlyBlocks(
  'missing exposure',
  baseBracket().map(({ declaredExposureEv, ...source }) => {
    void declaredExposureEv;
    return source;
  }),
  ['missing_required_exposure_metadata'],
);
const missingExposureDetection = detectHdrBracketV1({
  sources: baseBracket().map(({ declaredExposureEv, ...source }) => {
    void declaredExposureEv;
    return source;
  }),
});
if (missingExposureDetection.sourceMetadata.some((source) => source.resolvedBracketRole !== 'unknown')) {
  failures.push('missing exposure: unresolved sources should expose unknown bracket roles.');
}
expectOnlyBlocks(
  'mixed exposure metadata strategies',
  [
    baseSource(0, -2),
    baseSource(1, 0, { declaredExposureEv: undefined, exposureCompensationEv: 0 }),
    baseSource(2, 0, { aperture: 5.6, declaredExposureEv: undefined, exposureTimeSeconds: 1 / 15, iso: 100 }),
  ],
  ['missing_required_exposure_metadata'],
);
expectBlocks(
  'duplicate exposure',
  baseBracket().map((source) => ({ ...source, declaredExposureEv: 0 })),
  ['duplicate_exposure_values', 'not_a_bracket'],
);
expectBlocks(
  'partial duplicate exposure',
  [baseSource(0, -2), baseSource(1, 0), baseSource(2, 0), baseSource(3, 2)],
  ['duplicate_exposure_values'],
);
expectBlocks(
  'duplicate exposure exact tolerance boundary',
  [baseSource(0, -2), baseSource(1, 0), baseSource(2, 0.05), baseSource(3, 2)],
  ['duplicate_exposure_values'],
  { duplicateExposureToleranceEv: 0.05, irregularSpacingToleranceEv: 3 },
);
expectAcceptedWithoutBlocks(
  'duplicate exposure just above tolerance',
  [baseSource(0, -2), baseSource(1, 0), baseSource(2, 0.051), baseSource(3, 2)],
  { duplicateExposureToleranceEv: 0.05, irregularSpacingToleranceEv: 3 },
);
expectBlocks('too narrow', [baseSource(0, -0.2), baseSource(1, 0), baseSource(2, 0.2)], ['not_a_bracket']);
expectBlocks(
  'dimension mismatch',
  [baseSource(0, -2), baseSource(1, 0, { width: 6040 }), baseSource(2, 2)],
  ['dimension_mismatch'],
);
expectBlocks(
  'canonical raw geometry mismatch',
  [baseSource(0, -2), baseSource(1, 0, { cfaPattern: 'bggr' }), baseSource(2, 2)],
  ['raw_geometry_mismatch'],
);

expectWarnings(
  'camera lens mismatch',
  [baseSource(0, -2), baseSource(1, 0, { lensModel: 'Other Lens' }), baseSource(2, 2)],
  ['camera_or_lens_mismatch'],
);
expectWarnings(
  'lens profile mismatch',
  [baseSource(0, -2), baseSource(1, 0, { lensProfileId: 'other-lens-profile' }), baseSource(2, 2)],
  ['camera_or_lens_mismatch'],
);
expectWarnings(
  'capture gap',
  [
    baseSource(0, -2, { captureTimestamp: '2026-06-19T12:00:00.000Z' }),
    baseSource(1, 0, { captureTimestamp: '2026-06-19T12:00:03.000Z' }),
    baseSource(2, 2, { captureTimestamp: '2026-06-19T12:00:12.000Z' }),
  ],
  ['capture_time_gap_large'],
);
expectWarnings(
  'white balance mismatch',
  [baseSource(0, -2), baseSource(1, 0, { whiteBalanceComparable: false }), baseSource(2, 2)],
  ['white_balance_mismatch'],
);
expectWarnings(
  'raw geometry unverified',
  [baseSource(0, -2), baseSource(1, 0, { rawBlackLevelKnown: false }), baseSource(2, 2)],
  ['dimensions_match_but_raw_geometry_unverified'],
);
expectWarnings(
  'canonical raw geometry missing',
  [baseSource(0, -2), baseSource(1, 0, { rawActiveArea: undefined }), baseSource(2, 2)],
  ['dimensions_match_but_raw_geometry_unverified'],
);
expectWarnings('order inferred', [baseSource(0, 0), baseSource(1, -2), baseSource(2, 2)], ['bracket_order_inferred']);
expectWarnings(
  'irregular spacing',
  [baseSource(0, -3), baseSource(1, 0), baseSource(2, 0.8)],
  ['bracket_spacing_irregular'],
);

const metadataExposureDetection: HdrBracketDetectionResultV1 = detectHdrBracketV1({
  sources: [
    baseSource(0, 0, { aperture: 5.6, declaredExposureEv: undefined, exposureTimeSeconds: 1 / 250, iso: 100 }),
    baseSource(1, 0, { aperture: 5.6, declaredExposureEv: undefined, exposureTimeSeconds: 1 / 60, iso: 100 }),
    baseSource(2, 0, { aperture: 5.6, declaredExposureEv: undefined, exposureTimeSeconds: 1 / 15, iso: 100 }),
  ],
});
if (metadataExposureDetection.detectionMethod !== 'metadata_exposure_time_iso_aperture') {
  failures.push(`metadata exposure: expected metadata method, got ${metadataExposureDetection.detectionMethod}.`);
}
if (!metadataExposureDetection.accepted || metadataExposureDetection.bracketSpanEv < 3) {
  failures.push('metadata exposure: expected accepted bracket with normalized exposure span.');
}

const duplicateSourceIndex = hdrBracketDetectionRequestV1Schema.safeParse({
  sources: [baseSource(0, -2), baseSource(0, 0), baseSource(2, 2)],
});
if (duplicateSourceIndex.success) failures.push('duplicate source index: request schema accepted duplicate indexes.');

if (failures.length > 0) {
  console.error('HDR source validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('hdr source validation ok');
