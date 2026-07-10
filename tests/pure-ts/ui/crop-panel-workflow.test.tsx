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
import { useEditorStore } from '../../../src/store/useEditorStore.ts';
import { useUIStore } from '../../../src/store/useUIStore.ts';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments.ts';

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
    expect(container.querySelector('[data-testid="crop-panel-actions"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-testid="crop-panel-ratio-section"] button').length).toBeGreaterThan(10);

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
    await act(async () => {
      const height = required<HTMLInputElement>(container, 'input[name="customH"]');
      height.focus();
      height.blur();
      await flush();
    });

    expect(required<HTMLElement>(container, '#crop-custom-ratio-error').textContent).toContain('greater than zero');
    expect(required<HTMLInputElement>(container, 'input[name="customW"]').getAttribute('aria-invalid')).toBe('true');
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

function installDom() {
  const window = new Window({ url: 'http://localhost/crop-panel-test' });
  Object.assign(globalThis, {
    document: window.document,
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
