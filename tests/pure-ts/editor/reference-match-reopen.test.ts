import { expect, test } from 'bun:test';

import { matchLookApplicationReceiptV1Schema } from '../../../packages/rawengine-schema/src/referenceMatchRuntime';
import { INITIAL_ADJUSTMENTS, normalizeLoadedAdjustments } from '../../../src/utils/adjustments';

const receipt = matchLookApplicationReceiptV1Schema.parse({
  appliedDiffs: [{ after: 0.75, before: 0, key: 'exposure' }],
  appliedAt: '2026-07-13T20:00:00.000Z',
  destination: 'global-adjustments',
  effectiveReferences: [
    { role: 'creative', sourceFingerprint: `fnv1a64:${'4'.repeat(16)}`, weight: 0.75 },
    { role: 'creative', sourceFingerprint: `fnv1a64:${'5'.repeat(16)}`, weight: 0.25 },
  ],
  enabledGroups: ['color', 'tone'],
  historyEntriesAdded: 1,
  impact: 75,
  proposalFingerprint: `fnv1a64:${'1'.repeat(16)}`,
  resultingGraphFingerprint: `fnv1a64:${'2'.repeat(16)}`,
  schemaVersion: 1,
  targetAnalysisFingerprint: `fnv1a64:${'3'.repeat(16)}`,
});

test('reference match provenance round-trips through sidecar normalization and corrupt receipts are quarantined', () => {
  const saved = JSON.stringify({
    ...INITIAL_ADJUSTMENTS,
    exposure: 0.75,
    referenceMatchApplicationReceipt: receipt,
  });
  const reopened = normalizeLoadedAdjustments(JSON.parse(saved));
  expect(reopened.exposure).toBe(0.75);
  expect(reopened.referenceMatchApplicationReceipt).toEqual(receipt);
  expect(reopened.referenceMatchApplicationReceipt?.effectiveReferences).toEqual(receipt.effectiveReferences);
  expect(reopened.referenceMatchApplicationReceipt?.appliedDiffs).toEqual(receipt.appliedDiffs);

  const corrupt = normalizeLoadedAdjustments({
    ...INITIAL_ADJUSTMENTS,
    referenceMatchApplicationReceipt: { ...receipt, historyEntriesAdded: 3 },
  });
  expect(corrupt.referenceMatchApplicationReceipt).toBeNull();
  expect(
    normalizeLoadedAdjustments({
      ...INITIAL_ADJUSTMENTS,
      referenceMatchApplicationReceipt: { ...receipt, appliedDiffs: [] },
    }).referenceMatchApplicationReceipt,
  ).toBeNull();
  expect(
    normalizeLoadedAdjustments({
      ...INITIAL_ADJUSTMENTS,
      referenceMatchApplicationReceipt: {
        ...receipt,
        appliedDiffs: [receipt.appliedDiffs[0], receipt.appliedDiffs[0]],
      },
    }).referenceMatchApplicationReceipt,
  ).toBeNull();
  expect(
    normalizeLoadedAdjustments({
      ...INITIAL_ADJUSTMENTS,
      referenceMatchApplicationReceipt: { ...receipt, effectiveReferences: [] },
    }).referenceMatchApplicationReceipt,
  ).toBeNull();
});
