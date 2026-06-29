#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import { z } from 'zod';

import { NegativeLabAppServerCommandName } from '../../../src/utils/negativeLabAppServerCommandNames.ts';
import { NEGATIVE_LAB_DENSITY_ALGORITHM_ID } from '../../../src/utils/negativeLabDensityConversion.ts';
import {
  NegativeLabOutputFormatId,
  NEGATIVE_LAB_OUTPUT_FORMAT_IDS,
} from '../../../src/utils/negativeLabOutputFormatIds.ts';
import {
  buildNegativeLabRuntimeSelectedProfileSnapshot,
  resolveNegativeLabRuntimeProfile,
} from '../../../src/utils/negativeLabMeasuredProfileRuntime.ts';
import {
  buildNegativeLabBatchSummaryRouteResult,
  buildNegativeLabAcceptedBatchApplyRouteResult,
  buildNegativeLabAcceptedBatchPlanRouteResult,
  buildNegativeLabConversionPlanResult,
  buildNegativeLabDensitometerRouteResult,
  buildNegativeLabFrameHealthRouteResult,
  buildNegativeLabPlanRollNormalizationRouteResult,
  buildNegativeLabQcProofRouteResult,
  buildNegativeLabStockMetadataRouteResult,
  buildNegativeLabStockFamilyConversionRouteResult,
  buildNegativeLabStockRegistryRouteResult,
  NEGATIVE_LAB_APP_SERVER_ROUTE_MANIFEST,
} from '../../../src/utils/negativeLabAppServerRoutes.ts';
import { NEGATIVE_LAB_BUILT_IN_UI_PRESET_CATALOG } from '../../../src/utils/negativeLabPresetCatalog.ts';
import {
  buildNegativeLabScanMetricsV1,
  type NegativeLabScanMetricPixel,
} from '../../../src/utils/negativeLabScanMetrics.ts';

const expectedAcceptBatchPlanCommandName = NegativeLabAppServerCommandName.AcceptBatchPlan;
const expectedAcceptedBatchApplyCommandName = NegativeLabAppServerCommandName.AcceptedBatchApply;
const expectedBatchSummaryCommandName = NegativeLabAppServerCommandName.BatchSummary;
const expectedCommandName = NegativeLabAppServerCommandName.ConversionPlan;
const expectedDensitometerCommandName = NegativeLabAppServerCommandName.Densitometer;
const expectedFrameHealthCommandName = NegativeLabAppServerCommandName.FrameHealth;
const expectedPlanRollNormalizationCommandName = NegativeLabAppServerCommandName.PlanRollNormalization;
const expectedQcProofCommandName = NegativeLabAppServerCommandName.QcProof;
const expectedStockMetadataCommandName = NegativeLabAppServerCommandName.StockMetadata;
const expectedStockFamilyConversionCommandName = NegativeLabAppServerCommandName.StockFamilyConversion;
const expectedStockRegistryCommandName = NegativeLabAppServerCommandName.StockRegistry;
const runtimeCheckScripts = ['check:negative-lab-agent-workflow', 'check:negative-lab-measured-render-proof'];
const failures = [];
const selectedProfileSnapshot = buildNegativeLabRuntimeSelectedProfileSnapshot(
  resolveNegativeLabRuntimeProfile('negative_lab.generic.c41.neutral.v1'),
);
const userProfileSnapshot = buildNegativeLabRuntimeSelectedProfileSnapshot(
  resolveNegativeLabRuntimeProfile('negative_lab.user.c41.local_warm_proof.v1'),
);
const acceptBatchPlanRoute = NEGATIVE_LAB_APP_SERVER_ROUTE_MANIFEST.routes.find(
  (candidate) => candidate.commandName === expectedAcceptBatchPlanCommandName,
);
const acceptedBatchApplyRoute = NEGATIVE_LAB_APP_SERVER_ROUTE_MANIFEST.routes.find(
  (candidate) => candidate.commandName === expectedAcceptedBatchApplyCommandName,
);
const batchSummaryRoute = NEGATIVE_LAB_APP_SERVER_ROUTE_MANIFEST.routes.find(
  (candidate) => candidate.commandName === expectedBatchSummaryCommandName,
);
const route = NEGATIVE_LAB_APP_SERVER_ROUTE_MANIFEST.routes.find(
  (candidate) => candidate.commandName === expectedCommandName,
);
const densitometerRoute = NEGATIVE_LAB_APP_SERVER_ROUTE_MANIFEST.routes.find(
  (candidate) => candidate.commandName === expectedDensitometerCommandName,
);
const frameHealthRoute = NEGATIVE_LAB_APP_SERVER_ROUTE_MANIFEST.routes.find(
  (candidate) => candidate.commandName === expectedFrameHealthCommandName,
);
const planRollNormalizationRoute = NEGATIVE_LAB_APP_SERVER_ROUTE_MANIFEST.routes.find(
  (candidate) => candidate.commandName === expectedPlanRollNormalizationCommandName,
);
const qcProofRoute = NEGATIVE_LAB_APP_SERVER_ROUTE_MANIFEST.routes.find(
  (candidate) => candidate.commandName === expectedQcProofCommandName,
);
const stockRegistryRoute = NEGATIVE_LAB_APP_SERVER_ROUTE_MANIFEST.routes.find(
  (candidate) => candidate.commandName === expectedStockRegistryCommandName,
);
const stockMetadataRoute = NEGATIVE_LAB_APP_SERVER_ROUTE_MANIFEST.routes.find(
  (candidate) => candidate.commandName === expectedStockMetadataCommandName,
);
const stockFamilyConversionRoute = NEGATIVE_LAB_APP_SERVER_ROUTE_MANIFEST.routes.find(
  (candidate) => candidate.commandName === expectedStockFamilyConversionCommandName,
);

