import { describe, expect, test } from 'bun:test';

import {
  type NegativeLabConversionPlanResult,
  negativeLabPositiveOutputReceiptSchema,
} from '../../../src/schemas/negative-lab/negativeLabAppServerSchemas.ts';
import { negativeLabSavedPositiveHandoffSchema } from '../../../src/schemas/negative-lab/negativeLabPresetCatalogSchemas.ts';
import {
  buildNegativeLabPositiveOutputReceipts,
  type NegativeLabPositiveVariant,
} from '../../../src/utils/negative-lab/negativeLabExportHandoff.ts';
import {
  buildNegativeLabBatchDryRunSummary,
  buildNegativeLabFrameHealthReport,
} from '../../../src/utils/negative-lab/negativeLabFrameHealth.ts';
import {
  buildNegativeLabAcceptedApplyPlanFingerprint,
  buildNegativeLabAcceptedPlanIdentity,
} from '../../../src/utils/negative-lab/negativeLabPlanIdentity.ts';
import { DEFAULT_NEGATIVE_LAB_UI_PRESET } from '../../../src/utils/negative-lab/negativeLabPresetCatalog.ts';
import { buildNegativeLabReopenedSavedPositiveHandoff } from '../../../src/utils/negative-lab/negativeLabSavedPositiveReopen.ts';

const sourcePaths = ['/proof-roll/negative-lab/frame_001.CR3', '/proof-roll/negative-lab/frame_002.jpg'];

const buildFixture = (outputFormat: 'jpeg_proof' | 'tiff16') => {
  const frameHealthReport = buildNegativeLabFrameHealthReport({
    activePathIndex: 0,
    baseFogConfidence: 0.94,
    cropStatusByFrameId: {},
    includedPathSet: new Set(sourcePaths),
    previewReady: true,
    targetPaths: sourcePaths,
  });
  const dryRunSummary = buildNegativeLabBatchDryRunSummary(frameHealthReport);
  const acceptedPlanIdentity = buildNegativeLabAcceptedPlanIdentity(
    buildNegativeLabAcceptedApplyPlanFingerprint({
      dryRunPlanJson: JSON.stringify({ dryRunSummary }),
      outputFormat,
      params: DEFAULT_NEGATIVE_LAB_UI_PRESET.params,
      pathsToConvert: sourcePaths,
      selectedProfileSnapshot: null,
      sessionRevision: 0,
      suffix: 'Positive',
      writeConversionBundle: true,
    }),
  );
  const conversionPlan = {
    outputFormat,
    params: DEFAULT_NEGATIVE_LAB_UI_PRESET.params,
    profileProvenanceHash: 'fnv1a32:abcdef12',
    suffix: 'Positive',
  } as NegativeLabConversionPlanResult;
  const positiveVariants: NegativeLabPositiveVariant[] = dryRunSummary.frameHealthReport.frames.map((frame, index) => ({
    frameId: frame.frameId,
    operationId: `op_negative_lab_output_${index + 1}`,
    outputArtifact: {
      artifactId: `artifact_negative_lab_positive_${index + 1}`,
      contentHash: `sha256:${String(index + 1).repeat(64)}`,
      dimensions: { height: 1200 + index, width: 1800 + index },
      kind: 'preview',
      storage: 'temp_cache',
    },
    outputIntent: 'editable_positive',
    sourceContentHash: `fnv1a64:${String(index + 1).repeat(16)}`,
    sourcePath: frame.sourcePath,
    warnings: [],
  }));

  return { acceptedPlanIdentity, conversionPlan, dryRunSummary, positiveVariants };
};

