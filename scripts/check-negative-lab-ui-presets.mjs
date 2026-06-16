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

  const text = `${preset.presetId} ${preset.displayName}`;
  if (unsafeClaims.test(text)) {
    failures.push(`${preset.presetId}: generic preset contains unsafe stock or brand claim`);
  }
}

if (!ids.has(NEGATIVE_LAB_BUILT_IN_UI_PRESET_CATALOG.defaultPresetId)) {
  failures.push('default preset id is missing from catalog');
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
  'baseFogConfidence',
  'baseFogStrength',
  'baseFogSample',
  'sampleCenterPatch',
  'sampleFullFrame',
  'sampleLeftEdge',
  'sampleOverlayLabel',
  'exportOptions',
  'outputSuffix',
];
const modalSource = readFileSync('src/components/modals/NegativeConversionModal.tsx', 'utf8');
const backendSource = readFileSync('src-tauri/src/negative_conversion.rs', 'utf8');

for (const marker of [
  'NegativeLabWorkflowStage',
  'workflowStages',
  'renderWorkflowRail',
  'handleAutoBaseFog',
  'base_fog_strength',
  'outputFormat',
  'suffix',
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