if (acceptBatchPlanRoute === undefined) {
  throw new Error(`Missing Negative Lab app-server route for ${expectedAcceptBatchPlanCommandName}.`);
}
if (acceptedBatchApplyRoute === undefined) {
  throw new Error(`Missing Negative Lab app-server route for ${expectedAcceptedBatchApplyCommandName}.`);
}
if (batchSummaryRoute === undefined) {
  throw new Error(`Missing Negative Lab app-server route for ${expectedBatchSummaryCommandName}.`);
}
if (route === undefined) {
  throw new Error(`Missing Negative Lab app-server route for ${expectedCommandName}.`);
}
if (densitometerRoute === undefined) {
  throw new Error(`Missing Negative Lab app-server route for ${expectedDensitometerCommandName}.`);
}
if (frameHealthRoute === undefined) {
  throw new Error(`Missing Negative Lab app-server route for ${expectedFrameHealthCommandName}.`);
}
if (planRollNormalizationRoute === undefined) {
  throw new Error(`Missing Negative Lab app-server route for ${expectedPlanRollNormalizationCommandName}.`);
}
if (qcProofRoute === undefined) {
  throw new Error(`Missing Negative Lab app-server route for ${expectedQcProofCommandName}.`);
}
if (stockRegistryRoute === undefined) {
  throw new Error(`Missing Negative Lab app-server route for ${expectedStockRegistryCommandName}.`);
}
if (stockMetadataRoute === undefined) {
  throw new Error(`Missing Negative Lab app-server route for ${expectedStockMetadataCommandName}.`);
}
if (stockFamilyConversionRoute === undefined) {
  throw new Error(`Missing Negative Lab app-server route for ${expectedStockFamilyConversionCommandName}.`);
}

const sampleRect = { height: 0.6, width: 0.12, x: 0.02, y: 0.2 };
const buildDensityPixels = (p50: number, range: number): NegativeLabScanMetricPixel[] =>
  Array.from({ length: 20 * 20 }, (_, index): NegativeLabScanMetricPixel => {
    const x = index % 20;
    const y = Math.floor(index / 20);
    const density = Math.max(0.04, p50 + ((x + y) / 38 - 0.5) * range);
    return { b: Math.pow(10, -density), g: Math.pow(10, -density), r: Math.pow(10, -density) };
  });
