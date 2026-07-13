import { afterEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { matchLookApplicationReceiptV1Schema } from '../../../packages/rawengine-schema/src/referenceMatchRuntime';
import { useEditorActions } from '../../../src/hooks/editor/useEditorActions';
import { useEditorStore } from '../../../src/store/useEditorStore';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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

let root: Root | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
});

test('manual fitted-node edit clears the receipt and undo/redo restores exact provenance states', () => {
  installDom();
  const applied = {
    ...structuredClone(INITIAL_ADJUSTMENTS),
    exposure: 0.75,
    referenceMatchApplicationReceipt: receipt,
  };
  useEditorStore.setState({ adjustments: applied, history: [applied], historyIndex: 0, selectedImage: null });
  let setAdjustments: ReturnType<typeof useEditorActions>['setAdjustments'] | null = null;
  const Harness = () => {
    setAdjustments = useEditorActions().setAdjustments;
    return null;
  };
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(createElement(Harness)));

  act(() => setAdjustments?.({ exposure: 1 }));
  expect(useEditorStore.getState().adjustments.referenceMatchApplicationReceipt).toBeNull();
  expect(useEditorStore.getState().historyIndex).toBe(1);
  act(() => useEditorStore.getState().undo());
  expect(useEditorStore.getState().adjustments.referenceMatchApplicationReceipt).toBe(receipt);
  act(() => useEditorStore.getState().redo());
  expect(useEditorStore.getState().adjustments.referenceMatchApplicationReceipt).toBeNull();
});

function installDom() {
  const window = new Window({ url: 'http://localhost/reference-match-edit-invalidation' });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: window.document });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: window.navigator });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: window.HTMLElement });
}
