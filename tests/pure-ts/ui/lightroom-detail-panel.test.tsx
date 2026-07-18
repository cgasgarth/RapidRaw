import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { act, fireEvent, render } from '@testing-library/react';
import i18next from 'i18next';
import { createElement, useMemo } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import { editDocumentDetailDenoiseDehazeV2Schema } from '../../../packages/rawengine-schema/src/editDocumentV2';
import DetailsPanel, { type DetailAdjustmentView } from '../../../src/components/adjustments/Details';
import en from '../../../src/i18n/locales/en.json';
import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { DetailsAdjustment } from '../../../src/utils/adjustments';
import { buildDetailEditTransaction } from '../../../src/utils/detailEditTransaction';
import { selectEditDocumentNode } from '../../../src/utils/editDocumentSelectors';
import { createDefaultEditDocumentV2 } from '../../../src/utils/editDocumentV2';
import { hydrateImageOpenEditDocumentV2 } from '../../../src/utils/imageOpenAdjustmentHydration';

const sourcePath = '/fixture/lightroom-detail-panel.ARW';

const i18n = i18next.createInstance();
await i18n.use(initReactI18next).init({
  interpolation: { escapeValue: false },
  lng: 'en',
  react: { useSuspense: false },
  resources: { en: { translation: en } },
});

beforeEach(() => {
  const editDocumentV2 = createDefaultEditDocumentV2();
  useEditorStore.getState().hydrateEditorRenderAuthority({
    adjustmentRevision: 0,
    editDocumentV2,
    history: [editDocumentV2],
    historyCheckpoints: [],
    historyIndex: 0,
    imageSession: createEditorImageSession({ generation: 1, path: sourcePath, source: 'cache' }),
    imageSessionId: 1,
    lastEditApplicationReceipt: null,
    selectedImage: {
      exif: null,
      height: 3000,
      isRaw: true,
      isReady: true,
      metadata: null,
      originalUrl: null,
      path: sourcePath,
      rawDevelopmentReport: null,
      thumbnailUrl: '',
      width: 4000,
    },
  });
});

afterEach(() => {
  act(() => {
    useEditorStore.getState().setEditor({ detailModifierPreview: null });
  });
});

test('Detail opens on Sharpening and Noise Reduction with moved controls absent and Advanced collapsed', () => {
  const view = renderPanel();
  const sections = Array.from(view.container.querySelectorAll<HTMLElement>('[data-testid^="detail-section-"]')).map(
    (section) => section.dataset['testid'],
  );

  expect(sections).toEqual([
    'detail-section-sharpening',
    'detail-section-noise-reduction',
    'detail-section-color-noise-reduction',
  ]);
  expect(view.container.querySelector('[data-testid="detail-section-presence"]')).toBeNull();
  expect(view.container.querySelector('[data-testid="detail-section-chromatic-aberration"]')).toBeNull();
  expect(view.container.querySelector('[data-testid="detail-section-dust-spot-visualization"]')).toBeNull();
  for (const movedLabel of ['Clarity', 'Dehaze', 'Structure', 'Red/Cyan', 'Blue/Yellow', 'Dust Spot Visualization']) {
    expect(view.container.textContent).not.toContain(movedLabel);
  }
  expect(view.container.querySelector('[data-testid="detail-advanced"]')).not.toBeNull();
  const advanced = view.container.querySelector<HTMLDetailsElement>('[data-testid="detail-advanced"]');
  if (advanced === null) throw new Error('Expected Advanced disclosure.');
  expect(advanced.open).toBe(false);
  expect(view.container.querySelector('[data-testid="detail-control-sharpening-amount-range"]')).not.toBeNull();
  expect(view.container.querySelector('[data-testid="detail-control-sharpening-radius-range"]')).not.toBeNull();
  expect(view.container.querySelector('[data-testid="detail-control-sharpening-detail-range"]')).not.toBeNull();
  expect(view.container.querySelector('[data-testid="detail-control-sharpening-masking-range"]')).not.toBeNull();
  expect(view.container.querySelector('[data-testid="detail-control-noise-luminance-range"]')).not.toBeNull();
  expect(view.container.querySelector('[data-testid="detail-control-noise-detail-range"]')).not.toBeNull();
  expect(view.container.querySelector('[data-testid="detail-control-noise-contrast-range"]')).not.toBeNull();
  expect(view.container.querySelector('[data-testid="detail-control-color-noise-color-range"]')).not.toBeNull();
  expect(view.container.querySelector('[data-testid="detail-control-color-noise-detail-range"]')).not.toBeNull();
  expect(view.container.querySelector('[data-testid="detail-control-color-noise-smoothness-range"]')).not.toBeNull();
  act(() => view.unmount());
});

