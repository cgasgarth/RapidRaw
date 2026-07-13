import { describe, expect, test } from 'bun:test';

import { matchLookApplicationReceiptV1Schema } from '../../../packages/rawengine-schema/src/referenceMatchRuntime';
import {
  COPYABLE_ADJUSTMENT_KEYS,
  INITIAL_ADJUSTMENTS,
  normalizeLoadedAdjustments,
  pickAdjustmentValues,
} from '../../../src/utils/adjustments';
import { acceptReferenceMatchAdjustmentTransfer } from '../../../src/utils/referenceMatchTransfer';

const fingerprint = (digit: string): `fnv1a64:${string}` => `fnv1a64:${digit.repeat(16)}`;

const receipt = matchLookApplicationReceiptV1Schema.parse({
  appliedAt: '2026-07-13T23:00:00.000Z',
  baseGraphFingerprint: fingerprint('0'),
  destination: 'global-adjustments',
  effectiveReferences: [{ role: 'creative', sourceFingerprint: fingerprint('4'), weight: 1 }],
  enabledGroups: ['tone'],
  historyEntriesAdded: 1,
  impact: 75,
  proposalFingerprint: fingerprint('1'),
  resultingGraphFingerprint: fingerprint('2'),
  schemaVersion: 1,
  targetAnalysisFingerprint: fingerprint('3'),
});

describe('reference-match copy and batch acceptance', () => {
  test.each([
    'copy-paste',
    'batch-sync',
  ] as const)('%s clears a stale application receipt when it transfers a fitted node', (transferMode) => {
    const acceptance = acceptReferenceMatchAdjustmentTransfer({
      adjustments: { exposure: 1.25, sharpness: 42 },
      transferMode,
    });
    expect(acceptance).toEqual({
      adjustments: { exposure: 1.25, referenceMatchApplicationReceipt: null, sharpness: 42 },
      affectedNodeKeys: ['exposure'],
      provenanceDisposition: 'cleared-stale-receipt',
      transferMode,
    });

    const reopened = normalizeLoadedAdjustments(
      JSON.parse(
        JSON.stringify({
          ...INITIAL_ADJUSTMENTS,
          referenceMatchApplicationReceipt: receipt,
          ...acceptance.adjustments,
        }),
      ),
    );
    expect(reopened.exposure).toBe(1.25);
    expect(reopened.referenceMatchApplicationReceipt).toBeNull();
  });

  test('unrelated transfer preserves target-owned provenance and never copies a source receipt', () => {
    const copied = pickAdjustmentValues(COPYABLE_ADJUSTMENT_KEYS, {
      ...INITIAL_ADJUSTMENTS,
      referenceMatchApplicationReceipt: receipt,
    });
    expect(Object.hasOwn(copied, 'referenceMatchApplicationReceipt')).toBe(false);
    const acceptance = acceptReferenceMatchAdjustmentTransfer({
      adjustments: { sharpness: 25 },
      transferMode: 'copy-paste',
    });
    expect(acceptance.provenanceDisposition).toBe('preserved');
    expect(acceptance.adjustments).toEqual({ sharpness: 25 });
    expect(Object.hasOwn(acceptance.adjustments, 'referenceMatchApplicationReceipt')).toBe(false);
  });
});
