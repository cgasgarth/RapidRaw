#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

import {
  type NegativeLabConversionPlanResult,
  negativeLabPositiveOutputReceiptSchema,
} from '../../../../src/schemas/negative-lab/negativeLabAppServerSchemas.ts';
import {
  buildNegativeLabPositiveOutputReceipts,
  type NegativeLabPositiveVariant,
} from '../../../../src/utils/negative-lab/negativeLabExportHandoff.ts';
import {
  buildNegativeLabBatchDryRunSummary,
  buildNegativeLabFrameHealthReport,
} from '../../../../src/utils/negative-lab/negativeLabFrameHealth.ts';
import {
  buildNegativeLabAcceptedApplyPlanFingerprint,
  buildNegativeLabAcceptedPlanIdentity,
  getNegativeLabAcceptedApplyPlanStaleReasons,
  isNegativeLabAcceptedApplyPlanCurrent,
} from '../../../../src/utils/negative-lab/negativeLabPlanIdentity.ts';
import { DEFAULT_NEGATIVE_LAB_UI_PRESET } from '../../../../src/utils/negative-lab/negativeLabPresetCatalog.ts';

const targetPaths = ['/proof-roll/negative-lab/frame_001.CR3', '/proof-roll/negative-lab/frame_002.CR3'];
const frameHealthReport = buildNegativeLabFrameHealthReport({
  activePathIndex: 0,
  baseFogConfidence: 0.94,
  cropStatusByFrameId: {},
  includedPathSet: new Set(targetPaths),
  previewReady: true,
  targetPaths,
});
const dryRunSummary = buildNegativeLabBatchDryRunSummary(frameHealthReport);
const basePlanJson = JSON.stringify(
  {
    dryRunSummary,
    selectedProfile: null,
  },
  null,
  2,
);
const baseFingerprint = buildNegativeLabAcceptedApplyPlanFingerprint({
  dryRunPlanJson: basePlanJson,
  outputFormat: 'tiff16',
  params: DEFAULT_NEGATIVE_LAB_UI_PRESET.params,
  pathsToConvert: targetPaths,
  selectedProfileSnapshot: null,
  suffix: 'Positive',
  writeConversionBundle: true,
});

if (
  !isNegativeLabAcceptedApplyPlanCurrent({
    acceptedApplyPlanFingerprint: baseFingerprint,
    currentApplyPlanFingerprint: baseFingerprint,
  })
) {
  throw new Error('Accepted Negative Lab apply fingerprint should match the current plan before apply.');
}

for (const [label, fingerprint] of [
  [
    'source image list',
    buildNegativeLabAcceptedApplyPlanFingerprint({
      dryRunPlanJson: basePlanJson,
      outputFormat: 'tiff16',
      params: DEFAULT_NEGATIVE_LAB_UI_PRESET.params,
      pathsToConvert: [targetPaths[0] ?? ''],
      selectedProfileSnapshot: null,
      suffix: 'Positive',
      writeConversionBundle: true,
    }),
  ],
  [
    'conversion params',
    buildNegativeLabAcceptedApplyPlanFingerprint({
      dryRunPlanJson: basePlanJson,
      outputFormat: 'tiff16',
      params: {
        ...DEFAULT_NEGATIVE_LAB_UI_PRESET.params,
        exposure: DEFAULT_NEGATIVE_LAB_UI_PRESET.params.exposure + 0.1,
      },
      pathsToConvert: targetPaths,
      selectedProfileSnapshot: null,
      suffix: 'Positive',
      writeConversionBundle: true,
    }),
  ],
  [
    'output format',
    buildNegativeLabAcceptedApplyPlanFingerprint({
      dryRunPlanJson: basePlanJson,
      outputFormat: 'jpeg_proof',
      params: DEFAULT_NEGATIVE_LAB_UI_PRESET.params,
      pathsToConvert: targetPaths,
      selectedProfileSnapshot: null,
      suffix: 'Positive',
      writeConversionBundle: true,
    }),
  ],
  [
    'profile snapshot',
    buildNegativeLabAcceptedApplyPlanFingerprint({
      dryRunPlanJson: basePlanJson,
      outputFormat: 'tiff16',
      params: DEFAULT_NEGATIVE_LAB_UI_PRESET.params,
      pathsToConvert: targetPaths,
      selectedProfileSnapshot: {
        claimLevel: 'generic_starting_point_only',
        claimPolicy: 'generic_starting_point_no_stock_claim',
        crosstalkProfile: null,
        displayName: 'Generic changed profile',
        doesNotProve: [],
        evidenceFixtureCount: 0,
        filmClass: 'color_negative',
        measurementProfileId: null,
        params: DEFAULT_NEGATIVE_LAB_UI_PRESET.params,
        presetId: DEFAULT_NEGATIVE_LAB_UI_PRESET.presetId,
        profileProvenanceHash: 'fnv1a32:12345678',
        profileStatus: 'generic_unmeasured',
        provenanceSummary: 'Synthetic profile snapshot for stale-plan coverage.',
        runtimeStatus: 'catalog_metadata_only',
        sourceGenericPresetId: null,
      },
      suffix: 'Positive',
      writeConversionBundle: true,
    }),
  ],
] as const) {
  if (
    isNegativeLabAcceptedApplyPlanCurrent({
      acceptedApplyPlanFingerprint: baseFingerprint,
      currentApplyPlanFingerprint: fingerprint,
    })
  ) {
    throw new Error(`Accepted Negative Lab apply fingerprint did not reject stale ${label}.`);
  }
}
const staleReasons = getNegativeLabAcceptedApplyPlanStaleReasons({
  acceptedApplyPlanFingerprint: baseFingerprint,
  currentApplyPlanFingerprint: buildNegativeLabAcceptedApplyPlanFingerprint({
    dryRunPlanJson: basePlanJson,
    outputFormat: 'jpeg_proof',
    params: {
      ...DEFAULT_NEGATIVE_LAB_UI_PRESET.params,
      exposure: DEFAULT_NEGATIVE_LAB_UI_PRESET.params.exposure + 0.1,
    },
    pathsToConvert: [targetPaths[0] ?? ''],
    selectedProfileSnapshot: null,
    suffix: 'Proof',
    writeConversionBundle: false,
  }),
});
for (const expectedReason of [
  'source_paths_changed',
  'conversion_params_changed',
  'output_format_changed',
  'output_options_changed',
] as const) {
  if (!staleReasons.includes(expectedReason)) {
    throw new Error(`Accepted Negative Lab apply fingerprint did not expose stale reason: ${expectedReason}.`);
  }
}

