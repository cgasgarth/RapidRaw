#!/usr/bin/env bun
// @ts-check

import { NEGATIVE_LAB_BUILT_IN_UI_PRESET_CATALOG } from '../src/utils/negativeLabPresetCatalog.ts';
import { parseNegativeLabBuiltInUiPresetCatalog } from '../src/schemas/negativeLabPresetCatalogSchemas.ts';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const unsafeClaims =
  /\b(?:adobe|capture one|dehancer|ektachrome|ektar|exact|fujifilm|fuji|gold|ilford|kodak|lightroom|mastin|negative lab pro|nlp|official|portra|rni|tri-x|t-max|vsco)\b/iu;

const failures = [];
const ids = new Set();
parseNegativeLabBuiltInUiPresetCatalog(NEGATIVE_LAB_BUILT_IN_UI_PRESET_CATALOG);

for (const preset of NEGATIVE_LAB_BUILT_IN_UI_PRESET_CATALOG.presets) {
  ids.add(preset.presetId);

  const text = [
    preset.presetId,
    preset.displayName,
    preset.intent,
    preset.claimLevel,
    preset.claimPolicy,
    preset.legalNote,
    preset.measurementSource,
    preset.profileStatus,
    preset.processFamily,
    preset.processHint,
    preset.provenanceSummary,
    preset.runtimeStatus,
    preset.stockFamilyDescriptor,
  ].join(' ');
  if (unsafeClaims.test(text)) {
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
}

if (!ids.has(NEGATIVE_LAB_BUILT_IN_UI_PRESET_CATALOG.defaultPresetId)) {
  failures.push('default preset id is missing from catalog');
}

if (NEGATIVE_LAB_BUILT_IN_UI_PRESET_CATALOG.presets.length < 12) {
  failures.push('Negative Lab UI preset catalog must include at least 12 generic family starters');
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
  'autoBaseFog',
  'autoBaseFogTooltip',
  'basePending',
  'baseFogConfidence',
  'baseReady',
  'baseSampleArea',
  'baseSampleOrigin',
  'baseSampleSize',
  'baseFogStrength',
  'baseFogSample',
  'batchReadiness',
  'convertAndSaveActive',
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
  'presetRuntimeApplied',
  'presetRuntimeCatalogOnly',
  'previewPending',
  'previewReady',
  'queuedScans',
  'scopeActive',
  'scopeAll',
  'workflowExportReadyCount',
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
  'negative-lab-workspace',
  'negative-lab-workflow-rail',
  'negative-lab-batch-readiness',
  'negative-lab-conversion-scope',
  'negative-lab-scope-active',
  'negative-lab-scope-all',
  'negative-lab-frame-health-grid',
  'negative-lab-frame-health-row-',
  'negative-lab-frame-warning-chip-',
  'negative-lab-frame-warning-row-',
  'negative-lab-queued-count',
  'negative-lab-include-toggle-',
  'negative-lab-included-status',
  'negative-lab-preview-status',
  'negative-lab-base-status',
  'negative-lab-auto-base-fog',
  'negative-lab-base-sample-area',
  'negative-lab-base-sample-origin',
  'negative-lab-base-sample-readout',
  'negative-lab-base-sample-size',
  'negative-lab-sample-left-edge',
  'negative-lab-sample-center-patch',
  'negative-lab-confidence',
  'negative-lab-export-tiff16',
  'negative-lab-export-jpeg-proof',
  'negative-lab-preset-claim-policy',
  'negative-lab-preset-claim-level',
  'negative-lab-preset-film-class',
  'negative-lab-preset-intent',
  'negative-lab-preset-process',
  'negative-lab-preset-provenance',
  'negative-lab-preset-runtime-status',
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

  for (const key of ['jpeg_proof', 'tiff16']) {
    if (
      typeof negativeConversion?.outputFormats?.[key] !== 'string' ||
      negativeConversion.outputFormats[key].trim().length === 0
    ) {
      failures.push(`${fileName}: missing modals.negativeConversion.outputFormats.${key}`);
    }
  }
}

if (failures.length > 0) {
  console.error('Negative Lab UI preset validation failed:');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`negative lab UI ok (${NEGATIVE_LAB_BUILT_IN_UI_PRESET_CATALOG.presets.length} presets)`);
