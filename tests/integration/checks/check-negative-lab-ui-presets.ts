#!/usr/bin/env bun
// @ts-check

import { NEGATIVE_LAB_BUILT_IN_UI_PRESET_CATALOG } from '../../../src/utils/negativeLabPresetCatalog.ts';
import { NEGATIVE_LAB_OUTPUT_FORMAT_IDS } from '../../../src/utils/negativeLabOutputFormatIds.ts';
import { negativeLabMeasuredProfileCatalogSchema } from '../../../src/schemas/negativeLabMeasuredProfileSchemas.ts';
import { parseNegativeLabBuiltInUiPresetCatalog } from '../../../src/schemas/negativeLabPresetCatalogSchemas.ts';
import { buildNegativeLabRuntimeProfileBrowserRows } from '../../../src/utils/negativeLabMeasuredProfileRuntime.ts';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { unsafeNegativeLabClaimPattern } from '../../../scripts/lib/negative-lab-validation.ts';

const failures = [];
const ids = new Set();
parseNegativeLabBuiltInUiPresetCatalog(NEGATIVE_LAB_BUILT_IN_UI_PRESET_CATALOG);
const runtimeProfileRows = buildNegativeLabRuntimeProfileBrowserRows();

for (const preset of NEGATIVE_LAB_BUILT_IN_UI_PRESET_CATALOG.presets) {
  ids.add(preset.presetId);

  const text = [
    preset.presetId,
    preset.displayName,
    preset.intent,
    preset.claimLevel,
    preset.claimPolicy,
    preset.colorResponseNotes,
    preset.contrastCurveDescriptor,
    preset.legalNote,
    preset.grainModelDescriptor,
    preset.measurementSource,
    preset.nominalSpeedClass,
    preset.profileStatus,
    preset.processFamily,
    preset.processHint,
    preset.provenanceSummary,
    preset.runtimeStatus,
    preset.stockFamilyDescriptor,
  ].join(' ');
  if (unsafeNegativeLabClaimPattern.test(text)) {
    failures.push(`${preset.presetId}: generic preset contains unsafe stock or brand claim`);
  }

  if (preset.claimPolicy !== 'generic_starting_point_no_stock_claim') {
    failures.push(`${preset.presetId}: UI catalog preset must be a generic no-stock-claim preset`);
  }

  if (preset.profileStatus !== 'generic_unmeasured' || preset.measurementProfileId !== null) {
    failures.push(`${preset.presetId}: UI catalog preset must remain unmeasured until fixture proof exists`);
  }

  if (
    preset.claimLevel !== 'generic_starting_point_only' ||
    preset.measurementSource !== 'generic_engineered_starting_point'
  ) {
    failures.push(`${preset.presetId}: UI catalog preset must declare generic claim/source metadata`);
  }

  if (preset.runtimeStatus !== 'runtime_parameter_applied') {
    failures.push(`${preset.presetId}: UI catalog preset must be applied through the existing runtime parameter path`);
  }

  if (!/\bnot measured\b/iu.test(preset.provenanceSummary)) {
    failures.push(`${preset.presetId}: provenance summary must disclose unmeasured generic status`);
  }

  const expectedProcessFamily =
    preset.filmClass === 'black_and_white_silver' ? 'black_and_white_silver_negative' : 'c41_color_negative';
  if (preset.processFamily !== expectedProcessFamily) {
    failures.push(`${preset.presetId}: process family does not match film class`);
  }

  if (preset.stockFamilyDescriptor.length < 8) {
    failures.push(`${preset.presetId}: stock family descriptor is too vague`);
  }

  for (const [key, value] of [
    ['colorResponseNotes', preset.colorResponseNotes],
    ['contrastCurveDescriptor', preset.contrastCurveDescriptor],
    ['grainModelDescriptor', preset.grainModelDescriptor],
    ['nominalSpeedClass', preset.nominalSpeedClass],
  ]) {
    if (typeof value !== 'string' || value.trim().length < 8) {
      failures.push(`${preset.presetId}: ${key} is missing useful generic metadata`);
    }
  }
}

