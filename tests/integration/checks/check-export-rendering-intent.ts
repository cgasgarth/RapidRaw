#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

import {
  MOXCMS_EXPORT_COLOR_CAPABILITIES_V1,
  exportColorCapabilityCatalogV1Schema,
} from '../../../packages/rawengine-schema/src/exportColorCapabilities.ts';
import {
  ExportColorProfile,
  ExportRenderingIntent,
  FileFormats,
} from '../../../src/components/ui/ExportImportProperties.ts';
import { exportRecipeSchema } from '../../../src/schemas/exportRecipeSchemas.ts';
import {
  getBlackPointCompensationStatus,
  getExportColorCapability,
  getSupportedRenderingIntents,
  hasColorManagedTransform,
  isBlackPointCompensationAvailable,
  isSupportedColorProfileForFormat,
  supportsColorManagedOutput,
} from '../../../src/utils/exportColorCapabilityContracts.ts';

const failures: string[] = [];
const locale = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8'));
const capabilityCatalog = exportColorCapabilityCatalogV1Schema.parse(MOXCMS_EXPORT_COLOR_CAPABILITIES_V1);

if (capabilityCatalog.engine !== 'moxcms') failures.push('Export color capability catalog must identify moxcms.');
if (capabilityCatalog.schemaVersion !== 1)
  failures.push('Export color capability catalog must stay on schemaVersion 1.');

const expectedProfiles = [
  ExportColorProfile.Srgb,
  ExportColorProfile.DisplayP3,
  ExportColorProfile.AdobeRgb1998,
  ExportColorProfile.ProPhotoRgb,
  ExportColorProfile.SourceEmbedded,
];
const catalogProfiles = capabilityCatalog.capabilities.map((capability) => capability.colorProfile);
for (const profile of expectedProfiles) {
  if (!catalogProfiles.includes(profile)) failures.push(`Export color capability catalog missing ${profile}.`);
}
if (new Set(catalogProfiles).size !== catalogProfiles.length) {
  failures.push('Export color capability catalog contains duplicate color profiles.');
}

const srgbCapability = getExportColorCapability(capabilityCatalog, ExportColorProfile.Srgb);
const displayP3Capability = getExportColorCapability(capabilityCatalog, ExportColorProfile.DisplayP3);
const adobeRgbCapability = getExportColorCapability(capabilityCatalog, ExportColorProfile.AdobeRgb1998);
const proPhotoCapability = getExportColorCapability(capabilityCatalog, ExportColorProfile.ProPhotoRgb);
const sourceEmbeddedCapability = getExportColorCapability(capabilityCatalog, ExportColorProfile.SourceEmbedded);

if (srgbCapability?.renderingIntents.join(',') !== 'relativeColorimetric,perceptual') {
  failures.push('sRGB export must advertise relative colorimetric and perceptual intents.');
}
for (const [label, capability] of [
  ['Display P3', displayP3Capability],
  ['Adobe RGB 1998', adobeRgbCapability],
  ['ProPhoto RGB', proPhotoCapability],
  ['source embedded', sourceEmbeddedCapability],
] as const) {
  if (capability?.renderingIntents.join(',') !== 'relativeColorimetric') {
    failures.push(`${label} export must advertise only the proven relative colorimetric intent.`);
  }
}
if (displayP3Capability?.blackPointCompensation !== 'supported') {
  failures.push('Display P3 JPEG/TIFF relative colorimetric export must advertise BPC support.');
}
if (sourceEmbeddedCapability?.blackPointCompensation !== 'unsupported') {
  failures.push('Source embedded export must not advertise BPC support in the passthrough path.');
}
if (
  !capabilityCatalog.capabilities.every((capability) => capability.renderingIntents.includes('relativeColorimetric'))
) {
  failures.push('Every color-managed export capability must support relative colorimetric intent.');
}

if (!supportsColorManagedOutput(FileFormats.Jpeg)) failures.push('JPEG must support color-managed output.');
if (!supportsColorManagedOutput(FileFormats.Tiff)) failures.push('TIFF must support color-managed output.');
if (supportsColorManagedOutput(FileFormats.Png))
  failures.push('PNG must not advertise wide-gamut color-managed output.');
if (!isSupportedColorProfileForFormat(FileFormats.Jpeg, ExportColorProfile.DisplayP3)) {
  failures.push('JPEG must accept Display P3 exports.');
}
if (isSupportedColorProfileForFormat(FileFormats.Png, ExportColorProfile.DisplayP3)) {
  failures.push('PNG must reject Display P3 exports.');
}
if (!isSupportedColorProfileForFormat(FileFormats.Png, ExportColorProfile.Srgb)) {
  failures.push('PNG must keep sRGB export support.');
}
if (!hasColorManagedTransform(FileFormats.Jpeg, ExportColorProfile.DisplayP3)) {
  failures.push('JPEG Display P3 exports must require a color-managed transform.');
}
if (hasColorManagedTransform(FileFormats.Jpeg, ExportColorProfile.Srgb)) {
  failures.push('JPEG sRGB exports must not require a wide-gamut transform.');
}

const displayP3Intents = getSupportedRenderingIntents(
  capabilityCatalog,
  FileFormats.Jpeg,
  ExportColorProfile.DisplayP3,
);
if (displayP3Intents.join(',') !== ExportRenderingIntent.RelativeColorimetric) {
  failures.push('Display P3 rendering-intent options must be limited to relative colorimetric.');
}
const srgbIntents = getSupportedRenderingIntents(capabilityCatalog, FileFormats.Jpeg, ExportColorProfile.Srgb);
if (srgbIntents.length !== 0) failures.push('sRGB exports should not render wide-gamut intent controls.');
if (
  getBlackPointCompensationStatus(capabilityCatalog, FileFormats.Jpeg, ExportColorProfile.DisplayP3) !== 'supported'
) {
  failures.push('Display P3 JPEG BPC status must resolve to supported.');
}
if (
  getBlackPointCompensationStatus(capabilityCatalog, FileFormats.Png, ExportColorProfile.DisplayP3) !== 'unsupported'
) {
  failures.push('Display P3 PNG BPC status must resolve to unsupported.');
}
if (
  !isBlackPointCompensationAvailable({
    catalog: capabilityCatalog,
    colorProfile: ExportColorProfile.DisplayP3,
    fileFormat: FileFormats.Jpeg,
    renderingIntent: ExportRenderingIntent.RelativeColorimetric,
  })
) {
  failures.push('Display P3 JPEG relative colorimetric exports must allow BPC.');
}
if (
  isBlackPointCompensationAvailable({
    catalog: capabilityCatalog,
    colorProfile: ExportColorProfile.DisplayP3,
    fileFormat: FileFormats.Jpeg,
    renderingIntent: ExportRenderingIntent.Perceptual,
  })
) {
  failures.push('Perceptual Display P3 JPEG exports must not allow BPC.');
}

const parsedRecipe = exportRecipeSchema.parse({
  blackPointCompensation: true,
  colorProfile: 'displayP3',
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
if (parsedRecipe.renderingIntent !== 'relativeColorimetric') {
  failures.push('Export recipe schema did not persist renderingIntent.');
}
if (
  exportRecipeSchema.safeParse({
    ...parsedRecipe,
    id: 'invalid-rendering-intent',
    renderingIntent: 'sceneReferred',
  }).success
) {
  failures.push('Export recipe schema accepted an unsupported rendering intent.');
}

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
  console.error('export rendering intent contract failed');
  console.error(failures.slice(0, 10).join('\n'));
  process.exit(1);
}

console.log('export rendering intent contract ok');
