#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(path, 'utf8');
const failures: string[] = [];

const toolbarSource = read('src/components/panel/editor/EditorToolbar.tsx');
const exportPanelSource = read('src/components/panel/right/ExportPanel.tsx');
const hookSource = read('src/hooks/useImageProcessing.ts');
const storeSource = read('src/store/useEditorStore.ts');
const appPropertiesSource = read('src/components/ui/AppProperties.tsx');
const rustLibSource = read('src-tauri/src/lib.rs');
const rustExportSource = read('src-tauri/src/export_processing.rs');
const tauriEventSchemasSource = read('src/schemas/tauriEventSchemas.ts');
const locale = JSON.parse(read('src/i18n/locales/en.json'));

for (const marker of [
  'isExportSoftProofEnabled',
  'exportSoftProofRecipeId',
  'data-testid="export-soft-proof-toolbar"',
  'data-testid="export-soft-proof-recipe-details"',
  'data-export-soft-proof-color-profile',
  'data-export-soft-proof-rendering-intent',
  'data-export-soft-proof-status="export-transform-preview"',
  'data-testid="export-soft-proof-active-dot"',
  'data-testid="export-soft-proof-active-badge"',
  'aria-pressed={isExportSoftProofEnabled}',
  'editor.toolbar.exportSoftProofDetails',
  'editor.toolbar.exportSoftProofActive',
  'editor.toolbar.tooltips.exportSoftProof',
]) {
  if (!toolbarSource.includes(marker)) failures.push(`EditorToolbar missing ${marker}`);
}

for (const marker of [
  'Invokes.GenerateExportSoftProofPreview',
  'selectedProofRecipe',
  "colorProfile: selectedProofRecipe.colorProfile ?? 'srgb'",
  "renderingIntent: selectedProofRecipe.renderingIntent ?? 'relativeColorimetric'",
]) {
  if (!hookSource.includes(marker)) failures.push(`useImageProcessing missing ${marker}`);
}

for (const marker of ['GenerateExportSoftProofPreview', 'generate_export_soft_proof_preview']) {
  if (!appPropertiesSource.includes(marker) && !rustLibSource.includes(marker)) {
    failures.push(`soft-proof invoke missing ${marker}`);
  }
}

if (!rustLibSource.includes('export_processing::export_soft_proof_rgb_pixels_and_profile')) {
  failures.push('Rust soft-proof command does not reuse export color transform.');
}

if (
  !rustExportSource.includes('pub(crate) fn export_soft_proof_rgb_pixels_and_profile') ||
  !rustExportSource.includes('export_rgb_pixels_and_profile(image, color_profile, rendering_intent)') ||
  !rustExportSource.includes('export_color_transform_receipt_label(color_profile, rendering_intent)')
) {
  failures.push('export_rgb_pixels_and_profile is not available to the soft-proof command and receipt.');
}

for (const marker of [
  'colorManagedTransform',
  'effectiveColorProfile',
  'iccEmbedded',
  'policyVersion',
  'requestedColorProfile',
  'sourcePrecisionPath',
  'transformApplied',
  'data-export-receipt-color-managed-transform',
  'data-export-receipt-effective-color-profile',
  'data-export-receipt-icc-embedded',
  'data-export-receipt-policy-version',
  'data-export-receipt-source-precision-path',
  'data-export-receipt-transform-applied',
  'data-testid="export-success-color-managed-transform"',
  'data-testid="export-success-color-policy"',
  'export.status.colorManagedTransform',
]) {
  if (!exportPanelSource.includes(marker) && !tauriEventSchemasSource.includes(marker)) {
    failures.push(`Export receipt missing ${marker}`);
  }
}

if (
  !storeSource.includes('isExportSoftProofEnabled: false') ||
  !storeSource.includes('exportSoftProofRecipeId: null')
) {
  failures.push('Editor store missing non-mutating soft-proof defaults.');
}

if (typeof locale.editor?.toolbar?.tooltips?.exportSoftProof !== 'string') {
  failures.push('Missing export soft-proof tooltip locale.');
}

if (typeof locale.editor?.toolbar?.exportSoftProofDetails !== 'string') {
  failures.push('Missing export soft-proof details locale.');
}

if (typeof locale.editor?.toolbar?.exportSoftProofActive !== 'string') {
  failures.push('Missing export soft-proof active locale.');
}

if (typeof locale.export?.status?.colorManagedTransform !== 'string') {
  failures.push('Missing export receipt color-managed transform locale.');
}

for (const key of ['cmm', 'iccEmbedded', 'identityTransform', 'transformApplied']) {
  if (typeof locale.export?.status?.[key] !== 'string') failures.push(`Missing export receipt ${key} locale.`);
}

if (failures.length > 0) {
  console.error('export soft-proof UI failed');
  console.error(failures.slice(0, 8).join('\n'));
  process.exit(1);
}

console.log('export soft-proof UI ok');
