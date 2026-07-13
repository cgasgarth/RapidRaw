import { describe, expect, test } from 'bun:test';

import {
  matchLookApplicationReceiptV1Schema,
  matchLookProposalV1Schema,
  referenceDistributionSummaryV1Schema,
  referenceSourceSetV1Schema,
} from '../../../packages/rawengine-schema/src/referenceMatchRuntime';

const fingerprint = (value: string) => `fnv1a64:${value.repeat(16).slice(0, 16)}`;

describe('reference match runtime contracts', () => {
  test('accepts exact, privacy-safe source identity and proposal provenance', () => {
    const source = {
      geometryFingerprint: fingerprint('1'),
      graphFingerprint: fingerprint('2'),
      proofFingerprint: fingerprint('3'),
      role: 'creative' as const,
      sourceFingerprint: fingerprint('4'),
      sourceRevision: `source-revision-v1:${'4'.repeat(64)}`,
      viewFingerprint: fingerprint('5'),
      weight: 1,
    };
    expect(
      referenceSourceSetV1Schema.parse({ normalization: 'sum-to-one', references: [source], schemaVersion: 1 }),
    ).toBeDefined();
    const proposal = matchLookProposalV1Schema.parse({
      confidence: 0.9,
      diffs: [{ current: 0, group: 'tone', key: 'exposure', proposed: 0.5 }],
      effectiveReferences: [{ role: 'creative', sourceFingerprint: source.sourceFingerprint, weight: 1 }],
      mode: 'match-look',
      processVersion: 'rapidraw-reference-match-v1',
      proposalFingerprint: fingerprint('6'),
      residualAfter: 0.1,
      residualBefore: 0.5,
      schemaVersion: 1,
      targetAnalysisFingerprint: fingerprint('7'),
      warnings: [],
    });
    expect(
      matchLookApplicationReceiptV1Schema.parse({
        appliedAt: '2026-07-13T19:00:00.000Z',
        baseGraphFingerprint: fingerprint('0'),
        destination: 'global-adjustments',
        enabledGroups: ['tone'],
        historyEntriesAdded: 1,
        impact: 80,
        proposalFingerprint: proposal.proposalFingerprint,
        resultingGraphFingerprint: fingerprint('8'),
        schemaVersion: 1,
        targetAnalysisFingerprint: proposal.targetAnalysisFingerprint,
      }),
    ).toBeDefined();
  });

  test('rejects duplicate references, creative Normalize nodes, and dishonest residuals', () => {
    const source = {
      geometryFingerprint: fingerprint('1'),
      graphFingerprint: fingerprint('2'),
      proofFingerprint: fingerprint('3'),
      role: 'technical' as const,
      sourceFingerprint: fingerprint('4'),
      sourceRevision: `source-revision-v1:${'4'.repeat(64)}`,
      viewFingerprint: fingerprint('5'),
      weight: 1,
    };
    expect(
      referenceSourceSetV1Schema.safeParse({
        normalization: 'sum-to-one',
        references: [source, source],
        schemaVersion: 1,
      }).success,
    ).toBe(false);
    expect(
      matchLookProposalV1Schema.safeParse({
        confidence: 0.8,
        diffs: [{ current: 0, group: 'color', key: 'creativeTint', proposed: 10 }],
        effectiveReferences: [{ role: 'technical', sourceFingerprint: source.sourceFingerprint, weight: 1 }],
        mode: 'normalize',
        processVersion: 'rapidraw-reference-match-v1',
        proposalFingerprint: fingerprint('6'),
        residualAfter: 1,
        residualBefore: 0.5,
        schemaVersion: 1,
        targetAnalysisFingerprint: fingerprint('7'),
        warnings: [],
      }).success,
    ).toBe(false);
  });

  test('requires destination-specific layer provenance', () => {
    const baseReceipt = {
      appliedAt: '2026-07-13T19:00:00.000Z',
      baseGraphFingerprint: fingerprint('0'),
      enabledGroups: ['tone'],
      historyEntriesAdded: 1,
      impact: 50,
      proposalFingerprint: fingerprint('6'),
      resultingGraphFingerprint: fingerprint('8'),
      schemaVersion: 1,
      targetAnalysisFingerprint: fingerprint('7'),
    } as const;
    expect(
      matchLookApplicationReceiptV1Schema.safeParse({ ...baseReceipt, destination: 'adjustment-layer' }).success,
    ).toBe(false);
    expect(
      matchLookApplicationReceiptV1Schema.safeParse({
        ...baseReceipt,
        destination: 'adjustment-layer',
        layerId: 'reference-layer',
      }).success,
    ).toBe(true);
    expect(
      matchLookApplicationReceiptV1Schema.safeParse({
        ...baseReceipt,
        destination: 'global-adjustments',
        layerId: 'reference-layer',
      }).success,
    ).toBe(false);
  });

  test('bounds privacy-safe coarse spatial analysis summaries', () => {
    expect(
      referenceDistributionSummaryV1Schema.parse({
        analysisBasis: 'color-managed-editor-preview',
        blueMean: 0.3,
        clippedFraction: 0,
        greenMean: 0.4,
        lumaMean: 0.45,
        lumaSpread: 0.1,
        redMean: 0.5,
        sampleCount: 1024,
        spatialTiles: [
          {
            blueMean: 0.3,
            clippedFraction: 0,
            greenMean: 0.4,
            lumaMean: 0.45,
            lumaSpread: 0.1,
            redMean: 0.5,
            sampleCount: 64,
            x: 0,
            y: 0,
          },
        ],
      }).spatialTiles,
    ).toHaveLength(1);
  });
});
