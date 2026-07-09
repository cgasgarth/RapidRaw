import { describe, expect, test } from 'bun:test';

import { negativeLabDensityBoundsReceiptV1Schema } from '../../../packages/rawengine-schema/src/rawEngineSchemas';
import { negativeLabPresetParamsSchema } from '../../../src/schemas/negative-lab/negativeLabPresetCatalogSchemas';
import { buildNegativeLabDustScratchReviewReport } from '../../../src/utils/negative-lab/negativeLabDustScratchReview';
import { buildNegativeLabFrameHealthReport } from '../../../src/utils/negative-lab/negativeLabFrameHealth';

const boundsReceipt = negativeLabDensityBoundsReceiptV1Schema.parse({
  algorithmId: 'fixed_grid_block_median_luma_color_v1',
  analysisBuffer: 0.04,
  analysisRect: { height: 0.92, width: 0.92, x: 0.04, y: 0.04 },
  baseBounds: {
    axisBounds: { color: { max: 0.14, min: -0.12 }, luma: { max: 0.22, min: 0.08 } },
    channelBounds: {
      blue: { max: 0.28, min: 0.12 },
      green: { max: 0.2, min: 0.07 },
      red: { max: 0.18, min: 0.05 },
    },
  },
  baseFogProvenance: 'manual_base_fog_sample',
  colorRangeClip: 0.12,
  finalBounds: {
    axisBounds: { color: { max: 0.18, min: -0.16 }, luma: { max: 1.42, min: 0.12 } },
    channelBounds: {
      blue: { max: 1.58, min: 0.18 },
      green: { max: 1.39, min: 0.1 },
      red: { max: 1.35, min: 0.08 },
    },
  },
  lumaRangeClip: 0.08,
  schemaVersion: 1,
  warningCodes: ['uneven_illumination'],
});

describe('Negative Lab robust density bounds', () => {
  test('migrates legacy flat preset params to versioned defaults', () => {
    const params = negativeLabPresetParamsSchema.parse({
      blue_weight: 1,
      contrast: 1,
      exposure: 0,
      green_weight: 1,
      red_weight: 1,
    });

    expect(params.bounds_schema_version).toBe(1);
    expect(params.base_fog_bounds_provenance).toBe('automatic_analysis');
    expect(params.luma_range_clip).toBe(0.08);
    expect(params.color_range_clip).toBe(0.12);
  });

  test('round-trips separate base and final bounds with explicit provenance', () => {
    expect(boundsReceipt.baseFogProvenance).toBe('manual_base_fog_sample');
    expect(boundsReceipt.baseBounds.channelBounds.blue.min).toBe(0.12);
    expect(boundsReceipt.finalBounds.axisBounds.luma.max).toBe(1.42);
    expect(boundsReceipt.finalBounds).not.toEqual(boundsReceipt.baseBounds);
  });

  test('feeds missing and uneven base-fog evidence into frame health', () => {
    const report = buildNegativeLabFrameHealthReport({
      activePathIndex: 0,
      baseFogConfidence: 0.75,
      boundsReceipt: {
        ...boundsReceipt,
        warningCodes: ['missing_visible_base', 'uneven_illumination'],
      },
      includedPathSet: new Set(['/roll/frame-01.dng']),
      previewReady: true,
      targetPaths: ['/roll/frame-01.dng'],
    });

    expect(report.frames[0]?.warningCodes).toEqual(
      expect.arrayContaining(['bounds_missing_visible_base', 'bounds_uneven_base_fog']),
    );
    expect(report.frames[0]?.warningSeverity).toBe('review');
    expect(buildNegativeLabDustScratchReviewReport(report, true).frames[0]?.findingCodes).toContain(
      'bounds_review_required',
    );
  });
});
