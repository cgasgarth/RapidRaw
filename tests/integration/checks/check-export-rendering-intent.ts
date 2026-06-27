#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

import {
  MOXCMS_EXPORT_COLOR_CAPABILITIES_V1,
  exportColorCapabilityCatalogV1Schema,
} from '../../../packages/rawengine-schema/src/exportColorCapabilities.ts';
import { exportRecipeSchema } from '../../../src/schemas/exportRecipeSchemas.ts';

const read = (path: string) => readFileSync(path, 'utf8');
const failures: string[] = [];

const hookSource = read('src/hooks/useExportSettings.ts');
const panelSource = read('src/components/panel/right/ExportPanel.tsx');
const exportTypesSource = read('src/components/ui/ExportImportProperties.ts');
const rustExportSource = read('src-tauri/src/export_processing.rs');
const rustEncoderSource = read('src-tauri/src/export_encoders.rs');
const capabilitySource = read('packages/rawengine-schema/src/exportColorCapabilities.ts');
const locale = JSON.parse(read('src/i18n/locales/en.json'));

for (const marker of [
  'ExportRenderingIntent',
  'setRenderingIntent(preset.renderingIntent ?? ExportRenderingIntent.RelativeColorimetric)',
  'renderingIntent',
]) {
  if (!hookSource.includes(marker)) failures.push(`useExportSettings missing ${marker}`);
}

for (const marker of [
  'renderingIntentOptions',
  'getExportColorCapability(exportColorCapabilityCatalog, colorProfile)',
  'Invokes.GetExportColorCapabilities',
  'exportColorCapabilityCatalogV1Schema',
  'MOXCMS_EXPORT_COLOR_CAPABILITIES_V1',
  'data-black-point-compensation-status={blackPointCompensationStatus}',
  'data-color-engine={exportColorCapability?.engine',
  'data-rendering-intent-count={renderingIntentOptions.length}',
  'data-testid="export-color-capability"',
  'supportsColorManagedOutput(fileFormat)',
  'isSupportedColorProfileForFormat(fileFormat, colorProfile)',
  'ExportColorProfile.AdobeRgb1998',
  'hasColorManagedTransform',
  'export.colorProfiles.proPhotoRgb',
  'placement="top"',
  'export.advanced.renderingIntent',
  'export.advanced.blackPointCompensationUnavailable',
  'export.advanced.blackPointCompensationJpegTiffRelativeOnly',
  'export.readiness.renderingIntent',
  'renderingIntent,',
]) {
  if (!panelSource.includes(marker)) failures.push(`ExportPanel missing ${marker}`);
}

for (const marker of [
  'blackPointCompensation',
  'exportColorCapabilityCatalogV1Schema',
  'MOXCMS_EXPORT_COLOR_CAPABILITIES_V1',
  "colorProfile === 'srgb' || colorProfile === 'sourceEmbedded' ? 'unsupported' : 'supported'",
  "renderingIntents: colorProfile === 'srgb' ? SRGB_RENDERING_INTENTS : RELATIVE_COLORIMETRIC_ONLY",
  'LittleCMS enables black-point compensation for JPEG/TIFF relative colorimetric wide-gamut exports.',
]) {
  if (!capabilitySource.includes(marker)) failures.push(`Export color capability descriptor missing ${marker}`);
}

for (const marker of ['export_transform_options(rendering_intent)', 'rendering_intent: mox_rendering_intent']) {
  if (!rustExportSource.includes(marker)) failures.push(`Rust export runtime missing ${marker}`);
}
for (const marker of [
  'pub fn get_export_color_capabilities() -> ExportColorCapabilityCatalog',
  'pub(crate) fn resolve_export_color_capabilities() -> ExportColorCapabilityCatalog',
  'ExportBlackPointCompensationStatus::Unsupported',
  'ExportBlackPointCompensationStatus::Supported',
  'ExportColorEngineId::Lcms2',
  'ExportColorEngineId::Moxcms',
]) {
  if (!rustExportSource.includes(marker)) failures.push(`Rust export runtime capability resolver missing ${marker}`);
}
for (const marker of [
  'ColorProfile::new_adobe_rgb()',
  'ColorProfile::new_pro_photo_rgb()',
  'only supported for JPEG and TIFF',
  'rawengine-export-color-policy-v2',
  'sRGB to Display P3 conversion applied',
  'Unavailable for this export path',
  'Enabled via LittleCMS relative colorimetric transform',
  'jpeg_relative_bpc_resolves_to_littlecms_policy',
  'display_p3_jpeg_bpc_encodes_with_littlecms_receipt',
  'unproven_wide_gamut_rendering_intents_are_rejected',
  'export_rgb16_pixels_with_shared_conversion_core',
  'quantize_rgb16_to_rgb8',
  'read_embedded_source_icc_profile',
  'Source embedded profile passthrough; ICC embedded',
  'source_icc_profile_hash',
  'transform_policy_fingerprint',
  'export_color_transform_fingerprint',
]) {
  if (!rustExportSource.includes(marker)) failures.push(`Rust export capability matrix missing ${marker}`);
}

