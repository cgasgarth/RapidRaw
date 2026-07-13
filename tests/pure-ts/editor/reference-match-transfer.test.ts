import { describe, expect, test } from 'bun:test';

import { matchLookApplicationReceiptV1Schema } from '../../../packages/rawengine-schema/src/referenceMatchRuntime';
import {
  COPYABLE_ADJUSTMENT_KEYS,
  INITIAL_ADJUSTMENTS,
  INITIAL_MASK_ADJUSTMENTS,
  type MaskContainer,
  normalizeLoadedAdjustments,
  pickAdjustmentValues,
} from '../../../src/utils/adjustments';
import {
  acceptReferenceMatchAdjustmentTransfer,
  buildReceiptSafePresetApplication,
  reconcileReferenceMatchReceiptsAfterEdit,
} from '../../../src/utils/referenceMatchTransfer';

const fingerprint = (digit: string): `fnv1a64:${string}` => `fnv1a64:${digit.repeat(16)}`;

const receipt = matchLookApplicationReceiptV1Schema.parse({
  appliedDiffs: [{ after: 0.75, before: 0, key: 'exposure' }],
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

  test('later fitted-node edits invalidate global provenance while unrelated edits and exact no-ops preserve it', () => {
    const applied = { ...INITIAL_ADJUSTMENTS, exposure: 0.75, referenceMatchApplicationReceipt: receipt };
    expect(reconcileReferenceMatchReceiptsAfterEdit(applied, { ...applied, sharpness: 25 })).toMatchObject({
      referenceMatchApplicationReceipt: receipt,
      sharpness: 25,
    });
    expect(reconcileReferenceMatchReceiptsAfterEdit(applied, { ...applied }).referenceMatchApplicationReceipt).toBe(
      receipt,
    );
    const edited = reconcileReferenceMatchReceiptsAfterEdit(applied, { ...applied, exposure: 1 });
    expect(edited.exposure).toBe(1);
    expect(edited.referenceMatchApplicationReceipt).toBeNull();
  });

  test('later fitted-node or opacity edits invalidate layer provenance without disturbing other layers', () => {
    const layer: MaskContainer = {
      adjustments: { ...INITIAL_MASK_ADJUSTMENTS, exposure: 0.75 },
      blendMode: 'normal' as const,
      id: 'reference-layer',
      invert: false,
      name: 'Reference Match',
      opacity: 100,
      referenceMatchApplicationReceipt: {
        ...receipt,
        destination: 'adjustment-layer' as const,
        layerId: 'reference-layer',
      },
      subMasks: [],
      visible: true,
    };
    const { referenceMatchApplicationReceipt: _receipt, ...unrelatedLayerFields } = layer;
    const unrelatedLayer: MaskContainer = { ...unrelatedLayerFields, id: 'other-layer', name: 'Other' };
    const applied = { ...INITIAL_ADJUSTMENTS, masks: [layer, unrelatedLayer] };
    const opacityEdited = reconcileReferenceMatchReceiptsAfterEdit(applied, {
      ...applied,
      masks: [{ ...layer, opacity: 80 }, unrelatedLayer],
    });
    expect(opacityEdited.masks[0]?.referenceMatchApplicationReceipt).toBeUndefined();
    expect(opacityEdited.masks[1]).toBe(unrelatedLayer);
    const nodeEdited = reconcileReferenceMatchReceiptsAfterEdit(applied, {
      ...applied,
      masks: [{ ...layer, adjustments: { ...layer.adjustments, exposure: 1 } }, unrelatedLayer],
    });
    expect(nodeEdited.masks[0]?.referenceMatchApplicationReceipt).toBeUndefined();
  });

  test('preset application records reconciled provenance while unrelated presets preserve it', () => {
    const before = { ...INITIAL_ADJUSTMENTS, exposure: 0.75, referenceMatchApplicationReceipt: receipt };
    expect(buildReceiptSafePresetApplication(before, { exposure: 1, sharpness: 25 })).toMatchObject({
      exposure: 1,
      referenceMatchApplicationReceipt: null,
      sharpness: 25,
    });
    expect(buildReceiptSafePresetApplication(before, { sharpness: 25 }).referenceMatchApplicationReceipt).toBe(receipt);
    expect(structuredClone(before)).toEqual(before);
  });
});
