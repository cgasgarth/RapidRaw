#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

import { exportRecipeSchema } from '../../../src/schemas/exportRecipeSchemas.ts';
import { outputSharpeningSettingsSchema } from '../../../src/schemas/outputSharpeningSchemas.ts';

const read = (path: string) => readFileSync(path, 'utf8');
const failures: string[] = [];

const hookSource = read('src/hooks/useExportSettings.ts');
const panelSource = read('src/components/panel/right/ExportPanel.tsx');
const exportTypesSource = read('src/components/ui/ExportImportProperties.ts');
const rustExportSource = read('src-tauri/src/export_processing.rs');
const locale = JSON.parse(read('src/i18n/locales/en.json'));

for (const marker of [
  'outputSharpening',
  'DEFAULT_OUTPUT_SHARPENING',
  'setOutputSharpening(preset.outputSharpening ?? null)',
  'enableDefaultOutputSharpening',
  'updateOutputSharpening',
]) {
  if (!hookSource.includes(marker)) failures.push(`useExportSettings missing ${marker}`);
}

for (const marker of [
  'outputSharpeningSettingsSchema.parse(outputSharpening)',
  'outputSharpening: parsedOutputSharpening',
  'export.sections.outputSharpening',
  'export.outputSharpening.enable',
  'export.readiness.outputSharpeningOn',
]) {
  if (!panelSource.includes(marker)) failures.push(`ExportPanel missing ${marker}`);
}

if (panelSource.includes('outputSharpening: null')) {
  failures.push('ExportPanel still hard-codes outputSharpening: null.');
}

if (!exportTypesSource.includes('outputSharpening?: OutputSharpeningSettings | null')) {
  failures.push('ExportPreset does not persist outputSharpening.');
}

const parsedSettings = outputSharpeningSettingsSchema.parse({
  amount: 35,
  radiusPx: 0.7,
  target: 'screen',
  threshold: 0.02,
});

exportRecipeSchema.parse({
  colorProfile: 'srgb',
  dontEnlarge: true,
  enableResize: true,
  enableWatermark: false,
  fileFormat: 'jpeg',
  filenameTemplate: '{original_filename}_edited',
  id: 'output-sharpen-ui',
  jpegQuality: 90,
  keepMetadata: true,
  name: 'Output sharpen UI',
  outputSharpening: parsedSettings,
  resizeMode: 'longEdge',
  resizeValue: 2048,
  stripGps: true,
  watermarkAnchor: 'bottomRight',
  watermarkOpacity: 75,
  watermarkPath: null,
  watermarkScale: 10,
  watermarkSpacing: 5,
});

for (const marker of [
  'pub output_sharpening: Option<OutputSharpeningSettings>',
  'apply_output_sharpening(image, output_sharpening)',
  'fn output_sharpening_increases_export_edge_contrast()',
]) {
  if (!rustExportSource.includes(marker)) failures.push(`Rust export runtime missing ${marker}`);
}

for (const key of [
  locale.export?.sections?.outputSharpening,
  locale.export?.outputSharpening?.enable,
  locale.export?.outputSharpening?.targets?.screen,
  locale.export?.readiness?.outputSharpeningOn,
  locale.export?.readiness?.outputSharpeningOff,
]) {
  if (typeof key !== 'string' || key.length === 0) failures.push('Missing output sharpening locale key.');
}

if (failures.length > 0) {
  console.error('output sharpening export UI failed');
  console.error(failures.slice(0, 8).join('\n'));
  process.exit(1);
}

console.log('output sharpening export UI ok');