for (const marker of ['validate_export_color_policy(output_format, color_profile)']) {
  if (!rustEncoderSource.includes(marker)) failures.push(`Rust export encoder missing ${marker}`);
}

if (!exportTypesSource.includes('renderingIntent?: ExportRenderingIntent')) {
  failures.push('Export settings/presets do not persist renderingIntent.');
}

const capabilityCatalog = exportColorCapabilityCatalogV1Schema.parse(MOXCMS_EXPORT_COLOR_CAPABILITIES_V1);
if (capabilityCatalog.engine !== 'moxcms') failures.push('Export color capability catalog must identify moxcms.');
if (!capabilityCatalog.capabilities.some((capability) => capability.colorProfile === 'displayP3')) {
  failures.push('Export color capability catalog must cover Display P3.');
}
const displayP3Capability = capabilityCatalog.capabilities.find(
  (capability) => capability.colorProfile === 'displayP3',
);
if (displayP3Capability?.blackPointCompensation !== 'supported') {
  failures.push('Display P3 JPEG/TIFF relative colorimetric export must advertise BPC support.');
}
const sourceEmbeddedCapability = capabilityCatalog.capabilities.find(
  (capability) => capability.colorProfile === 'sourceEmbedded',
);
if (sourceEmbeddedCapability?.blackPointCompensation !== 'unsupported') {
  failures.push('Source embedded export must not advertise BPC support in the passthrough slice.');
}
if (sourceEmbeddedCapability?.renderingIntents.join(',') !== 'relativeColorimetric') {
  failures.push('Source embedded export must advertise only relative colorimetric intent.');
}
if (displayP3Capability?.renderingIntents.join(',') !== 'relativeColorimetric') {
  failures.push('Display P3 export must advertise only proven relative colorimetric intent.');
}
const srgbCapability = capabilityCatalog.capabilities.find((capability) => capability.colorProfile === 'srgb');
if (srgbCapability?.renderingIntents.join(',') !== 'relativeColorimetric,perceptual') {
  failures.push('sRGB export must advertise relative colorimetric and proven perceptual intents.');
}
if (
  !capabilityCatalog.capabilities.every((capability) => capability.renderingIntents.includes('relativeColorimetric'))
) {
  failures.push('Every color-managed export capability must support relative colorimetric intent.');
}

exportRecipeSchema.parse({
  colorProfile: 'displayP3',
  blackPointCompensation: true,
  dontEnlarge: true,
  enableResize: false,
  enableWatermark: false,
  fileFormat: 'jpeg',
  filenameTemplate: '{original_filename}_intent',
  id: 'display-p3-relative-intent',
  jpegQuality: 92,
  keepMetadata: true,
  name: 'Display P3 Relative Intent',
  renderingIntent: 'relativeColorimetric',
  resizeMode: 'longEdge',
  resizeValue: 2048,
  stripGps: true,
  watermarkAnchor: 'bottomRight',
  watermarkOpacity: 75,
  watermarkPath: null,
  watermarkScale: 10,
  watermarkSpacing: 5,
});

for (const key of [
  locale.export?.advanced?.renderingIntent,
  locale.export?.advanced?.blackPointCompensationUnavailable,
  locale.export?.advanced?.blackPointCompensation,
  locale.export?.advanced?.blackPointCompensationJpegTiffRelativeOnly,
  locale.export?.colorProfiles?.adobeRgb1998,
  locale.export?.colorProfiles?.proPhotoRgb,
  locale.export?.renderingIntents?.relativeColorimetric,
  locale.export?.readiness?.renderingIntent,
]) {
  if (typeof key !== 'string' || key.length === 0) failures.push('Missing rendering-intent locale key.');
}

if (failures.length > 0) {
  console.error('export rendering intent failed');
  console.error(failures.slice(0, 8).join('\n'));
  process.exit(1);
}

console.log('export rendering intent ok');
