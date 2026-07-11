import { expect, test } from 'bun:test';
import { exportColorCapabilityCatalogV1Schema } from '../../../packages/rawengine-schema/src/exportColorCapabilities.ts';
import {
  ExportColorProfile,
  type ExportPreset,
  ExportRenderingIntent,
  FileFormats,
} from '../../../src/components/ui/ExportImportProperties.ts';
import { resolveExportCancellationPending } from '../../../src/utils/export/exportCancellationState.ts';
import { normalizeExportColorSelection } from '../../../src/utils/export/exportColorSelection.ts';
import { resolveExportSoftProofRecipe } from '../../../src/utils/export/exportSoftProofRecipeSelection.ts';

const catalog = exportColorCapabilityCatalogV1Schema.parse({
  capabilities: [
    {
      blackPointCompensation: 'supported',
      colorProfile: 'displayP3',
      engine: 'lcms2',
      renderingIntents: ['perceptual', 'relativeColorimetric'],
      runtimeSupportNotes: ['test'],
    },
    {
      blackPointCompensation: 'unsupported',
      colorProfile: 'srgb',
      engine: 'lcms2',
      renderingIntents: ['relativeColorimetric'],
      runtimeSupportNotes: ['test'],
    },
    {
      blackPointCompensation: 'unsupported',
      colorProfile: 'sourceEmbedded',
      engine: 'lcms2',
      renderingIntents: ['relativeColorimetric'],
      runtimeSupportNotes: ['test'],
    },
  ],
  engine: 'lcms2',
  schemaVersion: 1,
});

test('export color selection preserves a fully supported tuple', () => {
  expect(
    normalizeExportColorSelection({
      catalog,
      fileFormat: FileFormats.Jpeg,
      requestedBlackPointCompensation: true,
      requestedColorProfile: ExportColorProfile.DisplayP3,
      requestedRenderingIntent: ExportRenderingIntent.RelativeColorimetric,
    }),
  ).toEqual({
    blackPointCompensation: true,
    colorProfile: ExportColorProfile.DisplayP3,
    reasons: [],
    renderingIntent: ExportRenderingIntent.RelativeColorimetric,
  });
});

test('format and partial-catalog fallbacks normalize the complete tuple atomically', () => {
  expect(
    normalizeExportColorSelection({
      catalog,
      fileFormat: FileFormats.Png,
      requestedBlackPointCompensation: true,
      requestedColorProfile: ExportColorProfile.DisplayP3,
      requestedRenderingIntent: ExportRenderingIntent.Perceptual,
    }),
  ).toEqual({
    blackPointCompensation: false,
    colorProfile: ExportColorProfile.Srgb,
    reasons: ['profile', 'intent', 'bpc'],
    renderingIntent: ExportRenderingIntent.RelativeColorimetric,
  });

  const p3OnlyCatalog = exportColorCapabilityCatalogV1Schema.parse({
    ...catalog,
    capabilities: [catalog.capabilities[0]],
  });
  expect(
    normalizeExportColorSelection({
      catalog: p3OnlyCatalog,
      fileFormat: FileFormats.Tiff,
      requestedBlackPointCompensation: false,
      requestedColorProfile: ExportColorProfile.Srgb,
      requestedRenderingIntent: ExportRenderingIntent.AbsoluteColorimetric,
    }),
  ).toMatchObject({
    colorProfile: ExportColorProfile.DisplayP3,
    reasons: ['profile', 'intent'],
    renderingIntent: ExportRenderingIntent.RelativeColorimetric,
  });
});

test('Source Embedded always forces relative intent and disables BPC', () => {
  expect(
    normalizeExportColorSelection({
      catalog,
      fileFormat: FileFormats.Jpeg,
      requestedBlackPointCompensation: true,
      requestedColorProfile: ExportColorProfile.SourceEmbedded,
      requestedRenderingIntent: ExportRenderingIntent.Perceptual,
    }),
  ).toEqual({
    blackPointCompensation: false,
    colorProfile: ExportColorProfile.SourceEmbedded,
    reasons: ['intent', 'bpc'],
    renderingIntent: ExportRenderingIntent.RelativeColorimetric,
  });
});

test('soft-proof recipes resolve enabling, deletion fallback, disabled retention, and empty catalogs', () => {
  const presets = [preset('one'), preset('two'), preset('lut', 'cube')];
  expect(resolveExportSoftProofRecipe({ enabled: true, presets, requestedRecipeId: 'two' })).toEqual({
    enabled: true,
    recipeId: 'two',
    status: 'enabled',
  });
  expect(resolveExportSoftProofRecipe({ enabled: true, presets, requestedRecipeId: 'missing' })).toEqual({
    enabled: true,
    recipeId: 'one',
    status: 'fallback',
  });
  expect(resolveExportSoftProofRecipe({ enabled: false, presets, requestedRecipeId: 'two' })).toEqual({
    enabled: false,
    recipeId: 'two',
    status: 'disabled',
  });
  expect(
    resolveExportSoftProofRecipe({ enabled: true, presets: [preset('lut', 'cube')], requestedRecipeId: 'lut' }),
  ).toEqual({
    enabled: false,
    recipeId: null,
    status: 'unavailable',
  });
});

test('export cancellation ends in the terminal status render without an observer Effect', () => {
  expect(resolveExportCancellationPending({ isExporting: true, requested: true })).toBe(true);
  expect(resolveExportCancellationPending({ isExporting: false, requested: true })).toBe(false);
});

function preset(id: string, fileFormat = 'jpeg'): ExportPreset {
  return {
    dontEnlarge: true,
    enableResize: false,
    enableWatermark: false,
    fileFormat,
    filenameTemplate: '{original_filename}',
    id,
    jpegQuality: 90,
    keepMetadata: true,
    name: id,
    preserveTimestamps: false,
    resizeMode: 'longEdge',
    resizeValue: 2048,
    stripGps: true,
    watermarkAnchor: 'bottomRight',
    watermarkOpacity: 75,
    watermarkPath: null,
    watermarkScale: 10,
    watermarkSpacing: 5,
  };
}
