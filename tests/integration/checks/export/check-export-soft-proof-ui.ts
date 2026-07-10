#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(path, 'utf8');
const failures: string[] = [];

const toolbarSource = read('src/components/panel/editor/EditorToolbar.tsx');
const toolbarCommandSource = read('src/components/panel/editor/editorToolbarCommands.ts');
const exportPanelSource = read('src/components/panel/right/export/ExportPanel.tsx');
const hookSource = read('src/hooks/editor/useImageProcessing.ts');
const storeSource = read('src/store/useEditorStore.ts');
const commandsSource = read('src/tauri/commands.ts');
const rustLibSource = read('src-tauri/src/lib.rs');
const rustExportSource = read('src-tauri/src/export/export_processing.rs');
const rustExportColorPolicySource = read('src-tauri/src/export/export_color_policy.rs');
const rustExportRuntimeSource = `${rustExportSource}\n${rustExportColorPolicySource}`;
const tauriEventSchemasSource = read('src/schemas/tauriEventSchemas.ts');
const locale = JSON.parse(read('src/i18n/locales/en.json'));

for (const marker of [
  'isExportSoftProofEnabled',
  'exportSoftProofRecipeId',
  'toggleSoftProof',
  'editor.toolbar.tooltips.exportSoftProof',
]) {
  if (!toolbarSource.includes(marker)) failures.push(`EditorToolbar missing ${marker}`);
}

if (!toolbarCommandSource.includes("command('soft-proof'")) {
  failures.push('Editor toolbar command model missing soft-proof command');
}

for (const removedDiagnostic of [
  'data-testid="export-soft-proof-toolbar"',
  'data-testid="export-soft-proof-active-badge"',
  'data-export-soft-proof-transform-policy-fingerprint',
]) {
  if (toolbarSource.includes(removedDiagnostic))
    failures.push(`EditorToolbar retained proof diagnostic ${removedDiagnostic}`);
}

for (const marker of [
  'Invokes.GenerateExportSoftProofPreview',
  'Invokes.ResolveExportSoftProofTransformMetadata',
  'selectedProofRecipe',
  'blackPointCompensation: selectedProofRecipe.blackPointCompensation ?? false',
  "colorProfile: selectedProofRecipe.colorProfile ?? 'srgb'",
  'exportSoftProofRecipeId: selectedProofRecipe.id',
  "renderingIntent: selectedProofRecipe.renderingIntent ?? 'relativeColorimetric'",
  'exportSoftProofTransformResponseSchema',
]) {
  if (!hookSource.includes(marker)) failures.push(`useImageProcessing missing ${marker}`);
}

for (const marker of [
  'GenerateExportSoftProofPreview',
  'generate_export_soft_proof_preview',
  'ResolveExportSoftProofTransformMetadata',
  'resolve_export_soft_proof_transform_metadata',
]) {
  if (!commandsSource.includes(marker) && !rustLibSource.includes(marker)) {
    failures.push(`soft-proof invoke missing ${marker}`);
  }
}

if (!rustLibSource.includes('export_processing::export_soft_proof_rgb_pixels_and_profile')) {
  failures.push('Rust soft-proof command does not reuse export color transform.');
}

if (!rustLibSource.includes('export_processing::export_soft_proof_transform_metadata')) {
  failures.push('Rust soft-proof metadata command does not resolve export transform metadata.');
}

if (
  !rustExportRuntimeSource.includes('pub(crate) fn export_soft_proof_rgb_pixels_and_profile') ||
  !rustExportRuntimeSource.includes('export_soft_proof_rgb_pixels_and_profile_with_policy') ||
  !rustExportRuntimeSource.includes('export_soft_proof_transform_metadata') ||
  !rustExportRuntimeSource.includes('export_rgb_pixels_and_profile(') ||
  !rustExportRuntimeSource.includes('resolve_export_color_transform_plan(')
) {
  failures.push('export_rgb_pixels_and_profile is not available to the soft-proof command and receipt.');
}

