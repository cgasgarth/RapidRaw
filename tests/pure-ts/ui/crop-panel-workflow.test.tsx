import { afterEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import i18next from 'i18next';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import CropPanel from '../../../src/components/panel/right/color/CropPanel.tsx';
import { Panel, type SelectedImage } from '../../../src/components/ui/AppProperties.tsx';
import { ContextMenuProvider } from '../../../src/context/ContextMenuContext.tsx';
import en from '../../../src/i18n/locales/en.json';
import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore.ts';
import { useUIStore } from '../../../src/store/useUIStore.ts';
import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots.ts';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments.ts';
import { legacyAdjustmentsToEditDocumentV2 } from '../../../src/utils/editDocumentV2.ts';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const selectedImage: SelectedImage = {
  exif: null,
  height: 3000,
  isRaw: true,
  isReady: true,
  metadata: null,
  originalUrl: null,
  path: '/validation/crop-workflow.ARW',
  rawDevelopmentReport: null,
  thumbnailUrl: 'data:image/jpeg;base64,AAAA',
  width: 4000,
};

let renderedRoot: { container: HTMLDivElement; root: Root } | null = null;

afterEach(() => {
  if (renderedRoot !== null) {
    act(() => {
      renderedRoot?.root.unmount();
    });
    renderedRoot.container.remove();
    renderedRoot = null;
  }
  resetStores();
});

describe('crop panel workflow', () => {
  test('uses compact controls and restores a canceled live crop through the existing history contract', async () => {
    const initial = { ...INITIAL_ADJUSTMENTS, aspectRatio: 3 / 2 };
    useEditorStore.setState({
      adjustments: initial,
      history: [initial],
      historyCheckpoints: [],
      historyIndex: 0,
      isStraightenActive: false,
      overlayMode: 'thirds',
      overlayRotation: 0,
      selectedImage,
      showOriginal: false,
    });
    useUIStore.setState({ activeRightPanel: Panel.Crop, renderedRightPanel: Panel.Crop });

    const { container } = await renderCropPanel();
    const panel = required<HTMLElement>(container, '[data-testid="crop-panel-status"]');
    expect(panel.dataset.cropDirty).toBe('false');
    expect(required<HTMLElement>(container, '[data-crop-panel-density="compact"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="crop-panel-actions"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-testid="crop-panel-ratio-section"] button').length).toBeGreaterThan(10);
    expect(container.querySelector('[data-testid="crop-panel-overlay-section"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="crop-panel-geometry-section"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="crop-panel-transform-entry"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="crop-panel-lens-entry"]')).not.toBeNull();

    await act(async () => {
      required<HTMLButtonElement>(container, '[data-testid="crop-ratio-preset-5-4"]').click();
      await flush();
    });

    expect(useEditorStore.getState().adjustments.aspectRatio).toBe(5 / 4);
    expect(required<HTMLElement>(container, '[data-testid="crop-panel-status"]').dataset.cropDirty).toBe('true');

    await act(async () => {
      const cancel = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
        (button) => button.textContent === 'Cancel',
      );
      if (cancel === undefined) throw new Error('Expected Crop cancel action.');
      cancel.click();
      await flush();
    });

    expect(useEditorStore.getState().adjustments.aspectRatio).toBe(3 / 2);
    expect(useEditorStore.getState().history).toHaveLength(3);
    expect(useEditorStore.getState().history.at(-1)).toEqual(initial);
    expect(useEditorStore.getState().historyIndex).toBe(2);
    expect(useUIStore.getState().activeRightPanel).toBe(Panel.Adjustments);
  });

  test('keeps invalid custom ratios visible and inaccessible to the crop model', async () => {
    useEditorStore.setState({
      adjustments: { ...INITIAL_ADJUSTMENTS, aspectRatio: 3 / 2 },
      history: [{ ...INITIAL_ADJUSTMENTS, aspectRatio: 3 / 2 }],
      historyCheckpoints: [],
      historyIndex: 0,
      selectedImage,
    });

    const { container } = await renderCropPanel();
    await act(async () => {
      required<HTMLButtonElement>(container, '[data-testid="crop-ratio-preset-custom"]').click();
      await flush();
    });
    const width = required<HTMLInputElement>(container, 'input[name="customW"]');
    const height = required<HTMLInputElement>(container, 'input[name="customH"]');
    await act(async () => {
      height.focus();
      await flush();
    });
    await setElementValue(width, '');
    await setElementValue(height, '');
    await act(async () => {
      height.blur();
      await flush();
    });

    expect(required<HTMLElement>(container, '#crop-custom-ratio-error').textContent).toContain('greater than zero');
    expect(required<HTMLInputElement>(container, 'input[name="customW"]').getAttribute('aria-invalid')).toBe('true');
  });

  test('binds the compact groups to crop state and keyboard overlay cycling', async () => {
    const adjustments = { ...INITIAL_ADJUSTMENTS, aspectRatio: 3 / 2, rotation: 3 };
    const editDocumentV2 = legacyAdjustmentsToEditDocumentV2(adjustments);
    useEditorStore.setState({
      adjustmentRevision: 0,
      adjustmentSnapshot: publishAdjustmentSnapshot(null, adjustments, editDocumentV2),
      adjustments,
      editDocumentV2,
      history: [adjustments],
      historyCheckpoints: [],
      historyIndex: 0,
      imageSession: createEditorImageSession({ generation: 1, path: selectedImage.path, source: 'cache' }),
      isStraightenActive: false,
      lastEditApplicationReceipt: null,
      overlayMode: 'goldenSpiral',
      overlayRotation: 0,
      selectedImage,
    });
    useUIStore.setState({ activeRightPanel: Panel.Crop, renderedRightPanel: Panel.Crop });

    const { container } = await renderCropPanel();

    await clickControl(container, '[data-testid="crop-panel-ratio-orientation-toggle"]');
    await clickControl(container, '[data-testid="crop-panel-flip-horizontal"]');
    await clickControl(container, '[data-testid="crop-panel-rotate-right"]');
    await clickControl(container, '[data-testid="crop-panel-straighten-toggle"]');
    await clickControl(container, '[data-testid="crop-panel-overlay-rotate"]');
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'o' }));
      await flush();
      await flush();
    });

    expect(useEditorStore.getState().adjustments).toMatchObject({
      aspectRatio: 3 / 2,
      flipHorizontal: true,
      orientationSteps: 1,
      rotation: 0,
    });
    expect(useEditorStore.getState().isStraightenActive).toBe(true);
    expect(useEditorStore.getState().overlayMode).toBe('phiGrid');
    expect(useEditorStore.getState().overlayRotation).toBe(1);
  });

  test('keeps an active custom draft through parent renders, discards it on Escape, and keys image switches', async () => {
    useEditorStore.setState({
      adjustments: { ...INITIAL_ADJUSTMENTS, aspectRatio: 1.7 },
      history: [{ ...INITIAL_ADJUSTMENTS, aspectRatio: 1.7 }],
      historyCheckpoints: [],
      historyIndex: 0,
      selectedImage,
    });
    const { container } = await renderCropPanel();
    const width = required<HTMLInputElement>(container, 'input[name="customW"]');
    expect(width.value).toBe('170');

    await act(async () => {
      width.focus();
      await flush();
    });
    await setElementValue(width, '200');
    await act(async () => {
      useEditorStore.setState({ overlayRotation: 2 });
      await flush();
    });
    expect(required<HTMLInputElement>(container, 'input[name="customW"]').value).toBe('200');

    await act(async () => {
      width.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
      await flush();
    });
    expect(required<HTMLInputElement>(container, 'input[name="customW"]').value).toBe('170');

    await act(async () => {
      useEditorStore.setState({
        adjustments: { ...INITIAL_ADJUSTMENTS, aspectRatio: 0.83 },
        selectedImage: { ...selectedImage, path: '/validation/crop-workflow-b.ARW' },
      });
      await flush();
    });
    expect(required<HTMLInputElement>(container, 'input[name="customW"]').value).toBe('83');
    expect(required<HTMLInputElement>(container, 'input[name="customH"]').value).toBe('100');
  });

  test('rotates Original in one canonical history update and clears live rotation on teardown', async () => {
    const initial = { ...INITIAL_ADJUSTMENTS, aspectRatio: 4 / 3, orientationSteps: 0, rotation: 4 };
    useEditorStore.setState({
      adjustments: initial,
      history: [initial],
      historyCheckpoints: [],
      historyIndex: 0,
      liveRotation: 8,
      selectedImage,
    });
    const { container, root } = await renderCropPanel();
    await clickControl(container, '[data-testid="crop-panel-straighten-toggle"]');
    expect(useEditorStore.getState().adjustments.rotation).toBe(0);
    await clickControl(container, '[data-testid="crop-ratio-preset-original"]');
    const historyBeforeRotate = useEditorStore.getState().history.length;
    await clickControl(container, '[data-testid="crop-panel-rotate-right"]');
    expect(useEditorStore.getState().adjustments).toMatchObject({ aspectRatio: 3 / 4, orientationSteps: 1 });
    expect(useEditorStore.getState().history).toHaveLength(historyBeforeRotate + 1);

    act(() => root.unmount());
    container.remove();
    renderedRoot = null;
    expect(useEditorStore.getState().liveRotation).toBeNull();
  });
});

