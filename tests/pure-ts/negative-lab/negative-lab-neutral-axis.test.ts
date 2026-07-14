import { describe, expect, test } from 'bun:test';

import {
  negativeLabNeutralAxisAnalysisSchema,
  negativeLabNeutralAxisParamsSchema,
} from '../../../src/schemas/negative-lab/negativeLabNeutralAxisSchemas';

const defaults = {
  algorithm_version: 1,
  enabled: true,
  strength: 1,
  low_chroma_quantile: 0.2,
  low_chroma_cap: 0.08,
  min_support: 24,
  confidence_threshold: 0.65,
  allow_global_fallback: false,
  source: 'auto_cast_neutral_axis_v1',
} as const;

describe('Negative Lab confidence-gated neutral-axis cast', () => {
  test('accepts bounded analyzer parameters and rejects unsafe caps', () => {
    expect(negativeLabNeutralAxisParamsSchema.parse(defaults).source).toBe('auto_cast_neutral_axis_v1');
    expect(() => negativeLabNeutralAxisParamsSchema.parse({ ...defaults, low_chroma_cap: 0.5 })).toThrow();
  });

  test('requires explicit fit mode, band support, and fallback status', () => {
    const receipt = negativeLabNeutralAxisAnalysisSchema.parse({
      algorithmId: 'native_negative_lab_neutral_axis_v1',
      algorithmVersion: 1,
      status: 'no_correction_low_confidence',
      fitMode: 'none',
      confidence: 0.2,
      confidenceThreshold: 0.65,
      sampleCount: 6,
      bandSupport: [6, 0, 0],
      bandReferences: [
        [0.4, 0.42, 0.41],
        [0, 0, 0],
        [0, 0, 0],
      ],
      residualBefore: 0.013,
      residualAfter: 0.013,
      effectiveGlobal: [0, 0, 0],
      effectiveShadow: [0, 0, 0],
      effectiveHighlight: [0, 0, 0],
      source: 'auto_cast_neutral_axis_v1',
      warningCodes: ['neutral_axis_confidence_below_threshold'],
    });
    expect(receipt.status).toBe('no_correction_low_confidence');
    expect(receipt.effectiveGlobal).toEqual([0, 0, 0]);
  });
});