if (!ids.has(NEGATIVE_LAB_BUILT_IN_UI_PRESET_CATALOG.defaultPresetId)) {
  failures.push('default preset id is missing from catalog');
}

if (NEGATIVE_LAB_BUILT_IN_UI_PRESET_CATALOG.presets.length < 12) {
  failures.push('Negative Lab UI preset catalog must include at least 12 generic family starters');
}

const genericRuntimeRows = runtimeProfileRows.filter((row) => row.profileStatus === 'generic_unmeasured');
const measuredRuntimeRows = runtimeProfileRows.filter((row) => row.profileStatus === 'fixture_measured');

if (genericRuntimeRows.length !== NEGATIVE_LAB_BUILT_IN_UI_PRESET_CATALOG.presets.length) {
  failures.push('Negative Lab profile browser rows must expose every public generic preset');
}

for (const row of genericRuntimeRows) {
  if (!row.isSelectable || row.disabledReason !== null) {
    failures.push(`${row.presetId}: public generic profile browser row must remain selectable`);
  }
}

for (const row of measuredRuntimeRows) {
  if (
    row.claimPolicy !== 'process_family_profile_no_stock_claim' ||
    !row.doesNotProve.includes('no_stock_emulation_claim') ||
    !row.doesNotProve.includes('no_colorimetric_match_claim') ||
    row.evidenceFixtureCount < 1
  ) {
    failures.push(`${row.presetId}: public measured profile row must stay evidence-backed and claim-limited`);
  }
}

const measuredProfileBase = {
  calibrationMethod: 'density_matrix_process_family_v1',
  claimLevel: 'measured_profile',
  displayName: 'Measured C-41 Process Family',
  evidenceDigest: {
    fixtureLegalStatus: 'project_owned_private_ci',
    renderProofStatus: 'metadata_only',
    sourceFixtureContentHashes: ['sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'],
  },
  evidenceFixtureIds: ['negative_lab.project_owned.c41_profile_measurement_001'],
  filmClass: 'color_negative',
  measurementProfileId: 'negative_lab.measured.c41.process_family.v1',
  measurementSource: 'fixture_measured_profile',
  params: {
    base_fog_sample: null,
    base_fog_strength: 1,
    blue_weight: 1.02,
    contrast: 1.04,
    exposure: 0,
    green_weight: 0.99,
    red_weight: 1.03,
  },
  processFamily: 'c41_color_negative',
  profileId: 'negative_lab.measured.c41.process_family.v1',
  profileStatus: 'fixture_measured',
  sourceGenericPresetId: 'negative_lab.generic.c41.neutral.v1',
};
const measuredBrowserRows = buildNegativeLabRuntimeProfileBrowserRows({
  genericCatalog: NEGATIVE_LAB_BUILT_IN_UI_PRESET_CATALOG,
  measuredCatalog: negativeLabMeasuredProfileCatalogSchema.parse({
    catalogId: 'negative_lab_measured_profile_catalog',
    catalogVersion: 'ui-self-test',
    profiles: [
      {
        ...measuredProfileBase,
        claimPolicy: 'process_family_profile_no_stock_claim',
        doesNotProve: ['no_stock_emulation_claim', 'no_colorimetric_match_claim'],
        evidenceDigest: {
          ...measuredProfileBase.evidenceDigest,
          renderProofStatus: 'runtime_route_verified',
        },
        runtimeLimitations: ['Runtime applies measured process-family parameters; no stock-emulation claim is made.'],
        runtimeStatus: 'runtime_parameter_applied',
      },
      {
        ...measuredProfileBase,
        displayName: 'Catalog C-41 Process Family',
        doesNotProve: [
          'schema_only',
          'no_runtime_profile_resolver',
          'no_stock_emulation_claim',
          'no_colorimetric_match_claim',
        ],
        claimPolicy: 'process_family_profile_no_stock_claim',
        measurementProfileId: 'negative_lab.measured.c41.catalog_only.v1',
        profileId: 'negative_lab.measured.c41.catalog_only.v1',
        runtimeLimitations: ['Catalog and evidence gate only; no measured profile runtime resolver is applied yet.'],
        runtimeStatus: 'ui_catalog_only',
      },
      {
        ...measuredProfileBase,
        displayName: 'Named Stock Review Profile',
        doesNotProve: [
          'schema_only',
          'no_runtime_profile_resolver',
          'no_stock_emulation_claim',
          'no_colorimetric_match_claim',
        ],
        claimPolicy: 'named_stock_profile_requires_license_review',
        measurementProfileId: 'negative_lab.measured.c41.named_review.v1',
        profileId: 'negative_lab.measured.c41.named_review.v1',
        runtimeLimitations: ['Named-stock language requires separate license review before runtime use.'],
        runtimeStatus: 'ui_catalog_only',
      },
    ],
    schemaVersion: 1,
  }),
});
const runtimeAppliedMeasuredRow = measuredBrowserRows.find(
  (row) => row.presetId === 'negative_lab.measured.c41.process_family.v1',
);
const catalogOnlyMeasuredRow = measuredBrowserRows.find(
  (row) => row.presetId === 'negative_lab.measured.c41.catalog_only.v1',
);
const licenseReviewMeasuredRow = measuredBrowserRows.find(
  (row) => row.presetId === 'negative_lab.measured.c41.named_review.v1',
);