const acceptedPlanIdentity = buildNegativeLabAcceptedPlanIdentity(baseFingerprint);
const conversionPlan = {
  outputFormat: 'jpeg_proof',
  params: DEFAULT_NEGATIVE_LAB_UI_PRESET.params,
  profileProvenanceHash: 'fnv1a32:abcdef12',
  suffix: 'Positive',
} as NegativeLabConversionPlanResult;
const positiveVariants: NegativeLabPositiveVariant[] = dryRunSummary.frameHealthReport.frames.map((frame, index) => ({
  frameId: frame.frameId,
  operationId: `op_negative_lab_output_${index + 1}`,
  outputArtifact: {
    artifactId: `artifact_negative_lab_positive_${index + 1}`,
    contentHash: `sha256:positive-preview-${index + 1}`,
    dimensions: { height: 1200, width: 1800 },
    kind: 'preview',
    storage: 'temp_cache',
  },
  outputIntent: 'editable_positive',
  sourceContentHash: `sha256:source-negative-${index + 1}`,
  sourcePath: frame.sourcePath,
  warnings: [],
}));
const outputs = buildNegativeLabPositiveOutputReceipts({
  acceptedPlanIdentity,
  conversionPlan,
  dryRunSummary,
  positiveVariants,
});

if (outputs.exportedPositives.length !== targetPaths.length || outputs.rejectedFrames.length !== 0) {
  throw new Error('Negative Lab accepted apply should build an output receipt for each affected source frame.');
}

for (const receipt of outputs.exportedPositives) {
  negativeLabPositiveOutputReceiptSchema.parse(receipt);
  if (receipt.outputFormat !== 'jpeg_proof' || !receipt.outputPath.endsWith('-Positive.jpg')) {
    throw new Error('Negative Lab output receipt did not preserve the selected JPEG proof format.');
  }
  if (receipt.outputPath === receipt.sourcePath) {
    throw new Error('Negative Lab output receipt attempted to overwrite the source negative.');
  }
  if (!targetPaths.includes(receipt.sourcePath)) {
    throw new Error('Negative Lab output receipt did not preserve source path provenance.');
  }
  if (receipt.acceptedDryRunPlanHash !== acceptedPlanIdentity.acceptedDryRunPlanHash) {
    throw new Error('Negative Lab output receipt did not preserve the accepted plan hash.');
  }
}

const modalSource = readFileSync('src/components/modals/negative-lab/NegativeConversionModal.tsx', 'utf8');
const rollHealthPanelSource = readFileSync('src/components/modals/negative-lab/NegativeLabRollHealthPanel.tsx', 'utf8');
const handoffSource = readFileSync('src/utils/negative-lab/negativeLabEditorHandoff.ts', 'utf8');

for (const [label, source, marker] of [
  ['modal fingerprints accepted apply plan', modalSource, 'buildNegativeLabAcceptedApplyPlanFingerprint'],
  ['modal rejects stale apply plan before save', modalSource, 'if (!isBatchPlanAccepted)'],
  ['modal computes accepted apply stale reasons', modalSource, 'getNegativeLabAcceptedApplyPlanStaleReasons'],
  ['modal surfaces accepted apply stale reasons', modalSource, 'batchPlanStaleReasons={batchPlanStaleReasons}'],
  ['modal passes accepted identity to ConvertNegatives', modalSource, '...acceptedBatchPlanIdentity,'],
  ['modal preserves saved positive handoffs', modalSource, 'savedPositiveHandoffs,'],
  ['roll health shows stale apply reasons', rollHealthPanelSource, 'negative-lab-batch-plan-stale-reasons'],
  ['roll health requires accepted plan before apply', rollHealthPanelSource, 'data-accepted-plan-required="true"'],
  ['roll health shows per-frame receipts', rollHealthPanelSource, 'negative-lab-batch-per-frame-receipts'],
  ['editor handoff refreshes before select', handoffSource, 'await refreshImageList();'],
  ['editor handoff requests thumbnails', handoffSource, 'requestThumbnails?.([firstSavedPath]);'],
] as const) {
  if (!source.includes(marker)) {
    throw new Error(`Negative Lab accepted output provenance marker missing: ${label}`);
  }
}

console.log('negative lab accepted output provenance ok');
