import { afterEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import ReferenceMatchPanel from '../../../src/components/adjustments/ReferenceMatchPanel.tsx';
import type { SelectedImage } from '../../../src/components/ui/AppProperties.tsx';
import { useEditorStore } from '../../../src/store/useEditorStore.ts';
import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots.ts';
import { ActiveChannel, INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments.ts';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let rendered: { container: HTMLDivElement; root: Root } | null = null;

afterEach(() => {
  if (rendered) {
    act(() => rendered?.root.unmount());
    rendered.container.remove();
    rendered = null;
  }
});

const image = (path: string): SelectedImage => ({
  height: 4000,
  isRaw: true,
  isReady: true,
  originalUrl: `blob:${path}:original`,
  path,
  thumbnailUrl: `blob:${path}:thumbnail`,
  width: 6000,
});

const histogram = (luma: number, red: number, green: number, blue: number) => {
  const bins = (peak: number) => Array.from({ length: 256 }, (_, index) => (index === peak ? 8_192 : 0));
  return {
    [ActiveChannel.Blue]: { color: 'blue', data: bins(blue) },
    [ActiveChannel.Green]: { color: 'green', data: bins(green) },
    [ActiveChannel.Luma]: { color: 'white', data: bins(luma) },
    [ActiveChannel.Red]: { color: 'red', data: bins(red) },
  };
};

test('reference tray survives navigation, proposal inspection is non-mutating, and Apply is one history entry', async () => {
  installDom();
  const initial = structuredClone(INITIAL_ADJUSTMENTS);
  useEditorStore.setState({
    adjustmentSnapshot: publishAdjustmentSnapshot(null, initial),
    adjustments: initial,
    histogram: histogram(180, 200, 170, 120),
    history: [initial],
    historyIndex: 0,
    lastReferenceMatchApplicationReceipt: null,
    proofRevision: 3,
    referenceMatchReferences: [],
    selectedImage: image('/photos/reference.ARW'),
  });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  rendered = { container, root };

  await act(async () => {
    root.render(createElement(ReferenceMatchPanel));
    await flushPromises();
  });
  await click(container, '[data-testid="reference-match-capture"]');
  expect(useEditorStore.getState().referenceMatchReferences).toHaveLength(1);

  await act(async () => {
    useEditorStore.getState().setEditor({
      histogram: histogram(80, 90, 100, 120),
      selectedImage: image('/photos/target.ARW'),
    });
    await flushPromises();
  });
  expect(container.querySelector('[data-reference-path="/photos/reference.ARW"]')).not.toBeNull();

  await click(container, '[data-testid="reference-match-compare"]');
  expect(useEditorStore.getState().compare).toMatchObject({
    mode: 'side-by-side',
    source: { kind: 'reference', label: 'reference.ARW' },
  });

  const historyBeforeProposal = useEditorStore.getState().historyIndex;
  await click(container, '[data-testid="reference-match-propose"]');
  expect(container.querySelector('[data-testid="reference-match-proposal"]')?.textContent).toContain(
    'Creative look proposal',
  );
  expect(container.querySelector('[data-testid="reference-match-proposal"]')?.textContent).toContain(
    'creativeTemperature',
  );
  expect(useEditorStore.getState().historyIndex).toBe(historyBeforeProposal);

  await click(container, '[data-testid="reference-match-apply"]');
  expect(useEditorStore.getState().historyIndex).toBe(historyBeforeProposal + 1);
  expect(useEditorStore.getState().lastReferenceMatchApplicationReceipt).toMatchObject({
    destination: 'global-adjustments',
    historyEntriesAdded: 1,
    impact: 100,
  });
  expect(useEditorStore.getState().adjustments.exposure).not.toBe(INITIAL_ADJUSTMENTS.exposure);
  expect(useEditorStore.getState().adjustments.cameraProfile).toBe(INITIAL_ADJUSTMENTS.cameraProfile);
});

async function click(container: Element, selector: string) {
  const element = container.querySelector<HTMLButtonElement>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  await act(async () => {
    element.click();
    await flushPromises();
  });
}

function installDom() {
  const window = new Window({ url: 'http://localhost/reference-match-test' });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: window.document });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: window.navigator });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: window.HTMLElement });
}

async function flushPromises() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
