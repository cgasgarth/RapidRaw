#!/usr/bin/env bun
// @ts-check

import { readFileSync } from 'node:fs';

const files = {
  backend: readFileSync('src-tauri/src/negative_conversion.rs', 'utf8'),
  lib: readFileSync('src-tauri/src/lib.rs', 'utf8'),
  modal: readFileSync('src/components/modals/NegativeConversionModal.tsx', 'utf8'),
  schema: readFileSync('src/schemas/negativeLabPresetCatalogSchemas.ts', 'utf8'),
};

const failures = [];
const requireMarker = (source, marker, label) => {
  if (!source.includes(marker)) {
    failures.push(`${label}: missing ${marker}`);
  }
};

for (const marker of [
  'base_fog_strength',
  'base_fog_sample',
  'NegativeBaseFogSampleRect',
  'NegativeBaseFogEstimate',
  'base_rgb',
  'base_density',
  'estimate_base_fog_from_image',
  'sampled_base_fog_estimate_uses_requested_patch',
  'base_fog_strength_changes_thin_density_rendering',
  'base_fog_estimate_returns_bounded_weights_and_confidence',
]) {
  requireMarker(files.backend, marker, 'backend');
}

requireMarker(files.lib, 'negative_conversion::estimate_negative_base_fog', 'command registry');

for (const marker of [
  'handleAutoBaseFog',
  'handleSampleBaseFog',
  'Invokes.EstimateNegativeBaseFog',
  'invokeWithSchema',
  'negativeBaseFogEstimateSchema',
  'BASE_FOG_SAMPLE_PRESETS',
  'renderBaseFogSampleOverlay',
  'negative-lab-base-sample-overlay',
  'base_fog_strength',
  'base_fog_sample',
  'baseFogConfidence',
  'baseFogEstimate',
  'handleCopyBaseFogReadout',
  'handleSamplePatchProbe',
  'handleMeasureCustomBaseSample',
  'handleApplyCustomBaseSample',
  'handleUndoBaseFogSample',
  'baseFogSampleUndoStack',
  'customBaseSampleRect',
  'DENSITOMETER_PATCH_PRESETS',
  'negative-lab-density-readout',
  'negative-lab-densitometer-readout',
  'negative-lab-patch-probe-readout',
  'negative-lab-patch-probe-overlay',
  'negative-lab-custom-base-readout',
  'negative-lab-custom-base-overlay',
  'negative-lab-apply-custom-base',
  'negative-lab-undo-base-sample',
  'negative-lab-density-spread',
  'negative-lab-neutrality-status',
  'negative-lab-base-rgb-readout',
  'negative-lab-base-density-readout',
  'negative-lab-copy-readout',
]) {
  requireMarker(files.modal, marker, 'modal');
}

for (const marker of [
  'negativeLabBaseFogSampleRectSchema',
  'negativeBaseFogEstimateSchema',
  'negativeBaseFogDensitometerReadoutSchema',
  'negativeConversionSavedPathsSchema',
  'base_fog_strength',
  'base_fog_sample',
]) {
  requireMarker(files.schema, marker, 'schema');
}

if (failures.length > 0) {
  console.error(`negative lab base/fog failed (${failures.length})`);
  console.error(failures.slice(0, 20).join('\n'));
  process.exit(1);
}

console.log('negative lab base/fog ok');
