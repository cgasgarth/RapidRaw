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
  'NegativeBaseFogEstimate',
  'estimate_base_fog_from_image',
  'base_fog_strength_changes_thin_density_rendering',
  'base_fog_estimate_returns_bounded_weights_and_confidence',
]) {
  requireMarker(files.backend, marker, 'backend');
}

requireMarker(files.lib, 'negative_conversion::estimate_negative_base_fog', 'command registry');

for (const marker of [
  'handleAutoBaseFog',
  'estimate_negative_base_fog',
  'invokeWithSchema',
  'negativeBaseFogEstimateSchema',
  'base_fog_strength',
  'baseFogConfidence',
]) {
  requireMarker(files.modal, marker, 'modal');
}

for (const marker of ['negativeBaseFogEstimateSchema', 'negativeConversionSavedPathsSchema', 'base_fog_strength']) {
  requireMarker(files.schema, marker, 'schema');
}

if (failures.length > 0) {
  console.error(`negative lab base/fog failed (${failures.length})`);
  console.error(failures.slice(0, 20).join('\n'));
  process.exit(1);
}

console.log('negative lab base/fog ok');
