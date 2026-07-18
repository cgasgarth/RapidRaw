import { afterEach, expect, test } from 'bun:test';
import { act, fireEvent, render } from '@testing-library/react';
import i18next from 'i18next';
import { createElement, useState } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import BasicAdjustments, { type BasicAdjustmentView } from '../../../src/components/adjustments/Basic';
import type { SelectedImage } from '../../../src/components/ui/AppProperties';
import en from '../../../src/i18n/locales/en.json';
import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { useUIStore } from '../../../src/store/useUIStore';
import { selectEditDocumentNode } from '../../../src/utils/editDocumentSelectors';
import { createDefaultEditDocumentV2 } from '../../../src/utils/editDocumentV2';

const sourcePath = '/private/alaska.ARW';

const defaultBasicView = (): BasicAdjustmentView => {
  const document = createDefaultEditDocumentV2();
  return {
    ...selectEditDocumentNode(document, 'scene_global_color_tone').params,
    ...selectEditDocumentNode(document, 'scene_to_view_transform').params,
    ...selectEditDocumentNode(document, 'tone_equalizer').params,
    ...selectEditDocumentNode(document, 'detail_denoise_dehaze').params,
    ...selectEditDocumentNode(document, 'color_presence').params,
  };
};

afterEach(() => {
  const editDocumentV2 = createDefaultEditDocumentV2();
  act(() => {
    useEditorStore.getState().hydrateEditorRenderAuthority({
      adjustmentRevision: 0,
      editDocumentV2,
      history: [editDocumentV2],
      historyCheckpoints: [],
      historyIndex: 0,
      imageSession: null,
      selectedImage: null,
    });
    useUIStore.setState({ toneEqualizerPickerActive: false, toneEqualizerPickerReceipt: null });
  });
});

test('Basic ends with ordered Presence rows and keeps the Color duplicate out of the panel', async () => {
  const { container, getAdjustments } = await renderBasic({ isForMask: true });
  const presence = required(container, '[data-testid="basic-presence-section"]');
  const rows = Array.from(
    presence.querySelectorAll<HTMLElement>('[data-density="compact"][data-testid^="basic-presence-control-"]'),
  );

  expect(rows.map((row) => row.dataset['testid'])).toEqual([
    'basic-presence-control-texture',
    'basic-presence-control-clarity',
    'basic-presence-control-dehaze',
    'basic-presence-control-vibrance',
    'basic-presence-control-saturation',
  ]);
  expect(
    Boolean(
      required(container, '[data-testid="basic-tone-advanced-section"]').compareDocumentPosition(presence) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ),
  ).toBe(true);
  expect(container.querySelector('[data-testid="color-quick-presence"]')).toBeNull();

  const clarityRange = required<HTMLInputElement>(presence, '[data-testid="basic-presence-control-clarity"] input');
  await act(async () => {
    fireEvent.input(clarityRange, { target: { value: '36' } });
    await flushPromises();
  });
  expect(getAdjustments().clarity).toBe(36);

  await act(async () => {
    required<HTMLButtonElement>(
      presence.querySelector('[data-testid="basic-presence-control-clarity"]') ?? presence,
      '[data-testid="basic-presence-control-clarity-label"]',
    ).click();
    await flushPromises();
  });
  expect(getAdjustments().clarity).toBe(0);
});

