import { afterEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import i18next from 'i18next';
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import DetailsPanel from '../../../src/components/adjustments/Details.tsx';
import en from '../../../src/i18n/locales/en.json';
import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore.ts';
import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots.ts';
import { type Adjustments, INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments.ts';
import { legacyAdjustmentsToEditDocumentV2 } from '../../../src/utils/editDocumentV2.ts';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let rendered: { container: HTMLDivElement; root: Root } | null = null;

afterEach(() => {
  if (rendered !== null) {
    act(() => rendered?.root.unmount());
    rendered.container.remove();
    rendered = null;
  }
});

test('Detail inspector exposes and commits independent professional denoise controls', async () => {
  installDom();
  installEditorSession();
  const container = await renderHarness(createElement(DenoiseControlsHarness));

  for (const label of ['Luminance', 'Color', 'Detail', 'Natural grain', 'Contrast protection', 'Shadow bias']) {
    if (findSliderByLabel(container, label) === null)
      throw new Error(`Expected ${label} slider in ${container.textContent?.slice(0, 500) ?? ''}`);
  }

  const naturalGrain = findSliderByLabel(container, 'Natural grain');
  if (naturalGrain === null) throw new Error('Expected Natural grain slider');
  const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  valueSetter?.call(naturalGrain, '42');
  await act(async () => {
    naturalGrain.dispatchEvent(new window.Event('input', { bubbles: true }));
    await flushPromises();
  });

  expect(container.querySelector('[data-testid="denoise-control-state"]')?.textContent).toContain(
    '"denoiseNaturalGrain":42',
  );
  expect(useEditorStore.getState().lastEditApplicationReceipt).toMatchObject({
    adjustmentRevision: 1,
    source: 'manual-control',
  });
});

test('Detail mask controls keep local denoise values outside the global transaction authority', async () => {
  installDom();
  installEditorSession();
  const container = await renderHarness(createElement(MaskDenoiseControlsHarness));
  const luminance = findSliderByLabel(container, 'Luminance');
  if (luminance === null) throw new Error('Expected mask Luminance slider');
  const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  valueSetter?.call(luminance, '-20');
  await act(async () => {
    luminance.dispatchEvent(new window.Event('input', { bubbles: true }));
    await flushPromises();
  });

  expect(container.querySelector('[data-testid="mask-denoise-state"]')?.textContent).toBe('-20');
  expect(useEditorStore.getState().adjustmentRevision).toBe(0);
});

function DenoiseControlsHarness() {
  const adjustments = useEditorStore((state) => state.adjustments);
  return createElement(
    'div',
    null,
    createElement(DetailsPanel, {
      adjustments,
      appSettings: null,
      setAdjustments: () => {
        throw new Error('Global node-owned denoise control bypassed EditTransaction.');
      },
    }),
    createElement(
      'output',
      { 'data-testid': 'denoise-control-state' },
      JSON.stringify({
        denoiseContrastProtection: adjustments.denoiseContrastProtection,
        denoiseDetail: adjustments.denoiseDetail,
        denoiseNaturalGrain: adjustments.denoiseNaturalGrain,
        denoiseShadowBias: adjustments.denoiseShadowBias,
      }),
    ),
  );
}

function MaskDenoiseControlsHarness() {
  const [adjustments, setAdjustments] = useState<Adjustments>(INITIAL_ADJUSTMENTS);
  return createElement(
    'div',
    null,
    createElement(DetailsPanel, {
      adjustments,
      appSettings: null,
      isForMask: true,
      setAdjustments: (update) => {
        setAdjustments((current) => (typeof update === 'function' ? update(current) : { ...current, ...update }));
      },
    }),
    createElement('output', { 'data-testid': 'mask-denoise-state' }, String(adjustments.lumaNoiseReduction)),
  );
}

async function renderHarness(child: ReturnType<typeof createElement>): Promise<HTMLDivElement> {
  const i18n = i18next.createInstance();
  await i18n.use(initReactI18next).init({
    interpolation: { escapeValue: false },
    lng: 'en',
    react: { useSuspense: false },
    resources: { en: { translation: en } },
  });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  rendered = { container, root };
  await act(async () => {
    root.render(createElement(I18nextProvider, { i18n }, child));
    await flushPromises();
  });
  return container;
}

function installEditorSession() {
  const path = '/fixture/detail-controls.ARW';
  const adjustments = structuredClone(INITIAL_ADJUSTMENTS);
  const editDocumentV2 = legacyAdjustmentsToEditDocumentV2(adjustments);
  useEditorStore.setState({
    adjustmentRevision: 0,
    adjustmentSnapshot: publishAdjustmentSnapshot(null, adjustments, editDocumentV2),
    adjustments,
    editDocumentV2,
    history: [adjustments],
    historyCheckpoints: [],
    historyIndex: 0,
    imageSession: createEditorImageSession({ generation: 1, path, source: 'cache' }),
    lastEditApplicationReceipt: null,
    selectedImage: {
      exif: null,
      height: 3000,
      isRaw: true,
      isReady: true,
      metadata: null,
      originalUrl: null,
      path,
      rawDevelopmentReport: null,
      thumbnailUrl: '',
      width: 4000,
    },
  });
}

function findSliderByLabel(container: Element, label: string): HTMLInputElement | null {
  const labelElement = Array.from(container.querySelectorAll('*')).find(
    (element) => element.textContent?.trim() === label,
  );
  let candidate = labelElement;
  while (candidate !== undefined && candidate !== null && candidate !== container) {
    const slider = candidate.querySelector<HTMLInputElement>('input[type="range"]');
    if (slider !== null) return slider;
    candidate = candidate.parentElement ?? undefined;
  }
  return null;
}

function installDom() {
  const window = new Window({ url: 'http://localhost/denoise-controls-test' });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: window.document });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: window.navigator });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: window.HTMLElement });
}

async function flushPromises() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
