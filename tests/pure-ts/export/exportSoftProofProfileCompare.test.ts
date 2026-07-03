import { describe, expect, test } from 'bun:test';

import { MOXCMS_EXPORT_COLOR_CAPABILITIES_V1 } from '../../../packages/rawengine-schema/src/exportColorCapabilities';
import {
  ExportColorProfile,
  ExportRenderingIntent,
  FileFormats,
} from '../../../src/components/ui/ExportImportProperties';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import {
  buildSoftProofProfileCompareInvokeRequest,
  buildSoftProofProfileCompareRequests,
  buildSoftProofProfileCompareUnavailableState,
  EXPORT_SOFT_PROOF_RESOLVER_PRESET_ID,
  getExportSoftProofResolverStatus,
  upsertExportSoftProofResolverPreset,
} from '../../../src/utils/export/exportSoftProofProfileCompare';

describe('export soft-proof profile compare', () => {
  test('wraps the preview payload under the required request key', () => {
    const [srgbRequest] = buildSoftProofProfileCompareRequests({
      blackPointCompensation: false,
      jsAdjustments: structuredClone(INITIAL_ADJUSTMENTS),
      renderingIntent: ExportRenderingIntent.Perceptual,
      targetResolution: 1024,
    });

    if (!srgbRequest) {
      throw new Error('Expected the compare helper to produce an sRGB request.');
    }

    expect(buildSoftProofProfileCompareInvokeRequest(srgbRequest.request)).toEqual({
      request: srgbRequest.request,
    });
    expect(Object.keys(buildSoftProofProfileCompareInvokeRequest(srgbRequest.request))).toEqual(['request']);
  });

  test('keeps unavailable compare state tied to the requested side settings', () => {
    expect(
      buildSoftProofProfileCompareUnavailableState({
        error: 'soft-proof preview unavailable',
        requestedColorProfile: ExportColorProfile.DisplayP3,
        requestedRenderingIntent: ExportRenderingIntent.RelativeColorimetric,
        side: 'displayP3',
      }),
    ).toEqual({
      error: 'soft-proof preview unavailable',
      requestedColorProfile: ExportColorProfile.DisplayP3,
      requestedRenderingIntent: ExportRenderingIntent.RelativeColorimetric,
      side: 'displayP3',
      status: 'unavailable',
    });
  });

  test('upserts the internal resolver preset without duplicating it', () => {
    const currentSettings = {
      blackPointCompensation: true,
      colorProfile: ExportColorProfile.DisplayP3,
      dontEnlarge: true,
      enableResize: false,
      enableWatermark: false,
      exportMasks: false,
      fileFormat: FileFormats.Jpeg,
      filenameTemplate: '{original_filename}_edited',
      jpegQuality: 90,
      keepMetadata: true,
      outputSharpening: null,
      preserveFolders: false,
      preserveTimestamps: false,
      renderingIntent: ExportRenderingIntent.Perceptual,
      resizeMode: 'longEdge',
      resizeValue: 2048,
      stripGps: true,
      watermarkAnchor: 'bottomRight',
      watermarkOpacity: 75,
      watermarkPath: null,
      watermarkScale: 10,
      watermarkSpacing: 5,
    };

    const first = upsertExportSoftProofResolverPreset({
      currentSettings,
      name: 'Current export settings proof',
      presets: [],
    });
    const second = upsertExportSoftProofResolverPreset({
      currentSettings: { ...currentSettings, colorProfile: ExportColorProfile.Srgb },
      name: 'Current export settings proof',
      presets: first,
    });

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(second[0]?.id).toBe(EXPORT_SOFT_PROOF_RESOLVER_PRESET_ID);
    expect(second[0]?.colorProfile).toBe(ExportColorProfile.Srgb);
  });

  test('gates use-proof action through export color capabilities', () => {
    const status = getExportSoftProofResolverStatus({
      appSettingsAvailable: true,
      catalog: MOXCMS_EXPORT_COLOR_CAPABILITIES_V1,
      currentExportBlackPointCompensation: false,
      currentExportColorProfile: ExportColorProfile.Srgb,
      currentExportRenderingIntent: ExportRenderingIntent.RelativeColorimetric,
      exportSoftProofRecipeId: 'proof-display-p3',
      exportSoftProofTransform: null,
      fileFormat: FileFormats.Png,
      isExportSoftProofEnabled: true,
      proofPreset: {
        blackPointCompensation: false,
        colorProfile: ExportColorProfile.DisplayP3,
        dontEnlarge: true,
        enableResize: false,
        enableWatermark: false,
        fileFormat: FileFormats.Jpeg,
        filenameTemplate: '{original_filename}_edited',
        id: 'proof-display-p3',
        jpegQuality: 90,
        keepMetadata: true,
        name: 'Display P3 proof',
        preserveTimestamps: false,
        renderingIntent: ExportRenderingIntent.RelativeColorimetric,
        resizeMode: 'longEdge',
        resizeValue: 2048,
        stripGps: true,
        watermarkAnchor: 'bottomRight',
        watermarkOpacity: 75,
        watermarkPath: null,
        watermarkScale: 10,
        watermarkSpacing: 5,
      },
    });

    expect(status.parityStatus).toBe('unsupported');
    expect(status.canUseCurrentSoftProofForExport).toBe(false);
    expect(status.unsupportedReason).toBe('unsupported-profile-format');
  });
});
