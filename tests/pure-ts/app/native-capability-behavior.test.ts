import { describe, expect, test } from 'bun:test';
import {
  capabilityUnavailableSchema,
  nativeCapabilityManifestSchema,
} from '../../../src/schemas/nativeCapabilitySchemas';
import { ExportFileFormatId, isExportFormatAvailable } from '../../../src/utils/export/exportFormatIds';

describe('native capability behavior', () => {
  test('parses exact fast-dev and full manifests', () => {
    expect(
      nativeCapabilityManifestSchema.parse({
        schemaVersion: 1,
        buildProfile: 'fast_dev',
        ai: false,
        advancedCodecs: false,
        computational: true,
      }),
    ).toEqual({
      schemaVersion: 1,
      buildProfile: 'fast_dev',
      ai: false,
      advancedCodecs: false,
      computational: true,
    });
    expect(() =>
      nativeCapabilityManifestSchema.parse({
        schemaVersion: 1,
        buildProfile: 'full',
        ai: true,
        advancedCodecs: true,
        computational: true,
        unknownCapability: true,
      }),
    ).toThrow();
  });

  test('gates advanced export formats without hiding basic export', () => {
    expect(isExportFormatAvailable(ExportFileFormatId.Jpeg, false)).toBeTrue();
    expect(isExportFormatAvailable(ExportFileFormatId.Png, false)).toBeTrue();
    expect(isExportFormatAvailable(ExportFileFormatId.Tiff, false)).toBeTrue();
    expect(isExportFormatAvailable(ExportFileFormatId.Jxl, false)).toBeFalse();
    expect(isExportFormatAvailable(ExportFileFormatId.Webp, false)).toBeFalse();
    expect(isExportFormatAvailable(ExportFileFormatId.Jxl, true)).toBeTrue();
    expect(isExportFormatAvailable(ExportFileFormatId.Webp, true)).toBeTrue();
  });

  test('recognizes stable backend capability errors', () => {
    expect(capabilityUnavailableSchema.parse({ code: 'capability_unavailable', capability: 'ai' })).toEqual({
      code: 'capability_unavailable',
      capability: 'ai',
    });
    expect(() => capabilityUnavailableSchema.parse({ code: 'unavailable', capability: 'ai' })).toThrow();
  });
});