const densitometerReadoutSchema = z.object({
  densityRange: z.number().min(0),
  dominantChannel: z.enum(['red', 'green', 'blue']),
  status: z.enum(['balanced', 'minor_cast', 'strong_cast']),
});
const conversionPlanResultSchema = z.object({
  commandName: z.literal(expectedCommandName),
  outputFormat: z.enum(NEGATIVE_LAB_OUTPUT_FORMAT_IDS),
  params: z.object({
    base_fog_sample: z.union([
      z.null(),
      z.object({ height: z.number(), width: z.number(), x: z.number(), y: z.number() }),
    ]),
    base_fog_strength: z.number(),
    blue_weight: z.number(),
    contrast: z.number(),
    exposure: z.number(),
    green_weight: z.number(),
    red_weight: z.number(),
  }),
  paths: z.array(z.string()).min(1),
  presetId: z.string(),
  profile: z.object({
    crosstalkProfile: z
      .object({
        profileId: z.string(),
        provenanceHash: z.string().regex(/^fnv1a32:[a-f0-9]{8}$/u),
        strength: z.number().min(0).max(1),
      })
      .nullable(),
    filmClass: z.enum(['color_negative', 'black_and_white_silver']),
    measurementProfileId: z.string().nullable(),
    presetId: z.string(),
    profileStatus: z.enum(['generic_unmeasured', 'fixture_measured', 'user_supplied']),
    runtimeStatus: z.enum(['ui_catalog_only', 'runtime_parameter_applied']),
  }),
  profileProvenanceHash: z.string().regex(/^fnv1a32:[a-f0-9]{8}$/u),
  proof: z.object({
    densityAlgorithm: z.literal(NEGATIVE_LAB_DENSITY_ALGORITHM_ID),
    deterministic: z.literal(true),
    generatedFrom: z.literal('src/utils/negativeLabMeasuredProfileRuntime.ts'),
    runtimeConversionHelper: z.literal('src/utils/negativeLabDensityConversion.ts'),
  }),
  sampleRect: z.union([z.null(), z.object({ height: z.number(), width: z.number(), x: z.number(), y: z.number() })]),
  scope: z.enum(['active', 'all']),
  suffix: z.string(),
});
const assertParamsMatch = (actualParams, expectedParams, label) => {
  for (const key of [
    'base_fog_sample',
    'base_fog_strength',
    'blue_weight',
    'contrast',
    'exposure',
    'green_weight',
    'red_weight',
  ]) {
    if (JSON.stringify(actualParams[key]) !== JSON.stringify(expectedParams[key])) {
      throw new Error(`${label} ${key} does not match UI preset catalog.`);
    }
  }
};