async function renderCropPanel() {
  installDom();
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const i18n = await createTestI18n();

  await act(async () => {
    root.render(
      createElement(I18nextProvider, { i18n }, createElement(ContextMenuProvider, null, createElement(CropPanel))),
    );
    await flush();
  });

  renderedRoot = { container, root };
  return { container, root };
}

function resetStores() {
  useEditorStore.setState({
    adjustments: INITIAL_ADJUSTMENTS,
    history: [INITIAL_ADJUSTMENTS],
    historyCheckpoints: [],
    historyIndex: 0,
    isStraightenActive: false,
    overlayMode: 'thirds',
    overlayRotation: 0,
    selectedImage: null,
    showOriginal: false,
  });
  useUIStore.setState({ activeRightPanel: Panel.Adjustments, renderedRightPanel: Panel.Adjustments });
}

function required<T extends Element>(container: Element, selector: string): T {
  const element = container.querySelector<T>(selector);
  if (element === null) throw new Error(`Expected ${selector} to render.`);
  return element;
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function clickControl(container: Element, selector: string) {
  await act(async () => {
    required<HTMLButtonElement>(container, selector).click();
    await flush();
    await flush();
  });
}

async function setElementValue(input: HTMLInputElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  if (valueSetter === undefined) throw new Error('Expected input value setter.');
  await act(async () => {
    valueSetter.call(input, value);
    const reactPropsKey = Object.keys(input).find((key) => key.startsWith('__reactProps$'));
    if (reactPropsKey === undefined) throw new Error('Expected React input props.');
    const reactProps = Reflect.get(input, reactPropsKey) as {
      onChange?: (event: { currentTarget: HTMLInputElement; target: HTMLInputElement }) => void;
    };
    reactProps.onChange?.({ currentTarget: input, target: input });
    await flush();
  });
}

function installDom() {
  const window = new Window({ url: 'http://localhost/crop-panel-test' });
  Object.assign(globalThis, {
    document: window.document,
    Event: window.Event,
    HTMLElement: window.HTMLElement,
    HTMLInputElement: window.HTMLInputElement,
    KeyboardEvent: window.KeyboardEvent,
    navigator: window.navigator,
    window,
  });
}

async function createTestI18n() {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    defaultNS: 'translation',
    interpolation: { escapeValue: false },
    lng: 'en',
    react: { useSuspense: false },
    resources: { en: { translation: en } },
  });
  return instance;
}
