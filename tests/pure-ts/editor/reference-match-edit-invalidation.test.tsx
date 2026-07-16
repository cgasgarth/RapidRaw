import { expect, test } from 'bun:test';
import { act, render } from '@testing-library/react';
import { createElement } from 'react';

import { matchLookApplicationReceiptV1Schema } from '../../../packages/rawengine-schema/src/referenceMatchRuntime';
import { useEditorActions } from '../../../src/hooks/editor/useEditorActions';
import { useEditorStore } from '../../../src/store/useEditorStore';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { legacyAdjustmentsToEditDocumentV2 } from '../../../src/utils/editDocumentV2';

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

test('manual fitted-node edit clears the receipt and undo/redo restores exact provenance states', () => {
  const applied = {
    ...structuredClone(INITIAL_ADJUSTMENTS),
    exposure: 0.75,
    referenceMatchApplicationReceipt: receipt,
  };
  const editDocumentV2 = legacyAdjustmentsToEditDocumentV2(applied);
  useEditorStore.getState().hydrateEditorRenderAuthority({
    historyIndex: 0,
    selectedImage: null,
    editDocumentV2,
    history: [editDocumentV2],
  });
  let setAdjustments: ReturnType<typeof useEditorActions>['setAdjustments'] | null = null;
  const Harness = () => {
    setAdjustments = useEditorActions().setAdjustments;
    return null;
  };
  render(createElement(Harness));

  act(() => setAdjustments?.({ exposure: 1 }));
  expect(useEditorStore.getState().adjustmentSnapshot.value.referenceMatchApplicationReceipt).toBeNull();
  expect(useEditorStore.getState().historyIndex).toBe(1);
  act(() => useEditorStore.getState().undo());
  expect(useEditorStore.getState().adjustmentSnapshot.value.referenceMatchApplicationReceipt).toEqual(receipt);
  act(() => useEditorStore.getState().redo());
  expect(useEditorStore.getState().adjustmentSnapshot.value.referenceMatchApplicationReceipt).toBeNull();
});