if (
  runtimeAppliedMeasuredRow?.profileStatus !== 'fixture_measured' ||
  runtimeAppliedMeasuredRow.evidenceFixtureCount !== 1 ||
  !runtimeAppliedMeasuredRow.isSelectable
) {
  failures.push('Runtime-applied measured profile browser row must be selectable with fixture evidence.');
}

if (catalogOnlyMeasuredRow?.isSelectable !== false || catalogOnlyMeasuredRow.disabledReason !== 'catalog_only') {
  failures.push('Catalog-only measured profile browser row must be disabled with catalog-only reason.');
}

if (
  licenseReviewMeasuredRow?.isSelectable !== false ||
  licenseReviewMeasuredRow.disabledReason !== 'license_review_required'
) {
  failures.push('Named-stock review measured profile browser row must be disabled behind license review.');
}

const workflowStageKeys = [
  'workflowSetup',
  'workflowSetupDetailMultiple',
  'workflowSetupDetailSingle',
  'workflowPreset',
  'workflowCustomPresetDetail',
  'workflowColorTiming',
  'workflowColorDetail',
  'workflowPrintGrade',
  'workflowPrintDetail',
  'workflowExport',
  'workflowExportReadyJpeg',
  'workflowExportReadyTiff',
  'workflowExportConverting',
  'acceptBatchPlan',
  'agentActivity',
  'agentAffectedFrames',
  'autoBaseFog',
  'autoBaseFogTooltip',
  'basePending',
  'baseFogConfidence',
  'baseDensity',
  'baseRgb',
  'baseReady',
  'baseSampleArea',
  'baseSampleOrigin',
  'baseSampleSize',
  'baseFogStrength',
  'baseFogSample',
  'batchReadiness',
  'batchPlanAccepted',
  'convertAndSaveActive',
  'copyReadout',
  'sampleCenterPatch',
  'sampleFullFrame',
  'sampleLeftEdge',
  'sampleOverlayLabel',
  'exportOptions',
  'excludeScan',
  'frameHealth',
  'frameHealthActive',
  'frameHealthQueued',
  'frameHealthSkipped',
  'includeScan',
  'includedScans',
  'outputSuffix',
  'presetClaimGeneric',
  'presetClaimMeasured',
  'presetColorResponse',
  'presetContrastCurve',
  'presetGrainModel',
  'presetRuntimeApplied',
  'presetRuntimeCatalogOnly',
  'presetSpeedClass',
  'profileEvidenceCount',
  'profileMeasuredBadge',
  'profileMeasuredClaimPolicy',
  'profileSort',
  'profileSortCatalog',
  'profileSortEvidence',
  'profileSortName',
  'profileSortRuntime',
  'profileFilterAll',
  'profileFilterBlackAndWhite',
  'profileFilterColorNegative',
  'profileFilterMeasured',
  'profileSearch',
  'profileSearchEmpty',
  'previewPending',
  'previewReady',
  'queuedScans',
  'readoutCopied',
  'scopeActive',
  'scopeAll',
  'stockRegistry',
  'stockRegistrySummary',
  'stockRegistryVersion',
  'workflowExportReadyCount',
];
const stockMetadataLocaleKeys = [
  'stockMetadata',
  'stockMetadataNoRuntimePreset',
  'stockMetadataOnly',
  'stockMetadataPolicy',
  'stockMetadataPolicyDetail',
  'stockMetadataSummary',
  'stockMetadataUseSuggestedPreset',
];
const modalSource = readFileSync('src/components/modals/NegativeConversionModal.tsx', 'utf8');
const backendSource = readFileSync('src-tauri/src/negative_conversion.rs', 'utf8');