const frameHealthResult = buildNegativeLabFrameHealthRouteResult({
  activePathIndex: 1,
  baseFogConfidence: 0.82,
  includedPaths: ['/roll/001.CR3', '/roll/002.CR3'],
  previewReady: false,
  targetPaths: ['/roll/001.CR3', '/roll/002.CR3', '/roll/003.CR3'],
});
const qcProofResult = buildNegativeLabQcProofRouteResult({
  activePathIndex: 1,
  baseFogConfidence: 0.82,
  includedPaths: ['/roll/001.CR3', '/roll/002.CR3'],
  previewReady: true,
  targetPaths: ['/roll/001.CR3', '/roll/002.CR3', '/roll/003.CR3'],
});
const batchSummaryResult = buildNegativeLabBatchSummaryRouteResult({
  activePathIndex: 1,
  baseFogConfidence: 0.82,
  includedPaths: ['/roll/001.CR3', '/roll/002.CR3'],
  previewReady: false,
  targetPaths: ['/roll/001.CR3', '/roll/002.CR3', '/roll/003.CR3'],
});
const rollNormalizationRouteResult = buildNegativeLabPlanRollNormalizationRouteResult({
  activePathIndex: 1,
  anchorFrameIds: ['negative-lab-frame-1'],
  baseFogConfidence: 0.82,
  frameScanMetrics: [
    {
      frameId: 'negative-lab-frame-1',
      metrics: buildNegativeLabScanMetricsV1({
        imageHeight: 20,
        imageWidth: 20,
        pixels: buildDensityPixels(0.72, 0.28),
      }),
      sourcePath: '/roll/001.CR3',
    },
    {
      frameId: 'negative-lab-frame-2',
      metrics: buildNegativeLabScanMetricsV1({
        imageHeight: 20,
        imageWidth: 20,
        pixels: buildDensityPixels(0.31, 0.32),
      }),
      sourcePath: '/roll/002.CR3',
    },
  ],
  includedPaths: ['/roll/001.CR3', '/roll/002.CR3'],
  mode: 'density_and_balance',
  preserveCreativeAdjustments: true,
  previewReady: false,
  selectedFrameIds: ['negative-lab-frame-1', 'negative-lab-frame-2'],
  targetPaths: ['/roll/001.CR3', '/roll/002.CR3', '/roll/003.CR3'],
});
const acceptedBatchPlanResult = buildNegativeLabAcceptedBatchPlanRouteResult({
  activePathIndex: 1,
  baseFogConfidence: 0.82,
  includedPaths: ['/roll/001.CR3', '/roll/002.CR3'],
  previewReady: false,
  presetId: 'negative_lab.generic.c41.neutral.v1',
  targetPaths: ['/roll/001.CR3', '/roll/002.CR3', '/roll/003.CR3'],
});
const acceptedBatchApplyResult = buildNegativeLabAcceptedBatchApplyRouteResult({
  acceptedPlan: acceptedBatchPlanResult,
  conversion: {
    outputFormat: NegativeLabOutputFormatId.JpegProof,
    paths: ['/roll/001.CR3', '/roll/002.CR3', '/roll/003.CR3'],
    presetId: 'negative_lab.generic.c41.neutral.v1',
    sampleRect,
    scope: 'all',
    suffix: 'Positive',
  },
  dryRun: {
    activePathIndex: 1,
    baseFogConfidence: 0.82,
    includedPaths: ['/roll/001.CR3', '/roll/002.CR3'],
    previewReady: false,
    presetId: 'negative_lab.generic.c41.neutral.v1',
    targetPaths: ['/roll/001.CR3', '/roll/002.CR3', '/roll/003.CR3'],
  },
  selectedProfileSnapshot,
});
const acceptedUserProfilePlanResult = buildNegativeLabAcceptedBatchPlanRouteResult({
  activePathIndex: 1,
  baseFogConfidence: 0.82,
  includedPaths: ['/roll/001.CR3', '/roll/002.CR3'],
  previewReady: false,
  presetId: 'negative_lab.user.c41.local_warm_proof.v1',
  targetPaths: ['/roll/001.CR3', '/roll/002.CR3', '/roll/003.CR3'],
});
const acceptedUserProfileApplyResult = buildNegativeLabAcceptedBatchApplyRouteResult({
  acceptedPlan: acceptedUserProfilePlanResult,
  conversion: {
    outputFormat: NegativeLabOutputFormatId.JpegProof,
    paths: ['/roll/001.CR3', '/roll/002.CR3', '/roll/003.CR3'],
    presetId: 'negative_lab.user.c41.local_warm_proof.v1',
    sampleRect,
    scope: 'all',
    suffix: 'Positive',
  },
  dryRun: {
    activePathIndex: 1,
    baseFogConfidence: 0.82,
    includedPaths: ['/roll/001.CR3', '/roll/002.CR3'],
    previewReady: false,
    presetId: 'negative_lab.user.c41.local_warm_proof.v1',
    targetPaths: ['/roll/001.CR3', '/roll/002.CR3', '/roll/003.CR3'],
  },
  selectedProfileSnapshot: userProfileSnapshot,
});
const densitometerResult = densitometerReadoutSchema.parse(
  buildNegativeLabDensitometerRouteResult({
    baseFogEstimate: {
      baseDensity: [0.146, 0.221, 0.357],
      baseRgb: [0.714, 0.601, 0.44],
      blueWeight: 0.82,
      confidence: 0.91,
      greenWeight: 0.95,
      redWeight: 1.18,
    },
  }),
);
const stockRegistryResult = buildNegativeLabStockRegistryRouteResult({});
const stockMetadataResult = buildNegativeLabStockMetadataRouteResult({});
const stockFamilyConversionResult = buildNegativeLabStockFamilyConversionRouteResult({
  outputFormat: NegativeLabOutputFormatId.JpegProof,
  paths: ['/fixtures/negative-lab/synthetic-color-negative-001.tif'],
  sampleRect,
  scope: 'active',
  stockFamilyRegistryId: 'negative_lab.stock_family.c41_portrait_color_negative.v1',
  suffix: 'Positive',
});

