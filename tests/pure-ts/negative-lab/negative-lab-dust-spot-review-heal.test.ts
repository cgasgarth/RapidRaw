import { describe, expect, test } from 'bun:test';
import {
  buildNegativeLabDustScratchReviewReport,
  type NegativeLabNativeDustCandidate,
} from '../../../src/utils/negative-lab/negativeLabDustScratchReview';
import { buildNegativeLabFrameHealthReport } from '../../../src/utils/negative-lab/negativeLabFrameHealth';

describe('Negative Lab native dust candidate review', () => {
  test('uses native image-grounded candidates instead of fixed placeholder geometry', () => {
    const frameHealth = buildNegativeLabFrameHealthReport({
      activePathIndex: 0,
      baseFogConfidence: 0.9,
      includedPathSet: new Set(['/roll/frame-01.jpg']),
      previewReady: true,
      targetPaths: ['/roll/frame-01.jpg'],
    });
    const nativeCandidate: NegativeLabNativeDustCandidate = {
      candidateId: 'negative_lab_dust_412_188',
      confidence: 0.93,
      detectorVersion: 'negative_lab_dust_spot_v1',
      geometry: {
        coordinateSpace: 'normalized_frame',
        height: 0.01,
        kind: 'rect',
        width: 0.01,
        x: 0.63,
        y: 0.41,
      },
      polarity: 'light',
      status: 'pending',
      supportCount: 47,
      warningCodes: [],
    };

    const report = buildNegativeLabDustScratchReviewReport(
      frameHealth,
      true,
      {},
      {
        'negative-lab-frame-1': [nativeCandidate],
      },
    );
    const candidate = report.frames[0]?.candidates[0];

    expect(candidate?.candidateId).toBe(nativeCandidate.candidateId);
    expect(candidate?.confidence).toBe(0.93);
    expect(candidate?.geometry.x).toBe(0.63);
    expect(candidate?.geometry.width).toBe(0.01);
    expect(candidate?.detectorVersion).toBe('negative_lab_dust_spot_v1');
    expect(candidate?.supportCount).toBe(47);
  });

  test('does not invent a candidate when native analysis returns a clean field', () => {
    const frameHealth = buildNegativeLabFrameHealthReport({
      activePathIndex: 0,
      baseFogConfidence: 0.9,
      includedPathSet: new Set(['/roll/frame-01.jpg']),
      previewReady: true,
      targetPaths: ['/roll/frame-01.jpg'],
    });

    const report = buildNegativeLabDustScratchReviewReport(
      frameHealth,
      true,
      {},
      {
        'negative-lab-frame-1': [],
      },
    );

    expect(report.frames[0]?.candidates).toEqual([]);
  });
});