for (const marker of [
  'NegativeLabWorkflowStage',
  'buildNegativeLabFrameHealthReport',
  'workflowStages',
  'renderWorkflowRail',
  'handleAutoBaseFog',
  'base_fog_strength',
  'outputFormat',
  'suffix',
  'activePathIndex',
  'getNegativeLabScanLabel',
  'effectiveActivePathIndex',
  'conversionScope',
  'includedPathSet',
  'pathsToConvert',
  'handleToggleIncludedPath',
  'renderBatchReadiness',
  'acceptedBatchPlanIdentity',
  'buildNegativeLabAcceptedPlanIdentity',
  'negative-lab-workspace',
  'negative-lab-workflow-rail',
  'negative-lab-batch-readiness',
  'negative-lab-agent-activity',
  'negative-lab-agent-affected-frames',
  'negative-lab-agent-command-source',
  'negative-lab-agent-commit-state',
  'negative-lab-agent-dry-run-state',
  'negative-lab-agent-warning-count',
  'negative-lab-conversion-scope',
  'negative-lab-scope-active',
  'negative-lab-scope-all',
  'negative-lab-frame-health-grid',
  'negative-lab-frame-count',
  'negative-lab-roll-warning-count',
  'negative-lab-planned-apply-count',
  'negative-lab-skipped-frame-count',
  'negative-lab-accept-batch-plan',
  'negative-lab-copy-batch-plan',
  'negative-lab-frame-health-row-',
  'negative-lab-frame-warning-chip-',
  'negative-lab-frame-warning-row-',
  'negative-lab-queued-count',
  'negative-lab-active-scan-',
  'negative-lab-include-toggle-',
  'negative-lab-included-status',
  'negative-lab-preview-status',
  'negative-lab-base-status',
  'negative-lab-auto-base-fog',
  'negative-lab-base-sample-area',
  'negative-lab-base-sample-origin',
  'negative-lab-base-sample-readout',
  'negative-lab-base-sample-size',
  'negative-lab-base-density-readout',
  'negative-lab-base-rgb-readout',
  'negative-lab-copy-readout',
  'negative-lab-density-readout',
  'negative-lab-sample-left-edge',
  'negative-lab-sample-center-patch',
  'negative-lab-confidence',
  'negative-lab-export-tiff16',
  'negative-lab-export-jpeg-proof',
  'negative-lab-preset-claim-policy',
  'negative-lab-preset-claim-level',
  'negative-lab-preset-color-response',
  'negative-lab-preset-contrast-curve',
  'negative-lab-preset-film-class',
  'negative-lab-preset-grain-model',
  'negative-lab-preset-intent',
  'negative-lab-preset-metadata',
  'negative-lab-preset-process',
  'negative-lab-preset-provenance',
  'negative-lab-preset-runtime-status',
  'negative-lab-preset-speed-class',
  'negative-lab-profile-disabled-reason',
  'negative-lab-profile-evidence-count',
  'negative-lab-profile-filter-all',
  'negative-lab-profile-filter-black_and_white_silver',
  'negative-lab-profile-filter-color_negative',
  'negative-lab-profile-filter-measured',
  'negative-lab-profile-filter-tabs',
  'negative-lab-profile-measured-badge',
  'negative-lab-profile-non-claims',
  'negative-lab-profile-row-',
  'negative-lab-profile-search',
  'negative-lab-profile-search-empty',
  'negative-lab-profile-runtime-status',
  'negative-lab-profile-sort',
  'negative-lab-profile-sort-catalog',
  'negative-lab-profile-sort-evidence_desc',
  'negative-lab-profile-sort-name_asc',
  'negative-lab-profile-sort-runtime_applied',
  'negative-lab-stock-family-',
  'negative-lab-stock-metadata',
  'negative-lab-stock-metadata-entry-',
  'negative-lab-stock-metadata-list',
  'negative-lab-stock-metadata-policy',
  'negative-lab-stock-metadata-suggested-preset-',
  'negative-lab-stock-registry',
  'NEGATIVE_LAB_STOCK_METADATA_CATALOG',
  'NEGATIVE_LAB_STOCK_METADATA_COUNTS',
  'NEGATIVE_LAB_STOCK_REGISTRY',
]) {
  if (!modalSource.includes(marker)) {
    failures.push(`negative conversion modal is missing workflow marker: ${marker}`);
  }
}