if (frameHealthResult.activeFrameId !== 'negative-lab-frame-2') {
  throw new Error('Negative Lab app-server frame health route did not report the active frame.');
}
if (frameHealthResult.includedCount !== 2 || frameHealthResult.queuedCount !== 2) {
  throw new Error('Negative Lab app-server frame health route did not report roll counts.');
}
if (!frameHealthResult.warningCodes.includes('excluded_from_batch')) {
  throw new Error('Negative Lab app-server frame health route did not roll up skipped-frame warnings.');
}
if (
  qcProofResult.totalFrameCount !== 3 ||
  qcProofResult.includedFrameCount !== 2 ||
  qcProofResult.contactSheetColumnCount !== 3 ||
  qcProofResult.frames[2]?.exportBlockedReason !== 'Frame excluded from batch.' ||
  qcProofResult.exportReady
) {
  throw new Error('Negative Lab app-server QC proof route did not expose contact-sheet proof state.');
}
if (batchSummaryResult.plannedApplyCount !== 2 || batchSummaryResult.skippedFrameIds[0] !== 'negative-lab-frame-3') {
  throw new Error('Negative Lab app-server batch summary route did not report apply/skip counts.');
}
if (!batchSummaryResult.rollWarningCodes.includes('excluded_from_batch')) {
  throw new Error('Negative Lab app-server batch summary route did not roll up warnings.');
}
if (
  rollNormalizationRouteResult.autoDensitySuggestionRun?.frameSuggestions.length !== 2 ||
  rollNormalizationRouteResult.autoDensitySuggestionRun.state !== 'suggested_only' ||
  rollNormalizationRouteResult.exposureOverrides.overrides.length !== 2 ||
  rollNormalizationRouteResult.exposureOverrides.overrides.some((override) => override.exposureOffset === 0)
) {
  throw new Error(
    'Negative Lab app-server roll normalization route did not expose auditable auto density suggestions.',
  );
}
if (
  acceptedBatchPlanResult.commandName !== expectedAcceptBatchPlanCommandName ||
  !acceptedBatchPlanResult.acceptedDryRunPlanId.startsWith('negative_lab_batch_plan_') ||
  !acceptedBatchPlanResult.acceptedDryRunPlanHash.startsWith('fnv1a32:') ||
  acceptedBatchPlanResult.dryRunSummary.plannedApplyCount !== 2
) {
  throw new Error('Negative Lab app-server accepted batch plan route did not preserve dry-run plan identity.');
}
if (
  acceptedBatchApplyResult.commandName !== expectedAcceptedBatchApplyCommandName ||
  acceptedBatchApplyResult.acceptedDryRunPlanHash !== acceptedBatchPlanResult.acceptedDryRunPlanHash ||
  acceptedBatchApplyResult.apply.options.acceptedDryRunPlanId !== acceptedBatchPlanResult.acceptedDryRunPlanId ||
  acceptedBatchApplyResult.apply.options.profileProvenanceHash !==
    acceptedBatchApplyResult.conversionPlan.profileProvenanceHash ||
  acceptedBatchApplyResult.proof.selectedProfileBound !== true ||
  acceptedBatchApplyResult.selectedProfileSnapshot.profileProvenanceHash !==
    selectedProfileSnapshot.profileProvenanceHash ||
  acceptedBatchApplyResult.selectedProfileSnapshot.presetId !== 'negative_lab.generic.c41.neutral.v1' ||
  acceptedBatchApplyResult.apply.options.selectedProfile.profileProvenanceHash !==
    selectedProfileSnapshot.profileProvenanceHash ||
  acceptedBatchApplyResult.apply.paths.join('|') !== '/roll/001.CR3|/roll/002.CR3' ||
  acceptedBatchApplyResult.dryRunSummary.skippedFrameIds[0] !== 'negative-lab-frame-3'
) {
  throw new Error('Negative Lab app-server accepted apply route did not replay profile-bound dry-run evidence.');
}
if (
  acceptedUserProfileApplyResult.selectedProfileSnapshot.presetId !== 'negative_lab.user.c41.local_warm_proof.v1' ||
  acceptedUserProfileApplyResult.selectedProfileSnapshot.profileStatus !== 'user_supplied' ||
  acceptedUserProfileApplyResult.selectedProfileSnapshot.claimPolicy !== 'user_profile_no_stock_claim' ||
  acceptedUserProfileApplyResult.selectedProfileSnapshot.crosstalkProfile?.provenance !== 'user_owned' ||
  acceptedUserProfileApplyResult.selectedProfileSnapshot.crosstalkProfile.provenanceHash !==
    userProfileSnapshot.crosstalkProfile?.provenanceHash ||
  acceptedUserProfileApplyResult.conversionPlan.profile.crosstalkProfile?.provenanceHash !==
    userProfileSnapshot.crosstalkProfile?.provenanceHash ||
  acceptedUserProfileApplyResult.apply.options.selectedProfile.profileProvenanceHash !==
    userProfileSnapshot.profileProvenanceHash ||
  !acceptedUserProfileApplyResult.selectedProfileSnapshot.doesNotProve.includes('user_profile_unmeasured') ||
  !acceptedUserProfileApplyResult.selectedProfileSnapshot.doesNotProve.includes('no_stock_emulation_claim')
) {
  throw new Error('Negative Lab app-server accepted apply route did not preserve user-owned profile evidence.');
}
if (
  densitometerResult.dominantChannel !== 'blue' ||
  densitometerResult.status !== 'strong_cast' ||
  Math.abs(densitometerResult.densityRange - 0.211) > 0.000001
) {
  throw new Error('Negative Lab app-server densitometer route did not match UI density math.');
}
if (
  stockRegistryResult.counts.totalCount !== stockRegistryResult.registry.entries.length ||
  stockRegistryResult.counts.runtimeSafeCount < 5 ||
  stockRegistryResult.counts.referenceOnlyCount < 2 ||
  !stockRegistryResult.proof.namedStockClaimsRuntimeGated
) {
  throw new Error('Negative Lab app-server stock registry route did not expose governed registry proof.');
}
if (
  stockMetadataResult.commandName !== expectedStockMetadataCommandName ||
  stockMetadataResult.counts.totalCount !== stockMetadataResult.catalog.entries.length ||
  stockMetadataResult.counts.colorNegativeCount < 6 ||
  stockMetadataResult.counts.blackAndWhiteNegativeCount < 4 ||
  stockMetadataResult.counts.cinemaNegativeCount < 3 ||
  stockMetadataResult.counts.slideReversalCount < 3 ||
  !stockMetadataResult.proof.metadataOnlyNotRuntimeApplied ||
  !stockMetadataResult.proof.namedStockClaimsRuntimeGated
) {
  throw new Error('Negative Lab app-server stock metadata route did not expose metadata-only stock proof.');
}
if (
  stockFamilyConversionResult.commandName !== expectedStockFamilyConversionCommandName ||
  stockFamilyConversionResult.stockFamily.genericPresetId !== 'negative_lab.generic.c41.portrait.v1' ||
  stockFamilyConversionResult.conversionPlan.presetId !== 'negative_lab.generic.c41.portrait.v1' ||
  stockFamilyConversionResult.conversionPlan.params.base_fog_sample?.x !== sampleRect.x ||
  !stockFamilyConversionResult.proof.registryMappedPreset
) {
  throw new Error('Negative Lab app-server stock-family conversion route did not map registry id to preset plan.');
}