describe('negative lab export handoff', () => {
  test.each([
    ['jpeg_proof', '.jpg'],
    ['tiff16', '.tif'],
  ] as const)('builds non-overwriting %s positive output receipts with sidecar and bundle paths', (outputFormat, extension) => {
    const fixture = buildFixture(outputFormat);
    const result = buildNegativeLabPositiveOutputReceipts(fixture);

    expect(result.rejectedFrames).toEqual([]);
    expect(result.exportedPositives).toHaveLength(sourcePaths.length);

    for (const receipt of result.exportedPositives) {
      expect(negativeLabPositiveOutputReceiptSchema.parse(receipt)).toEqual(receipt);
      expect(receipt.outputFormat).toBe(outputFormat);
      expect(receipt.outputFileName).toEndWith(`-Positive${extension}`);
      expect(receipt.outputPath).toEndWith(`-Positive${extension}`);
      expect(receipt.outputPath).not.toBe(receipt.sourcePath);
      expect(receipt.outputFileName).not.toBe(receipt.sourcePath.split(/[\\/]/u).at(-1));
      expect(receipt.sidecarPath).toBe(`${receipt.outputPath}.rawengine-negative-lab.json`);
      expect(receipt.conversionBundlePath).toBe(`${receipt.outputPath}.negative-lab-bundle.json`);
      expect(receipt.provenanceEntryIds).toContain(
        `prov_${fixture.acceptedPlanIdentity.acceptedDryRunPlanId}_${receipt.frameId}`,
      );
      expect(receipt.acceptedDryRunPlanHash).toBe(fixture.acceptedPlanIdentity.acceptedDryRunPlanHash);
      expect(receipt.profileProvenanceHash).toBe(fixture.conversionPlan.profileProvenanceHash);
    }
  });

  test('rejects unsupported output format before building positive receipts', () => {
    const fixture = buildFixture('jpeg_proof');
    const result = buildNegativeLabPositiveOutputReceipts({
      ...fixture,
      conversionPlan: {
        ...fixture.conversionPlan,
        outputFormat: 'png_preview',
      },
    });

    expect(result.exportedPositives).toEqual([]);
    expect(result.rejectedFrames.map((frame) => frame.reason)).toEqual([
      'unsupported_output_format',
      'unsupported_output_format',
    ]);
  });

  test('keeps source-overwrite guard behavior schema-enforced for persisted receipts', () => {
    const fixture = buildFixture('tiff16');
    const receipt = buildNegativeLabPositiveOutputReceipts(fixture).exportedPositives[0];

    expect(() =>
      negativeLabPositiveOutputReceiptSchema.parse({
        ...receipt,
        outputFileName: receipt.sourcePath.split(/[\\/]/u).at(-1),
        outputPath: receipt.sourcePath,
      }),
    ).toThrow('Negative Lab positive output receipt must not overwrite the source negative.');
  });

  test('hydrates saved positive reopen handoff with persisted conversion bundle path', () => {
    const handoff = buildNegativeLabReopenedSavedPositiveHandoff({
      imagePath: '/proof-roll/negative-lab/frame_001-Positive.jpg',
      metadata: {
        rawEngineArtifacts: {
          negativeLabArtifacts: [
            {
              artifactId: 'artifact_negative_lab_reopen_001',
              conversion: {
                conversionBundlePath: '/proof-roll/negative-lab/frame_001-Positive.jpg.conversion-bundle.json',
                frameExposureOverrides: { overrides: [], schemaVersion: 1 },
                frameRgbBalanceOverrides: { overrides: [], schemaVersion: 1 },
                outputFormat: 'jpeg_proof',
                profileProvenanceHash: 'fnv1a32:abcdef12',
                selectedAcquisitionProfile: { id: 'camera_raw_linear_v1' },
                selectedProfile: null,
              },
              outputArtifacts: [
                {
                  artifactId: 'artifact_negative_lab_reopen_001_output',
                  contentHash: 'fnv1a64:0123456789abcdef',
                  dimensions: { height: 1200, width: 1800 },
                  outputIntent: 'editable_positive',
                  path: '/proof-roll/negative-lab/frame_001-Positive.jpg',
                  positiveVariantId: 'positive_variant_reopen_001',
                },
              ],
              replay: { identityHash: 'fnv1a32:2f4a91bc' },
              sidecarPath: '/proof-roll/negative-lab/frame_001-Positive.jpg.rrdata',
              sourceImageRefs: [{ imagePath: sourcePaths[0] }],
            },
          ],
          schemaVersion: 1,
        },
      },
    });

    expect(handoff).not.toBeNull();
    expect(negativeLabSavedPositiveHandoffSchema.parse(handoff)).toEqual(handoff);
    expect(handoff?.conversionBundlePath).toBe(
      '/proof-roll/negative-lab/frame_001-Positive.jpg.conversion-bundle.json',
    );
    expect(handoff?.sourcePath).toBe(sourcePaths[0]);
    expect(handoff?.path).toBe('/proof-roll/negative-lab/frame_001-Positive.jpg');
  });
});