test('global Basic Clarity uses the typed detail transaction and Undo restores the node', async () => {
  const imageSession = createEditorImageSession({ generation: 7, path: sourcePath, source: 'cache' });
  const selectedImage: SelectedImage = {
    exif: null,
    height: 8,
    isRaw: true,
    isReady: true,
    originalUrl: null,
    path: sourcePath,
    rawDevelopmentReport: null,
    thumbnailUrl: '',
    width: 8,
  };
  const editDocumentV2 = createDefaultEditDocumentV2();
  act(() => {
    useEditorStore.getState().hydrateEditorRenderAuthority({
      adjustmentRevision: 0,
      editDocumentV2,
      history: [editDocumentV2],
      historyCheckpoints: [],
      historyIndex: 0,
      imageSession: imageSession,
      selectedImage,
    });
  });

  const { container } = await renderBasic({ initialAdjustments: defaultBasicView() });
  const clarityRange = required<HTMLInputElement>(container, '[data-testid="basic-presence-control-clarity"] input');
  await act(async () => {
    fireEvent.input(clarityRange, { target: { value: '24' } });
    await flushPromises();
  });

  expect(useEditorStore.getState().editDocumentV2.nodes['detail_denoise_dehaze']?.params['clarity']).toBe(24);
  expect(useEditorStore.getState().history).toHaveLength(2);
  act(() => {
    useEditorStore.getState().undo();
  });
  expect(useEditorStore.getState().editDocumentV2.nodes['detail_denoise_dehaze']?.params['clarity']).toBe(0);
});

test('global Basic Presence numeric edit commits one history entry after preview', async () => {
  const imageSession = createEditorImageSession({ generation: 8, path: sourcePath, source: 'cache' });
  const selectedImage: SelectedImage = {
    exif: null,
    height: 8,
    isRaw: true,
    isReady: true,
    originalUrl: null,
    path: sourcePath,
    rawDevelopmentReport: null,
    thumbnailUrl: '',
    width: 8,
  };
  const editDocumentV2 = createDefaultEditDocumentV2();
  act(() => {
    useEditorStore.getState().hydrateEditorRenderAuthority({
      adjustmentRevision: 0,
      editDocumentV2,
      history: [editDocumentV2],
      historyCheckpoints: [],
      historyIndex: 0,
      imageSession,
      selectedImage,
    });
  });

  const { container } = await renderBasic({ initialAdjustments: defaultBasicView() });
  const clarityValue = required<HTMLButtonElement>(container, '[data-testid="basic-presence-control-clarity-value"]');
  await act(async () => {
    fireEvent.click(clarityValue);
    await flushPromises();
    const clarityInput = required<HTMLInputElement>(container, '[data-testid="basic-presence-control-clarity-input"]');
    fireEvent.change(clarityInput, { target: { value: '24' } });
    await flushPromises();
    fireEvent.keyDown(clarityInput, { key: 'Enter' });
    await flushPromises();
  });

  expect(useEditorStore.getState().editDocumentV2.nodes['detail_denoise_dehaze']?.params['clarity']).toBe(24);
  expect(useEditorStore.getState().history).toHaveLength(2);
});

function BasicHarness({
  initialAdjustments,
  isForMask,
  onAdjustmentsChange,
}: {
  initialAdjustments: BasicAdjustmentView;
  isForMask: boolean;
  onAdjustmentsChange: (adjustments: BasicAdjustmentView) => void;
}) {
  const [adjustments, setAdjustmentsState] = useState(initialAdjustments);

  return createElement(BasicAdjustments, {
    adjustments,
    isForMask,
    setAdjustments: (update) => {
      setAdjustmentsState((previous) => {
        const next = typeof update === 'function' ? update(previous) : { ...previous, ...update };
        onAdjustmentsChange(next);
        return next;
      });
    },
  });
}

async function renderBasic({
  initialAdjustments = defaultBasicView(),
  isForMask = false,
}: {
  initialAdjustments?: BasicAdjustmentView;
  isForMask?: boolean;
} = {}) {
  const i18n = i18next.createInstance();
  await i18n.use(initReactI18next).init({
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    lng: 'en',
    react: { useSuspense: false },
    resources: { en: { translation: en } },
  });
  let currentAdjustments = initialAdjustments;
  const view = render(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(BasicHarness, {
        initialAdjustments,
        isForMask,
        onAdjustmentsChange: (adjustments) => {
          currentAdjustments = adjustments;
        },
      }),
    ),
  );
  await act(flushPromises);
  return { ...view, getAdjustments: () => currentAdjustments };
}

function required<T extends Element>(container: Element, selector: string): T {
  const element = container.querySelector<T>(selector);
  if (element === null) throw new Error(`Expected ${selector} to render.`);
  return element;
}

async function flushPromises() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
