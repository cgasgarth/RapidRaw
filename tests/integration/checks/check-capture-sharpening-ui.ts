#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

import { z } from 'zod';

import { parseCaptureSharpeningPreset } from '../../../src/schemas/captureSharpeningSchemas.ts';
import {
  buildCaptureSharpeningProcessingPatch,
  CAPTURE_SHARPENING_PRESETS,
} from '../../../src/utils/captureSharpeningPresets.ts';

const read = (path: string) => readFileSync(path, 'utf8');
const failures: string[] = [];

const fixturePresets = z.array(z.unknown()).parse(JSON.parse(read('fixtures/detail/capture-sharpening-presets.json')));
const fixtureIds = fixturePresets.map((preset) => parseCaptureSharpeningPreset(preset).id).join(',');
const runtimeIds = CAPTURE_SHARPENING_PRESETS.map((preset) => preset.id).join(',');

if (fixtureIds !== runtimeIds) {
  failures.push('Capture sharpening runtime presets must match fixture preset ids.');
}

const defaultPatch = buildCaptureSharpeningProcessingPatch(CAPTURE_SHARPENING_PRESETS[0]);
if (
  defaultPatch.rawPreprocessingSharpening !== 0.35 ||
  defaultPatch.rawPreprocessingColorNr !== 0.5 ||
  defaultPatch.applyPreprocessingToNonRaws !== false
) {
  failures.push('Default capture sharpening preset does not map to current runtime defaults.');
}

const settingsSource = read('src/components/panel/SettingsPanel.tsx');
for (const marker of [
  'data-testid="capture-sharpening-preset-control"',
  'CAPTURE_SHARPENING_PRESETS',
  'buildCaptureSharpeningProcessingPatch(preset)',
  'findMatchingCaptureSharpeningPreset',
  'settings.processing.preprocessing.captureSharpeningPreset',
  'settings.processing.preprocessing.captureSharpeningPresetDesc',
]) {
  if (!settingsSource.includes(marker)) failures.push(`SettingsPanel missing ${marker}`);
}

const imageLoaderSource = read('src-tauri/src/image_loader.rs');
for (const marker of [
  'settings.raw_preprocessing_color_nr.unwrap_or(0.5)',
  'settings.raw_preprocessing_sharpening.unwrap_or(0.35)',
  'remove_raw_artifacts_and_enhance',
]) {
  if (!imageLoaderSource.includes(marker)) failures.push(`image_loader missing ${marker}`);
}

const imageProcessingSource = read('src-tauri/src/image_processing.rs');
for (const marker of [
  'fn capture_pre_sharpening_enhances_synthetic_edge()',
  'fn disabled_capture_pre_sharpening_preserves_synthetic_edge()',
]) {
  if (!imageProcessingSource.includes(marker)) failures.push(`image_processing missing ${marker}`);
}

if (failures.length > 0) {
  console.error('capture sharpening UI validation failed');
  console.error(failures.slice(0, 8).join('\n'));
  process.exit(1);
}

console.log('capture sharpening UI ok');
