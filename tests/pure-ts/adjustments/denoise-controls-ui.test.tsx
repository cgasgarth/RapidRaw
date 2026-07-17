import { expect, test } from 'bun:test';
import { act, fireEvent, render } from '@testing-library/react';
import i18next from 'i18next';
import { createElement, useMemo, useState } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import DetailsPanel, { type DetailAdjustmentView } from '../../../src/components/adjustments/Details.tsx';
import LensCorrections from '../../../src/components/adjustments/LensCorrections.tsx';
import en from '../../../src/i18n/locales/en.json';
import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore.ts';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments.ts';
import { selectEditDocumentNode } from '../../../src/utils/editDocumentSelectors.ts';
import { createDefaultEditDocumentV2 } from '../../../src/utils/editDocumentV2.ts';

test('Detail inspector exposes and commits independent professional denoise controls', async () => {
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

test('Detail inspector commits chromatic aberration through lens node authority', async () => {
  installEditorSession();
  const container = await renderHarness(createElement(DenoiseControlsHarness));
  const redCyan = findSliderByLabel(container, 'Red/Cyan');
  if (redCyan === null) throw new Error('Expected Red/Cyan slider');
  const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  valueSetter?.call(redCyan, '23');
  await act(async () => {
    redCyan.dispatchEvent(new window.Event('input', { bubbles: true }));
    await flushPromises();
  });

  expect(useEditorStore.getState().editDocumentV2.nodes['lens_correction']!.params['chromaticAberrationRedCyan']).toBe(
    23,
  );
  const editDocument = useEditorStore.getState().editDocumentV2;
  const lensNode = editDocument.nodes['lens_correction'];
  const detailNode = editDocument.nodes['detail_denoise_dehaze'];
  if (lensNode === undefined || detailNode === undefined) throw new Error('Expected lens and detail authority nodes.');
  expect(lensNode.params['chromaticAberrationRedCyan']).toBe(23);
  expect(detailNode.params).not.toHaveProperty('chromaticAberrationRedCyan');
  expect(useEditorStore.getState().lastEditApplicationReceipt).toMatchObject({
    adjustmentRevision: 1,
    source: 'manual-control',
  });
});

test('Detail mask controls keep local denoise values outside the global transaction authority', async () => {
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

test('Alt sharpening diagnostics are transient and publish only during the slider drag', async () => {
  installEditorSession();
  const container = await renderHarness(createElement(DenoiseControlsHarness));
  const sharpening = findSliderByLabel(container, 'Sharpness');
  if (sharpening === null) throw new Error('Expected Sharpness slider');

  fireEvent.keyDown(window, { altKey: true, key: 'Alt' });
  fireEvent.mouseDown(sharpening, { clientX: 2 });
  expect(useEditorStore.getState().detailModifierPreview).toBe('sharpening');

  fireEvent.mouseUp(window);
  expect(useEditorStore.getState().detailModifierPreview).toBeNull();

  fireEvent.keyUp(window, { altKey: false, key: 'Alt' });
});

function DenoiseControlsHarness() {
  const document = useEditorStore((state) => state.editDocumentV2);
  const selectedImage = useEditorStore((state) => state.selectedImage);
  const adjustments = useMemo<DetailAdjustmentView>(
    () => ({
      ...selectEditDocumentNode(document, 'detail_denoise_dehaze').params,
      ...selectEditDocumentNode(document, 'lens_correction').params,
    }),
    [document],
  );
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
    createElement(LensCorrections, {
      adjustments: {
        ...document.geometry,
        ...selectEditDocumentNode(document, 'lens_correction').params,
      },
      selectedImage,
      setAdjustments: () => {
        throw new Error('Global lens control bypassed EditTransaction.');
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
  const document = createDefaultEditDocumentV2();
  const [adjustments, setAdjustments] = useState<DetailAdjustmentView>(() => ({
    ...selectEditDocumentNode(document, 'detail_denoise_dehaze').params,
    ...selectEditDocumentNode(document, 'lens_correction').params,
  }));
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

async function renderHarness(child: ReturnType<typeof createElement>): Promise<HTMLElement> {
  const i18n = i18next.createInstance();
  await i18n.use(initReactI18next).init({
    interpolation: { escapeValue: false },
    lng: 'en',
    react: { useSuspense: false },
    resources: { en: { translation: en } },
  });
  const view = render(createElement(I18nextProvider, { i18n }, child));
  await act(flushPromises);
  return view.container;
}

function installEditorSession() {
  const path = '/fixture/detail-controls.ARW';
  const adjustments = structuredClone(INITIAL_ADJUSTMENTS);
  const editDocumentV2 = createDefaultEditDocumentV2();
  useEditorStore.getState().hydrateEditorRenderAuthority({
    adjustmentRevision: 0,
    editDocumentV2,
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
    history: [editDocumentV2],
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

async function flushPromises() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