try {
  buildNegativeLabAcceptedBatchPlanRouteResult({
    activePathIndex: 0,
    baseFogConfidence: null,
    includedPaths: ['/roll/not-in-target.CR3'],
    previewReady: true,
    presetId: 'negative_lab.generic.c41.neutral.v1',
    targetPaths: ['/roll/blocked.CR3'],
  });
  throw new Error('Blocked Negative Lab accepted batch plan route was accepted.');
} catch (error) {
  if (error instanceof Error && error.message === 'Blocked Negative Lab accepted batch plan route was accepted.') {
    throw error;
  }
}

try {
  buildNegativeLabAcceptedBatchApplyRouteResult({
    acceptedPlan: {
      ...acceptedBatchPlanResult,
      acceptedDryRunPlanId: 'negative_lab_batch_plan_deadbeef',
    },
    conversion: {
      outputFormat: NegativeLabOutputFormatId.JpegProof,
      paths: ['/roll/001.CR3', '/roll/002.CR3', '/roll/003.CR3'],
      presetId: 'negative_lab.generic.c41.neutral.v1',
      sampleRect,
      scope: 'all',
      suffix: 'Positive',
    },
    dryRun: {
      activePathIndex: 1,
      baseFogConfidence: 0.82,
      includedPaths: ['/roll/001.CR3', '/roll/002.CR3'],
      previewReady: false,
      presetId: 'negative_lab.generic.c41.neutral.v1',
      targetPaths: ['/roll/001.CR3', '/roll/002.CR3', '/roll/003.CR3'],
    },
    selectedProfileSnapshot,
  });
  throw new Error('Mismatched Negative Lab accepted apply plan was accepted.');
} catch (error) {
  if (error instanceof Error && error.message === 'Mismatched Negative Lab accepted apply plan was accepted.') {
    throw error;
  }
}

try {
  buildNegativeLabAcceptedBatchApplyRouteResult({
    acceptedPlan: {
      ...acceptedBatchPlanResult,
      selectedProfileSnapshot: {
        ...acceptedBatchPlanResult.selectedProfileSnapshot,
        displayName: 'Tampered profile name',
      },
    },
    conversion: {
      outputFormat: NegativeLabOutputFormatId.JpegProof,
      paths: ['/roll/001.CR3', '/roll/002.CR3', '/roll/003.CR3'],
      presetId: 'negative_lab.generic.c41.neutral.v1',
      sampleRect,
      scope: 'all',
      suffix: 'Positive',
    },
    dryRun: {
      activePathIndex: 1,
      baseFogConfidence: 0.82,
      includedPaths: ['/roll/001.CR3', '/roll/002.CR3'],
      previewReady: false,
      presetId: 'negative_lab.generic.c41.neutral.v1',
      targetPaths: ['/roll/001.CR3', '/roll/002.CR3', '/roll/003.CR3'],
    },
    selectedProfileSnapshot,
  });
  throw new Error('Tampered Negative Lab selected profile snapshot was accepted.');
} catch (error) {
  if (error instanceof Error && error.message === 'Tampered Negative Lab selected profile snapshot was accepted.') {
    throw error;
  }
}

