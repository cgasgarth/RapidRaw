import { afterEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import i18next from 'i18next';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import ReferenceMatchPanel from '../../../src/components/adjustments/ReferenceMatchPanel.tsx';
import type { SelectedImage } from '../../../src/components/ui/AppProperties.tsx';
import en from '../../../src/i18n/locales/en.json';
import { useEditorStore } from '../../../src/store/useEditorStore.ts';
import { useLibraryStore } from '../../../src/store/useLibraryStore.ts';
import { useUIStore } from '../../../src/store/useUIStore.ts';
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
    finalPreviewUrl: null,
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
  const i18n = i18next.createInstance();
  await i18n.use(initReactI18next).init({
    interpolation: { escapeValue: false },
    lng: 'en',
    react: { useSuspense: false },
    resources: { en: { translation: en } },
  });

  await act(async () => {
    root.render(createElement(I18nextProvider, { i18n }, createElement(ReferenceMatchPanel)));
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
  expect(container.querySelector('[data-testid="reference-match-thumbnail"]')?.getAttribute('src')).toBe(
    'blob:/photos/reference.ARW:original',
  );
  expect(container.querySelector('[data-testid="reference-match-thumbnail"]')?.getAttribute('alt')).toContain(
    'reference.ARW',
  );
  await changeSelect(container, '[data-testid="reference-match-role"]', 'technical');
  expect(useEditorStore.getState().referenceMatchReferences[0]?.role).toBe('technical');
  expect(container.querySelector<HTMLButtonElement>('[data-testid="reference-match-normalize"]')?.disabled).toBe(false);
  expect(container.querySelector<HTMLButtonElement>('[data-testid="reference-match-propose"]')?.disabled).toBe(true);
  await changeSelect(container, '[data-testid="reference-match-role"]', 'creative');

  useUIStore.getState().setUI({ activeView: 'editor' });
  await click(container, '[data-testid="reference-match-reveal"]');
  expect(useLibraryStore.getState()).toMatchObject({
    libraryActivePath: '/photos/reference.ARW',
    multiSelectedPaths: ['/photos/reference.ARW'],
    selectionAnchorPath: '/photos/reference.ARW',
  });
  expect(useUIStore.getState().activeView).toBe('library');
  await act(async () => {
    useEditorStore
      .getState()
      .setReferenceMatchReferences((current) =>
        current.map((reference) => ({ ...reference, availability: 'missing' })),
      );
    await flushPromises();
  });
  expect(container.querySelector('[data-testid="reference-match-availability"]')?.textContent).toContain(
    'cached preview only',
  );

  await click(container, '[data-testid="reference-match-compare"]');
  expect(useEditorStore.getState().compare).toMatchObject({
    mode: 'side-by-side',
    source: { kind: 'reference', label: 'reference.ARW' },
  });

  expect(container.querySelector<HTMLButtonElement>('[data-testid="reference-match-propose"]')?.disabled).toBe(true);
  await act(async () => {
    useEditorStore
      .getState()
      .setReferenceMatchReferences((current) =>
        current.map((reference) => ({ ...reference, availability: 'replaced' })),
      );
    await flushPromises();
  });
  expect(container.querySelector('[data-testid="reference-match-availability"]')?.textContent).toContain(
    'excluded from matching',
  );
  expect(container.querySelector<HTMLButtonElement>('[data-testid="reference-match-normalize"]')?.disabled).toBe(true);
  await act(async () => {
    useEditorStore
      .getState()
      .setReferenceMatchReferences((current) =>
        current.map((reference) => ({ ...reference, availability: 'available' })),
      );
    await flushPromises();
  });

  const historyBeforeProposal = useEditorStore.getState().historyIndex;
  await click(container, '[data-testid="reference-match-propose"]');
  expect(container.querySelector('[data-testid="reference-match-proposal"]')?.textContent).toContain(
    'Creative look proposal',
  );
  expect(container.querySelector('[data-testid="reference-match-proposal"]')?.textContent).toContain(
    'creativeTemperature',
  );
  expect(container.querySelector('[data-testid="reference-match-effective-references"]')?.textContent).toContain(
    'Creative 100%',
  );
  expect(useEditorStore.getState().historyIndex).toBe(historyBeforeProposal);
  expect(useEditorStore.getState().adjustments).toEqual(initial);
  expect(useEditorStore.getState().referenceMatchPreview).toMatchObject({
    baseAdjustmentRevision: useEditorStore.getState().adjustmentSnapshot.adjustmentRevision,
    impact: 100,
    targetPath: '/photos/target.ARW',
  });
  expect(useEditorStore.getState().referenceMatchPreview?.adjustments.exposure).not.toBe(initial.exposure);
  expect(container.querySelector<HTMLButtonElement>('[data-testid="reference-match-apply-layer"]')?.disabled).toBe(
    true,
  );
  expect(container.querySelector('[data-testid="reference-match-layer-abstention"]')?.textContent).toContain(
    'creativeTemperature',
  );

  const capturedSourceRevision = useEditorStore.getState().referenceMatchReferences[0]?.sourceRevision;
  if (!capturedSourceRevision) throw new Error('Expected captured source revision');
  await act(async () => {
    useEditorStore
      .getState()
      .setReferenceMatchReferences((current) =>
        current.map((reference) => ({ ...reference, sourceRevision: `source-revision-v1:${'f'.repeat(64)}` })),
      );
    await flushPromises();
  });
  await click(container, '[data-testid="reference-match-apply"]');
  expect(container.querySelector('[data-testid="reference-match-apply-abstention"]')?.textContent).toContain(
    'changed after analysis',
  );
  expect(useEditorStore.getState().historyIndex).toBe(historyBeforeProposal);
  await act(async () => {
    useEditorStore
      .getState()
      .setReferenceMatchReferences((current) =>
        current.map((reference) => ({ ...reference, sourceRevision: capturedSourceRevision })),
      );
    await flushPromises();
  });
  await click(container, '[data-testid="reference-match-apply"]');
  expect(useEditorStore.getState().historyIndex).toBe(historyBeforeProposal + 1);
  expect(useEditorStore.getState().lastReferenceMatchApplicationReceipt).toMatchObject({
    destination: 'global-adjustments',
    historyEntriesAdded: 1,
    impact: 100,
  });
  expect(useEditorStore.getState().adjustments.referenceMatchApplicationReceipt).toEqual(
    useEditorStore.getState().lastReferenceMatchApplicationReceipt,
  );
  expect(useEditorStore.getState().adjustments.exposure).not.toBe(INITIAL_ADJUSTMENTS.exposure);
  expect(useEditorStore.getState().adjustments.cameraProfile).toBe(INITIAL_ADJUSTMENTS.cameraProfile);
  expect(useEditorStore.getState().referenceMatchPreview).toBeNull();
  const appliedReceipt = useEditorStore.getState().adjustments.referenceMatchApplicationReceipt;
  await act(async () => {
    useEditorStore.getState().undo();
    await flushPromises();
  });
  expect(useEditorStore.getState().adjustments.referenceMatchApplicationReceipt).toBeNull();
  await act(async () => {
    useEditorStore.getState().redo();
    await flushPromises();
  });
  expect(useEditorStore.getState().adjustments.referenceMatchApplicationReceipt).toEqual(appliedReceipt);

  const globalExposure = useEditorStore.getState().adjustments.exposure;
  const historyBeforeLayer = useEditorStore.getState().historyIndex;
  await click(container, '[data-testid="reference-match-normalize"]');
  expect(container.querySelector<HTMLButtonElement>('[data-testid="reference-match-apply-layer"]')?.disabled).toBe(
    false,
  );
  await click(container, '[data-testid="reference-match-apply-layer"]');
  const layerState = useEditorStore.getState();
  expect(layerState.historyIndex).toBe(historyBeforeLayer + 1);
  expect(layerState.adjustments.exposure).toBe(globalExposure);
  expect(layerState.adjustments.masks[0]).toMatchObject({
    name: 'Reference Normalize',
    opacity: 100,
    referenceMatchApplicationReceipt: {
      destination: 'adjustment-layer',
      enabledGroups: ['tone'],
      historyEntriesAdded: 1,
      impact: 100,
    },
  });
  expect(layerState.adjustments.masks[0]?.adjustments.exposure).not.toBe(0);
  expect(layerState.activeMaskContainerId).toBe(layerState.adjustments.masks[0]?.id);
});

async function click(container: Element, selector: string) {
  const element = container.querySelector<HTMLButtonElement>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  await act(async () => {
    element.click();
    await flushPromises();
  });
}

async function changeSelect(container: Element, selector: string, value: string) {
  const element = container.querySelector<HTMLSelectElement>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  await act(async () => {
    element.value = value;
    element.dispatchEvent(new window.Event('change', { bubbles: true }));
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