test('Detail rows commit typed node fields independently and survive schema serialization', async () => {
  const controls = [
    ['detail-control-sharpening-amount-range', 'sharpness', 35],
    ['detail-control-sharpening-radius-range', 'localContrastRadiusPx', 42],
    ['detail-control-sharpening-detail-range', 'sharpnessThreshold', 28],
    ['detail-control-sharpening-masking-range', 'localContrastMidtoneMask', 61],
    ['detail-control-noise-luminance-range', 'lumaNoiseReduction', 24],
    ['detail-control-noise-detail-range', 'denoiseDetail', 64],
    ['detail-control-noise-contrast-range', 'denoiseContrastProtection', 77],
    ['detail-control-color-noise-color-range', 'colorNoiseReduction', 38],
    ['detail-control-color-noise-detail-range', 'denoiseDetail', 55],
    ['detail-control-color-noise-smoothness-range', 'denoiseNaturalGrain', 28],
  ] as const;

  for (const [testId, field, value] of controls) {
    const view = renderPanel();
    const input = view.container.querySelector<HTMLInputElement>(`[data-testid="${testId}"]`);
    if (input === null) throw new Error(`Expected ${testId}.`);
    await act(async () => {
      fireEvent.input(input, { target: { value: String(field === 'denoiseNaturalGrain' ? 100 - value : value) } });
      await flushPromises();
    });

    const document = useEditorStore.getState().editDocumentV2;
    const detail = editDocumentDetailDenoiseDehazeV2Schema.parse(document.nodes['detail_denoise_dehaze']?.params);
    expect(detail[field]).toBe(value);
    expect(useEditorStore.getState().history).toHaveLength(2);
    expect(useEditorStore.getState().lastEditApplicationReceipt).toMatchObject({
      source: 'manual-control',
      persistence: 'commit',
    });

    const reopened = hydrateImageOpenEditDocumentV2({ editDocumentV2: document });
    expect(editDocumentDetailDenoiseDehazeV2Schema.parse(reopened.nodes['detail_denoise_dehaze']?.params)[field]).toBe(
      value,
    );
    act(() => {
      useEditorStore.getState().undo();
    });
    expect(
      editDocumentDetailDenoiseDehazeV2Schema.parse(
        useEditorStore.getState().editDocumentV2.nodes['detail_denoise_dehaze']?.params,
      )[field],
    ).not.toBe(value);
    act(() => view.unmount());
  }
});

test('Advanced disclosure keeps Deblur reachable while remaining secondary to core Detail rows', async () => {
  const view = renderPanel();
  const advanced = view.container.querySelector<HTMLDetailsElement>('[data-testid="detail-advanced"]');
  if (advanced === null) throw new Error('Expected Advanced disclosure.');
  const summary = advanced.querySelector('summary');
  if (summary === null) throw new Error('Expected Advanced summary.');
  expect(view.container.querySelector('[data-testid="detail-advanced-deblur"]')).not.toBeNull();
  await act(async () => {
    fireEvent.click(summary);
    await flushPromises();
  });
  expect(advanced.open).toBe(true);

  const toggle = view.container.querySelector<HTMLInputElement>('#detail-control-deblur-enabled');
  if (toggle === null) throw new Error('Expected Deblur toggle.');
  await act(async () => {
    fireEvent.click(toggle);
    await flushPromises();
  });
  expect(useEditorStore.getState().editDocumentV2.nodes['detail_denoise_dehaze']?.params['deblurEnabled']).toBe(true);

  const strength = view.container.querySelector<HTMLInputElement>(
    '[data-testid="detail-control-deblur-strength-range"]',
  );
  if (strength === null) throw new Error('Expected Deblur amount control.');
  await act(async () => {
    fireEvent.input(strength, { target: { value: '44' } });
    await flushPromises();
  });
  expect(useEditorStore.getState().editDocumentV2.nodes['detail_denoise_dehaze']?.params['deblurStrength']).toBe(44);
  expect(useEditorStore.getState().history).toHaveLength(3);
  act(() => view.unmount());
});

test('Detail interaction requests coalesce into one undoable current-document entry', () => {
  const state = useEditorStore.getState();
  const identity = {
    adjustmentRevision: state.adjustmentRevision,
    imageSessionId: state.imageSession?.id ?? 'editor-image-session:1',
    sourceIdentity: sourcePath,
  };
  const transactionId = 'detail-pointer-gesture';
  const first = state.applyEditTransaction(
    buildDetailEditTransaction(state, identity, DetailsAdjustment.Sharpness, 24, transactionId),
  );
  const second = useEditorStore
    .getState()
    .applyEditTransaction(
      buildDetailEditTransaction(
        useEditorStore.getState(),
        { ...identity, adjustmentRevision: first.nextAdjustmentRevision },
        DetailsAdjustment.Sharpness,
        48,
        transactionId,
        'coalesced-interaction',
      ),
    );

  expect(second.nextAdjustmentRevision).toBe(2);
  expect(useEditorStore.getState().history).toHaveLength(2);
  expect(useEditorStore.getState().editDocumentV2.nodes['detail_denoise_dehaze']?.params['sharpness']).toBe(48);
  act(() => {
    useEditorStore.getState().undo();
  });
  expect(useEditorStore.getState().history).toHaveLength(2);
  expect(useEditorStore.getState().editDocumentV2.nodes['detail_denoise_dehaze']?.params['sharpness']).toBe(0);
});

function renderPanel() {
  return render(createElement(I18nextProvider, { i18n }, createElement(DetailControlsHarness)));
}

function DetailControlsHarness() {
  const document = useEditorStore((state) => state.editDocumentV2);
  const adjustments = useMemo<DetailAdjustmentView>(
    () => ({
      ...selectEditDocumentNode(document, 'detail_denoise_dehaze').params,
      ...selectEditDocumentNode(document, 'lens_correction').params,
    }),
    [document],
  );
  return createElement(DetailsPanel, {
    adjustments,
    appSettings: null,
    setAdjustments: mock(() => {
      throw new Error('Global Detail controls must commit through the typed transaction.');
    }),
  });
}

async function flushPromises() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
