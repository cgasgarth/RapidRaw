import { afterEach, beforeEach, expect, test } from 'bun:test';
import { act, render } from '@testing-library/react';
import i18next from 'i18next';
import { createElement, useState } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import { ColorGradingControls } from '../../../src/components/adjustments/color/ColorGradingControls';
import type { ColorPanelAdjustmentView } from '../../../src/components/adjustments/color/types';
import { selectColorPanelAdjustmentView } from '../../../src/components/panel/right/color/ColorWorkspacePanel';
import en from '../../../src/i18n/locales/en.json';
import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { perceptualGradingFromWheelSurface } from '../../../src/utils/color/perceptualGrading';
import { createDefaultEditDocumentV2 } from '../../../src/utils/editDocumentV2';
import { resolvePerceptualGradingSliderRenderSnapshot } from '../../../src/utils/perceptualGradingSliderInteraction';

const sourcePath = '/fixture/lightroom-color-grading.ARW';

const selectedImage = {
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
};

const defaultColorView = (): ColorPanelAdjustmentView => selectColorPanelAdjustmentView(createDefaultEditDocumentV2());

beforeEach(() => {
  useEditorStore.getState().setEditor({ selectedImage: null });
});

afterEach(() => {
  useEditorStore.getState().setEditor({ selectedImage: null });
});

test('renders every grading view with three compact three-way wheels and numeric luminance targets', async () => {
  const rendered = await renderColorGrading();

  expect(rendered.container.querySelectorAll('[role="tab"]')).toHaveLength(5);
  expect(rendered.container.querySelectorAll('[data-testid^="color-grading-wheel-"]')).toHaveLength(3);
  expect(rendered.container.querySelectorAll('input[aria-label="Luminance"]')).toHaveLength(3);

  await click(rendered.container, '[data-testid="color-grading-view-highlights"]');
  expect(rendered.container.querySelector('[data-active-range]')?.getAttribute('data-active-range')).toBe('highlights');
  expect(rendered.container.querySelector('input[aria-label="Hue"]')).not.toBeNull();

  await click(rendered.container, '[data-testid="color-grading-view-global"]');
  expect(rendered.container.querySelector('[data-active-range]')?.getAttribute('data-active-range')).toBe('global');
});

test('preview updates stay transient and commit one typed history entry for a completed gesture', () => {
  const document = createDefaultEditDocumentV2();
  const session = createEditorImageSession({ generation: 9, path: sourcePath, source: 'cache' });
  useEditorStore.getState().hydrateEditorRenderAuthority({
    adjustmentRevision: 0,
    editDocumentV2: document,
    history: [document],
    historyCheckpoints: [],
    historyIndex: 0,
    imageSession: session,
    lastEditApplicationReceipt: null,
    selectedImage,
  });

  const state = useEditorStore.getState();
  const identity = {
    adjustmentRevision: state.adjustmentRevision,
    imageSessionId: session.id,
    sourceIdentity: sourcePath,
  };
  const interactionId = 'color-grading-gesture';
  const nextColorGrading = {
    ...structuredClone(INITIAL_ADJUSTMENTS.colorGrading),
    balance: 18,
    midtones: { hue: 132, luminance: 6, saturation: 28 },
  };

  expect(state.beginPerceptualGradingSliderInteraction(identity, interactionId)).toBeTrue();
  state.updatePerceptualGradingSliderInteraction(interactionId, nextColorGrading);

  const previewState = useEditorStore.getState();
  expect(previewState.history).toHaveLength(1);
  expect(previewState.editDocumentV2.nodes['perceptual_grading']?.params['colorGrading']).toEqual(
    INITIAL_ADJUSTMENTS.colorGrading,
  );
  expect(previewState.perceptualGradingSliderInteraction?.latestColorGrading).toEqual(nextColorGrading);
  const previewSnapshot = resolvePerceptualGradingSliderRenderSnapshot(
    previewState.adjustmentSnapshot,
    previewState.perceptualGradingSliderInteraction,
    previewState,
  );
  expect(previewSnapshot.editDocumentV2.nodes['perceptual_grading']?.params['colorGrading']).toEqual(nextColorGrading);

  const result = previewState.commitPerceptualGradingSliderInteraction(interactionId);
  expect(result).not.toBeNull();
  expect(useEditorStore.getState().history).toHaveLength(2);
  expect(useEditorStore.getState().lastEditApplicationReceipt).toMatchObject({
    source: 'manual-control',
    transactionId: interactionId,
  });
  expect(useEditorStore.getState().editDocumentV2.nodes['perceptual_grading']?.params).toEqual({
    colorGrading: nextColorGrading,
    perceptualGradingV1: perceptualGradingFromWheelSurface(nextColorGrading),
  });

  useEditorStore.getState().undo();
  expect(useEditorStore.getState().history).toHaveLength(2);
  expect(useEditorStore.getState().editDocumentV2.nodes['perceptual_grading']?.params['colorGrading']).toEqual(
    INITIAL_ADJUSTMENTS.colorGrading,
  );
});

test('cancelled grading gestures discard the preview without adding history', () => {
  const document = createDefaultEditDocumentV2();
  const session = createEditorImageSession({ generation: 10, path: sourcePath, source: 'cache' });
  useEditorStore.getState().hydrateEditorRenderAuthority({
    adjustmentRevision: 0,
    editDocumentV2: document,
    history: [document],
    historyCheckpoints: [],
    historyIndex: 0,
    imageSession: session,
    lastEditApplicationReceipt: null,
    selectedImage,
  });
  const state = useEditorStore.getState();
  const identity = {
    adjustmentRevision: state.adjustmentRevision,
    imageSessionId: session.id,
    sourceIdentity: sourcePath,
  };
  const interactionId = 'cancelled-color-grading-gesture';
  const nextColorGrading = { ...structuredClone(INITIAL_ADJUSTMENTS.colorGrading), balance: -24 };

  expect(state.beginPerceptualGradingSliderInteraction(identity, interactionId)).toBeTrue();
  state.updatePerceptualGradingSliderInteraction(interactionId, nextColorGrading);
  state.cancelPerceptualGradingSliderInteraction(interactionId);

  expect(useEditorStore.getState().perceptualGradingSliderInteraction).toBeNull();
  expect(useEditorStore.getState().history).toHaveLength(1);
  expect(useEditorStore.getState().editDocumentV2.nodes['perceptual_grading']?.params['colorGrading']).toEqual(
    INITIAL_ADJUSTMENTS.colorGrading,
  );
});

function ColorGradingHarness({ initialAdjustments }: { initialAdjustments: ColorPanelAdjustmentView }) {
  const [adjustments, setAdjustmentsState] = useState(initialAdjustments);

  return createElement(ColorGradingControls, {
    adjustments,
    appSettings: null,
    setAdjustments: (update) => {
      setAdjustmentsState((previous) => (typeof update === 'function' ? update(previous) : { ...previous, ...update }));
    },
  });
}

async function renderColorGrading() {
  const i18n = i18next.createInstance();
  await i18n.use(initReactI18next).init({
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    lng: 'en',
    react: { useSuspense: false },
    resources: { en: { translation: en } },
  });
  return render(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(ColorGradingHarness, { initialAdjustments: defaultColorView() }),
    ),
  );
}

async function click(container: Element, selector: string) {
  await act(async () => {
    const target = container.querySelector<HTMLButtonElement>(selector);
    if (target === null) throw new Error(`Expected ${selector} to render.`);
    target.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