for (const marker of [
  'NegativeConversionSaveOptions',
  'NegativeConversionOutputFormat',
  'NegativeBaseFogEstimate',
  'estimate_negative_base_fog',
  'sanitize_output_suffix',
]) {
  if (!backendSource.includes(marker)) {
    failures.push(`negative conversion backend is missing export marker: ${marker}`);
  }
}

for (const fileName of readdirSync('src/i18n/locales')) {
  if (!fileName.endsWith('.json')) continue;
  const locale = JSON.parse(readFileSync(join('src/i18n/locales', fileName), 'utf8'));
  const negativeConversion = locale?.modals?.negativeConversion;

  for (const key of workflowStageKeys) {
    if (typeof negativeConversion?.[key] !== 'string' || negativeConversion[key].trim().length === 0) {
      failures.push(`${fileName}: missing modals.negativeConversion.${key}`);
    }
  }

  for (const key of ['catalog_only', 'license_review_required']) {
    if (
      typeof negativeConversion?.profileDisabledReasons?.[key] !== 'string' ||
      negativeConversion.profileDisabledReasons[key].trim().length === 0
    ) {
      failures.push(`${fileName}: missing modals.negativeConversion.profileDisabledReasons.${key}`);
    }
  }

  for (const key of NEGATIVE_LAB_OUTPUT_FORMAT_IDS) {
    if (
      typeof negativeConversion?.outputFormats?.[key] !== 'string' ||
      negativeConversion.outputFormats[key].trim().length === 0
    ) {
      failures.push(`${fileName}: missing modals.negativeConversion.outputFormats.${key}`);
    }
  }
}

const englishNegativeConversion = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8'))?.modals
  ?.negativeConversion;
for (const key of stockMetadataLocaleKeys) {
  if (typeof englishNegativeConversion?.[key] !== 'string' || englishNegativeConversion[key].trim().length === 0) {
    failures.push(`en.json: missing modals.negativeConversion.${key}`);
  }
}

if (failures.length > 0) {
  console.error('Negative Lab UI preset validation failed:');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`negative lab UI ok (${NEGATIVE_LAB_BUILT_IN_UI_PRESET_CATALOG.presets.length} presets)`);
