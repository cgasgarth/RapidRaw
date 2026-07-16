import { expect, test } from 'bun:test';
import { act, render } from '@testing-library/react';
import { createElement } from 'react';

import { matchLookApplicationReceiptV1Schema } from '../../../packages/rawengine-schema/src/referenceMatchRuntime';
import { useEditorActions } from '../../../src/hooks/editor/useEditorActions';
import { useEditorStore } from '../../../src/store/useEditorStore';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { createDefaultEditDocumentV2, patchEditDocumentV2Node } from '../../../src/utils/editDocumentV2';

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
  const edited = patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'scene_global_color_tone', {
    exposure: applied.exposure,
  });
  const editDocumentV2 = { ...edited, provenance: { referenceMatchApplicationReceipt: receipt } };
  useEditorStore.getState().hydrateEditorRenderAuthority({
    historyIndex: 0,
    selectedImage: null,
    editDocumentV2,
    history: [editDocumentV2],
  });
  let commitEditNodeOperations: ReturnType<typeof useEditorActions>['commitEditNodeOperations'] | null = null;
  const Harness = () => {
    commitEditNodeOperations = useEditorActions().commitEditNodeOperations;
    return null;
  };
  render(createElement(Harness));

  act(() =>
    commitEditNodeOperations?.([
      { nodeType: 'scene_global_color_tone', patch: { exposure: 1 }, type: 'patch-edit-document-node' },
      { receipt: null, type: 'set-reference-match-application-receipt' },
    ]),
  );
  expect(useEditorStore.getState().editDocumentV2.provenance.referenceMatchApplicationReceipt).toBeNull();
  expect(useEditorStore.getState().historyIndex).toBe(1);
  act(() => useEditorStore.getState().undo());
  expect(useEditorStore.getState().editDocumentV2.provenance.referenceMatchApplicationReceipt).toEqual(receipt);
  act(() => useEditorStore.getState().redo());
  expect(useEditorStore.getState().editDocumentV2.provenance.referenceMatchApplicationReceipt).toBeNull();
});