for (const marker of [
  'colorManagedTransform',
  'effectiveColorProfile',
  'iccEmbedded',
  'policyVersion',
  'policyStatus',
  'requestedColorProfile',
  'requestedRenderingIntent',
  'effectiveRenderingIntent',
  'sourcePrecisionPath',
  'transformPolicyFingerprint',
  'transformApplied',
  'data-export-receipt-color-managed-transform',
  'data-export-receipt-effective-color-profile',
  'data-export-receipt-icc-embedded',
  'data-export-receipt-policy-status',
  'data-export-receipt-policy-version',
  'data-export-receipt-requested-rendering-intent',
  'data-export-receipt-effective-rendering-intent',
  'data-export-receipt-source-precision-path',
  'data-export-receipt-transform-policy-fingerprint',
  'data-export-receipt-transform-applied',
  'data-testid="export-success-color-managed-transform"',
  'data-testid="export-success-color-policy"',
  'data-testid="export-soft-proof-warnings"',
  'data-testid="export-soft-proof-resolver"',
  'data-testid="export-soft-proof-resolver-use-proof"',
  'data-testid="export-soft-proof-resolver-preview-export"',
  'data-export-soft-proof-resolver-proof-profile',
  'data-export-soft-proof-resolver-proof-intent',
  'data-export-soft-proof-resolver-black-point-compensation',
  'data-export-soft-proof-resolver-fingerprint',
  'data-export-soft-proof-resolver-parity-status',
  'getExportSoftProofResolverStatus',
  'upsertExportSoftProofResolverPreset',
  'data-export-soft-proof-warning-codes',
  'data-export-soft-proof-warning-count',
  'soft-proof-preview-off',
  'soft-proof-profile-mismatch',
  'soft-proof-intent-mismatch',
  'gamut-clipping-visible',
  'isCurrentExportSoftProofGamutWarningOverlay(gamutWarningOverlay',
  'formatGamutWarningCoverage(gamutWarningOverlay)',
  'export.status.colorManagedTransform',
]) {
  if (!exportPanelSource.includes(marker) && !tauriEventSchemasSource.includes(marker)) {
    failures.push(`Export receipt missing ${marker}`);
  }
}

if (
  !storeSource.includes('isExportSoftProofEnabled: false') ||
  !storeSource.includes('exportSoftProofRecipeId: null') ||
  !storeSource.includes('exportSoftProofTransform: null') ||
  !storeSource.includes('ExportSoftProofTransformState')
) {
  failures.push('Editor store missing non-mutating soft-proof defaults.');
}

for (const marker of [
  'preview_basis: z.literal',
  'export_soft_proof_recipe_id',
  'source_image_path',
  'transform_policy_fingerprint',
]) {
  if (!tauriEventSchemasSource.includes(marker)) {
    failures.push(`Gamut warning overlay schema missing provenance marker: ${marker}`);
  }
}

for (const marker of [
  'isPendingExportSoftProofGamutWarningOverlay',
  'gamutWarningOverlay: null',
  'exportSoftProofRecipeId',
  'exportSoftProofTransform',
]) {
  if (!storeSource.includes(marker)) failures.push(`Editor store missing overlay stale-state marker: ${marker}`);
}

for (const marker of [
  'isCurrentExportSoftProofGamutWarningOverlay(gamutWarningOverlay',
  'data-preview-basis={gamutWarningOverlay.preview_basis}',
  'data-transform-policy-fingerprint={gamutWarningOverlay.transform_policy_fingerprint}',
  'data-export-soft-proof-recipe-id={gamutWarningOverlay.export_soft_proof_recipe_id}',
]) {
  if (!read('src/components/panel/editor/ImageCanvas.tsx').includes(marker)) {
    failures.push(`ImageCanvas missing current-proof overlay marker: ${marker}`);
  }
}

for (const marker of [
  'export_soft_proof_recipe_id: Option<String>',
  'calculate_gamut_warning_overlay_from_image',
  '"preview_basis": "export_preview"',
  '"transform_policy_fingerprint": proof_metadata.transform_policy_fingerprint',
]) {
  if (!rustLibSource.includes(marker)) failures.push(`Rust soft-proof overlay event missing ${marker}`);
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

for (const key of ['title', 'previewOff', 'profileMismatch', 'intentMismatch', 'gamutClipping']) {
  if (typeof locale.export?.softProofWarnings?.[key] !== 'string') {
    failures.push(`Missing export soft-proof warning locale: ${key}`);
  }
}

for (const key of ['title', 'useCurrentSoftProof', 'previewCurrentExport', 'resultingProfile', 'renderingIntent']) {
  if (typeof locale.export?.softProofResolver?.[key] !== 'string') {
    failures.push(`Missing export soft-proof resolver locale: ${key}`);
  }
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