try {
  buildNegativeLabAcceptedBatchApplyRouteResult({
    acceptedPlan: acceptedBatchPlanResult,
    conversion: {
      outputFormat: NegativeLabOutputFormatId.JpegProof,
      paths: ['/roll/001.CR3', '/roll/002.CR3', '/roll/003.CR3'],
      presetId: 'negative_lab.generic.c41.portrait.v1',
      sampleRect,
      scope: 'all',
      suffix: 'Positive',
    },
    dryRun: {
      activePathIndex: 1,
      baseFogConfidence: 0.82,
      includedPaths: ['/roll/001.CR3', '/roll/002.CR3'],
      previewReady: false,
      presetId: 'negative_lab.generic.c41.neutral.v1',
      targetPaths: ['/roll/001.CR3', '/roll/002.CR3', '/roll/003.CR3'],
    },
    selectedProfileSnapshot,
  });
  throw new Error('Mismatched Negative Lab selected profile snapshot was accepted.');
} catch (error) {
  if (error instanceof Error && error.message === 'Mismatched Negative Lab selected profile snapshot was accepted.') {
    throw error;
  }
}

for (const preset of NEGATIVE_LAB_BUILT_IN_UI_PRESET_CATALOG.presets) {
  const activeResult = conversionPlanResultSchema.parse(
    buildNegativeLabConversionPlanResult({
      outputFormat: NegativeLabOutputFormatId.JpegProof,
      paths: ['/fixtures/negative-lab/synthetic-color-negative-001.tif'],
      presetId: preset.presetId,
      sampleRect,
      scope: 'active',
      suffix: 'Positive',
    }),
  );
  const batchResult = conversionPlanResultSchema.parse(
    buildNegativeLabConversionPlanResult({
      outputFormat: NegativeLabOutputFormatId.Tiff16,
      paths: [
        '/fixtures/negative-lab/synthetic-color-negative-001.tif',
        '/fixtures/negative-lab/synthetic-gray-ramp-negative-002.tif',
      ],
      presetId: preset.presetId,
      sampleRect: null,
      scope: 'all',
      suffix: 'Positive',
    }),
  );

  assertParamsMatch(activeResult.params, { ...preset.params, base_fog_sample: sampleRect }, preset.displayName);
  assertParamsMatch(batchResult.params, preset.params, preset.displayName);
}

try {
  buildNegativeLabConversionPlanResult({
    outputFormat: NegativeLabOutputFormatId.Tiff16,
    paths: ['/fixtures/negative-lab/synthetic-color-negative-001.tif'],
    presetId: 'negative_lab.generic.c41.missing.v1',
    sampleRect: null,
    scope: 'active',
    suffix: 'Positive',
  });
  throw new Error('Unknown Negative Lab preset id was accepted.');
} catch (error) {
  if (error instanceof Error && error.message === 'Unknown Negative Lab preset id was accepted.') {
    throw error;
  }
}

try {
  buildNegativeLabStockFamilyConversionRouteResult({
    outputFormat: NegativeLabOutputFormatId.JpegProof,
    paths: ['/fixtures/negative-lab/synthetic-color-negative-001.tif'],
    sampleRect,
    scope: 'active',
    stockFamilyRegistryId: 'negative_lab.stock_family.ecn2_cinema_negative.v1',
    suffix: 'Positive',
  });
  throw new Error('Reference-only Negative Lab stock family was accepted for conversion.');
} catch (error) {
  if (
    error instanceof Error &&
    error.message === 'Reference-only Negative Lab stock family was accepted for conversion.'
  ) {
    throw error;
  }
}

