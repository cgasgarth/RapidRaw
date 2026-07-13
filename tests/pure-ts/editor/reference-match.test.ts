import { describe, expect, test } from 'bun:test';

import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import {
  applyReferenceMatchProposal,
  combineReferenceSummaries,
  createReferenceMatchProposal,
  fingerprintReferenceMatchValue,
  type ReferenceHistogramSummary,
  type ReferenceMatchReference,
  summarizeReferenceHistogram,
} from '../../../src/utils/referenceMatch';

const summary = (overrides: Partial<ReferenceHistogramSummary> = {}): ReferenceHistogramSummary => ({
  analysisBasis: 'color-managed-editor-preview',
  blueMean: 0.4,
  greenMean: 0.4,
  lumaMean: 0.4,
  lumaSpread: 0.15,
  redMean: 0.4,
  sampleCount: 8192,
  ...overrides,
});

const reference = (
  id: string,
  weight: number,
  histogramSummary: ReferenceHistogramSummary,
): ReferenceMatchReference => ({
  adjustmentRevision: 4,
  geometryFingerprint: `fnv1a64:${'1'.repeat(16)}`,
  geometryRevision: 2,
  graphFingerprint: `fnv1a64:${'2'.repeat(16)}`,
  id,
  label: `${id}.ARW`,
  path: `/references/${id}.ARW`,
  proofFingerprint: `fnv1a64:${'3'.repeat(16)}`,
  proofRevision: 1,
  renderUrl: `blob:${id}:render`,
  sourceFingerprint: fingerprintReferenceMatchValue(id),
  summary: histogramSummary,
  viewFingerprint: `fnv1a64:${'4'.repeat(16)}`,
  weight,
});

describe('color-managed reference matching', () => {
  test('summarizes real histogram bins and rejects incomplete analysis inputs', () => {
    const bins = (peak: number) => Array.from({ length: 256 }, (_, index) => (index === peak ? 1_000 : 0));
    const result = summarizeReferenceHistogram({
      blue: { data: bins(64) },
      green: { data: bins(128) },
      luma: { data: bins(96) },
      red: { data: bins(192) },
    });

    expect(result).toMatchObject({
      analysisBasis: 'color-managed-editor-preview',
      sampleCount: 1_000,
    });
    expect(result?.redMean).toBeCloseTo(192 / 255, 8);
    expect(result?.blueMean).toBeCloseTo(64 / 255, 8);
    expect(
      summarizeReferenceHistogram({
        blue: { data: [] },
        green: { data: [] },
        luma: { data: [] },
        red: { data: [] },
      }),
    ).toBeNull();
  });

  test('combines multiple references by weight independent of ordering', () => {
    const dark = reference('dark', 1, summary({ lumaMean: 0.2, redMean: 0.3 }));
    const bright = reference('bright', 3, summary({ lumaMean: 0.8, redMean: 0.7 }));
    const first = combineReferenceSummaries([dark, bright]);
    const reversed = combineReferenceSummaries([bright, dark]);

    expect(first).toEqual(reversed);
    expect(first?.lumaMean).toBeCloseTo(0.65, 8);
    expect(first?.redMean).toBeCloseTo(0.6, 8);
  });

  test('keeps Normalize technical and exposes a broader allow-listed Match Look proposal', () => {
    const target = summary({ blueMean: 0.45, greenMean: 0.4, lumaMean: 0.25, lumaSpread: 0.08, redMean: 0.35 });
    const warmReference = reference(
      'warm',
      1,
      summary({ blueMean: 0.3, greenMean: 0.42, lumaMean: 0.5, lumaSpread: 0.18, redMean: 0.62 }),
    );
    const normalize = createReferenceMatchProposal({
      adjustments: INITIAL_ADJUSTMENTS,
      mode: 'normalize',
      references: [warmReference],
      target,
    });
    const match = createReferenceMatchProposal({
      adjustments: INITIAL_ADJUSTMENTS,
      mode: 'match-look',
      references: [warmReference],
      target,
    });

    expect(normalize?.diffs.map((diff) => diff.key)).toEqual(['exposure', 'contrast']);
    expect(match?.diffs.map((diff) => diff.key)).toEqual([
      'exposure',
      'contrast',
      'creativeTemperature',
      'creativeTint',
      'saturation',
      'vibrance',
    ]);
    expect(match?.residualAfter).toBeLessThan(match?.residualBefore ?? 0);
    expect(match?.diffs.find((diff) => diff.key === 'creativeTemperature')?.proposed).toBeGreaterThan(0);
  });

  test('Impact 0 is exact no-op, Impact 100 applies exact diffs, and groups are independently gated', () => {
    const proposal = createReferenceMatchProposal({
      adjustments: INITIAL_ADJUSTMENTS,
      mode: 'match-look',
      references: [reference('look', 1, summary({ lumaMean: 0.7, redMean: 0.7 }))],
      target: summary({ lumaMean: 0.3, redMean: 0.3 }),
    });
    if (!proposal) throw new Error('Expected proposal');

    expect(
      applyReferenceMatchProposal({
        adjustments: INITIAL_ADJUSTMENTS,
        enabledGroups: new Set(['color', 'presence', 'tone']),
        impact: 0,
        proposal,
      }),
    ).toEqual(INITIAL_ADJUSTMENTS);

    const toneOnly = applyReferenceMatchProposal({
      adjustments: INITIAL_ADJUSTMENTS,
      enabledGroups: new Set(['tone']),
      impact: 100,
      proposal,
    });
    expect(toneOnly.exposure).toBe(proposal.diffs.find((diff) => diff.key === 'exposure')?.proposed);
    expect(toneOnly.creativeTemperature).toBe(INITIAL_ADJUSTMENTS.creativeTemperature);
    expect(toneOnly.cameraProfile).toBe(INITIAL_ADJUSTMENTS.cameraProfile);
    expect(toneOnly.crop).toBe(INITIAL_ADJUSTMENTS.crop);
  });
});