for (const [filePath, marker] of [
  ['src/schemas/negativeLabAppServerSchemas.ts', 'negativeLabBatchSummaryAppServerCommandSchema'],
  ['src/schemas/negativeLabAppServerSchemas.ts', 'negativeLabAcceptBatchPlanAppServerCommandSchema'],
  ['src/schemas/negativeLabAppServerSchemas.ts', 'negativeLabAcceptedBatchApplyAppServerCommandSchema'],
  ['src/schemas/negativeLabAppServerSchemas.ts', 'negativeLabDensitometerAppServerCommandSchema'],
  ['src/schemas/negativeLabAppServerSchemas.ts', 'negativeLabFrameHealthAppServerCommandSchema'],
  ['src/schemas/negativeLabAppServerSchemas.ts', 'negativeLabQcProofAppServerCommandSchema'],
  ['src/schemas/negativeLabAppServerSchemas.ts', 'negativeLabStockFamilyConversionAppServerCommandSchema'],
  ['src/schemas/negativeLabAppServerSchemas.ts', 'negativeLabStockRegistryAppServerCommandSchema'],
  ['src/schemas/negativeLabAppServerSchemas.ts', 'negativeLabStockMetadataAppServerCommandSchema'],
  ['src/utils/negativeLabAppServerRoutes.ts', 'buildNegativeLabAcceptedBatchPlanRouteResult'],
  ['src/utils/negativeLabAppServerRoutes.ts', 'buildNegativeLabAcceptedBatchApplyRouteResult'],
  ['src/utils/negativeLabPlanIdentity.ts', 'buildNegativeLabAcceptedPlanIdentity'],
  ['src/utils/negativeLabAppServerRoutes.ts', 'buildNegativeLabBatchSummaryRouteResult'],
  ['src/utils/negativeLabAppServerRoutes.ts', 'buildNegativeLabDensitometerRouteResult'],
  ['src/utils/negativeLabDensitometer.ts', 'buildNegativeBaseFogDensitometerReadout'],
  ['src/schemas/negativeLabAppServerSchemas.ts', 'negativeLabConversionPlanResultSchema'],
  ['src/utils/negativeLabAppServerRoutes.ts', 'buildNegativeLabFrameHealthRouteResult'],
  ['src/utils/negativeLabAppServerRoutes.ts', 'buildNegativeLabQcProofRouteResult'],
  ['src/utils/negativeLabAppServerRoutes.ts', 'buildNegativeLabStockFamilyConversionRouteResult'],
  ['src/utils/negativeLabAppServerRoutes.ts', 'buildNegativeLabStockRegistryRouteResult'],
  ['src/utils/negativeLabAppServerRoutes.ts', 'buildNegativeLabStockMetadataRouteResult'],
  ['src/utils/negativeLabAppServerRoutes.ts', 'buildNegativeLabConversionPlanResult'],
  ['src/utils/negativeLabCrosstalkProfile.ts', 'applyNegativeLabDensityCrosstalk'],
  ['src/schemas/negativeLabCrosstalkProfileSchemas.ts', 'negativeLabCrosstalkProfileSchema'],
  ['src/utils/negativeLabDensityConversion.ts', 'convertNegativeLabDensitySample'],
  ['src/utils/negativeLabMeasuredProfileRuntime.ts', 'resolveNegativeLabRuntimeProfile'],
  ['src/utils/negativeLabPresetCatalog.ts', 'NEGATIVE_LAB_BUILT_IN_UI_PRESET_CATALOG'],
  ['src/utils/negativeLabStockRegistry.ts', 'NEGATIVE_LAB_STOCK_REGISTRY'],
  ['src/utils/negativeLabStockMetadataCatalog.ts', 'NEGATIVE_LAB_STOCK_METADATA_CATALOG'],
]) {
  const source = await readFile(filePath, 'utf8');
  if (!source.includes(marker)) {
    throw new Error(`${filePath} is missing Negative Lab app-server marker ${marker}.`);
  }
}

for (const filePath of [
  'src/utils/negativeLabCrosstalkProfile.ts',
  'src/utils/negativeLabMeasuredProfileRuntime.ts',
  'tests/pure-ts/negative-lab-crosstalk-profile.test.ts',
]) {
  const source = await readFile(filePath, 'utf8');
  const disallowedMarkers = [
    ['Neg', 'Py'].join(''),
    ['negative', 'lab', 'pro'].join(' '),
    ['.', 'toml'].join(''),
    ['TO', 'ML'].join(''),
  ];
  if (
    disallowedMarkers.some((marker) => source.toLocaleLowerCase('en-US').includes(marker.toLocaleLowerCase('en-US')))
  ) {
    throw new Error(`${filePath} contains disallowed external crosstalk profile markers.`);
  }
}

for (const runtimeCheckScript of runtimeCheckScripts) {
  runPackageScript(runtimeCheckScript);
}

if (failures.length > 0) {
  console.error('Negative Lab app-server route validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `negative lab app-server routes ok (${NEGATIVE_LAB_BUILT_IN_UI_PRESET_CATALOG.presets.length} presets, ${NEGATIVE_LAB_APP_SERVER_ROUTE_MANIFEST.routes.length} routes)`,
);

function runPackageScript(scriptName: string): void {
  const result = Bun.spawnSync(['bun', 'run', scriptName], {
    stderr: 'pipe',
    stdout: 'pipe',
  });

  if (result.exitCode === 0) return;

  const output = [new TextDecoder().decode(result.stdout), new TextDecoder().decode(result.stderr)]
    .join('\n')
    .split('\n')
    .filter(Boolean)
    .slice(-20)
    .join('\n');
  failures.push(`${scriptName} failed:\n${output}`);
}
