import { afterEach, describe, expect, test } from 'bun:test';
import { act, fireEvent, render } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import i18next from 'i18next';
import { createElement } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import CropPanel from '../../../src/components/panel/right/color/CropPanel.tsx';
import { Panel, type SelectedImage } from '../../../src/components/ui/AppProperties.tsx';
import { ContextMenuProvider } from '../../../src/context/ContextMenuContext.tsx';
import en from '../../../src/i18n/locales/en.json';
import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore.ts';
import { useUIStore } from '../../../src/store/useUIStore.ts';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments.ts';
import { legacyAdjustmentsToEditDocumentV2 } from '../../../src/utils/editDocumentV2.ts';

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

afterEach(() => {
  act(resetStores);
});

describe('crop panel workflow', () => {
  test('uses compact controls and restores a canceled live crop through the existing history contract', async () => {
    const initial = { ...INITIAL_ADJUSTMENTS, aspectRatio: 3 / 2 };
    const initialDocument = legacyAdjustmentsToEditDocumentV2(initial);
    useEditorStore.getState().hydrateEditorRenderAuthority({
      historyCheckpoints: [],
      historyIndex: 0,
      isStraightenActive: false,
      overlayMode: 'thirds',
      overlayRotation: 0,
      selectedImage,
      showOriginal: false,
      editDocumentV2: initialDocument,
      history: [initialDocument],
    });
    useUIStore.setState({ activeRightPanel: Panel.Crop, renderedRightPanel: Panel.Crop });

    const { container, user } = await renderCropPanel();
    const panel = required<HTMLElement>(container, '[data-testid="crop-panel-status"]');
    expect(panel.dataset.cropDirty).toBe('false');
    expect(required<HTMLElement>(container, '[data-crop-panel-density="compact"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="crop-panel-actions"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-testid="crop-panel-ratio-section"] button').length).toBeGreaterThan(10);
    expect(container.querySelector('[data-testid="crop-panel-overlay-section"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="crop-panel-geometry-section"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="crop-panel-transform-entry"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="crop-panel-lens-entry"]')).not.toBeNull();

    await user.click(required<HTMLButtonElement>(container, '[data-testid="crop-ratio-preset-5-4"]'));

    expect(useEditorStore.getState().adjustmentSnapshot.value.aspectRatio).toBe(5 / 4);
    expect(required<HTMLElement>(container, '[data-testid="crop-panel-status"]').dataset.cropDirty).toBe('true');

    const cancel = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === 'Cancel',
    );
    if (cancel === undefined) throw new Error('Expected Crop cancel action.');
    await user.click(cancel);

    expect(useEditorStore.getState().adjustmentSnapshot.value.aspectRatio).toBe(3 / 2);
    expect(useEditorStore.getState().history).toHaveLength(3);
    expect(useEditorStore.getState().history.at(-1)).toEqual(initialDocument);
    expect(useEditorStore.getState().historyIndex).toBe(2);
    expect(useUIStore.getState().activeRightPanel).toBe(Panel.Adjustments);
  });

  test('keeps invalid custom ratios visible and inaccessible to the crop model', async () => {
    const editDocumentV2 = legacyAdjustmentsToEditDocumentV2({ ...INITIAL_ADJUSTMENTS, aspectRatio: 3 / 2 });
    useEditorStore.getState().hydrateEditorRenderAuthority({
      historyCheckpoints: [],
      historyIndex: 0,
      selectedImage,
      editDocumentV2,
      history: [editDocumentV2],
    });

    const { container, user } = await renderCropPanel();
    await user.click(required<HTMLButtonElement>(container, '[data-testid="crop-ratio-preset-custom"]'));
    const width = required<HTMLInputElement>(container, 'input[name="customW"]');
    const height = required<HTMLInputElement>(container, 'input[name="customH"]');
    await user.clear(width);
    await user.clear(height);
    await user.tab();

    expect(required<HTMLElement>(container, '#crop-custom-ratio-error').textContent).toContain('greater than zero');
    expect(required<HTMLInputElement>(container, 'input[name="customW"]').getAttribute('aria-invalid')).toBe('true');
  });

  test('binds the compact groups to crop state and keyboard overlay cycling', async () => {
    const adjustments = { ...INITIAL_ADJUSTMENTS, aspectRatio: 3 / 2, rotation: 3 };
    const editDocumentV2 = legacyAdjustmentsToEditDocumentV2(adjustments);
    useEditorStore.getState().hydrateEditorRenderAuthority({
      adjustmentRevision: 0,
      historyCheckpoints: [],
      historyIndex: 0,
      imageSession: createEditorImageSession({ generation: 1, path: selectedImage.path, source: 'cache' }),
      isStraightenActive: false,
      lastEditApplicationReceipt: null,
      overlayMode: 'goldenSpiral',
      overlayRotation: 0,
      selectedImage,
      editDocumentV2,
      history: [editDocumentV2],
    });
    useUIStore.setState({ activeRightPanel: Panel.Crop, renderedRightPanel: Panel.Crop });

    const { container, user } = await renderCropPanel();

    await clickControl(user, container, '[data-testid="crop-panel-ratio-orientation-toggle"]');
    await clickControl(user, container, '[data-testid="crop-panel-flip-horizontal"]');
    await clickControl(user, container, '[data-testid="crop-panel-rotate-right"]');
    await clickControl(user, container, '[data-testid="crop-panel-straighten-toggle"]');
    await clickControl(user, container, '[data-testid="crop-panel-overlay-rotate"]');
    fireEvent.keyDown(window, { key: 'o' });

    expect(useEditorStore.getState().adjustmentSnapshot.value).toMatchObject({
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
    const editDocumentV2 = legacyAdjustmentsToEditDocumentV2({ ...INITIAL_ADJUSTMENTS, aspectRatio: 1.7 });
    useEditorStore.getState().hydrateEditorRenderAuthority({
      historyCheckpoints: [],
      historyIndex: 0,
      selectedImage,
      editDocumentV2,
      history: [editDocumentV2],
    });
    const { container, user } = await renderCropPanel();
    const width = required<HTMLInputElement>(container, 'input[name="customW"]');
    expect(width.value).toBe('170');

    await user.clear(width);
    await user.type(width, '200');
    act(() => {
      useEditorStore.setState({ overlayRotation: 2 });
    });
    expect(required<HTMLInputElement>(container, 'input[name="customW"]').value).toBe('200');

    width.focus();
    await user.keyboard('{Escape}');
    expect(required<HTMLInputElement>(container, 'input[name="customW"]').value).toBe('170');

    act(() => {
      const switchedDocument = legacyAdjustmentsToEditDocumentV2({ ...INITIAL_ADJUSTMENTS, aspectRatio: 0.83 });
      useEditorStore.getState().hydrateEditorRenderAuthority({
        selectedImage: { ...selectedImage, path: '/validation/crop-workflow-b.ARW' },
        editDocumentV2: switchedDocument,
        history: [switchedDocument],
        historyIndex: 0,
      });
    });
    expect(required<HTMLInputElement>(container, 'input[name="customW"]').value).toBe('83');
    expect(required<HTMLInputElement>(container, 'input[name="customH"]').value).toBe('100');
  });

  test('rotates Original in one canonical history update and clears live rotation on teardown', async () => {
    const initial = { ...INITIAL_ADJUSTMENTS, aspectRatio: 4 / 3, orientationSteps: 0, rotation: 4 };
    const initialDocument = legacyAdjustmentsToEditDocumentV2(initial);
    useEditorStore.getState().hydrateEditorRenderAuthority({
      historyCheckpoints: [],
      historyIndex: 0,
      liveRotation: 8,
      selectedImage,
      editDocumentV2: initialDocument,
      history: [initialDocument],
    });
    const { container, unmount, user } = await renderCropPanel();
    await clickControl(user, container, '[data-testid="crop-panel-straighten-toggle"]');
    expect(useEditorStore.getState().adjustmentSnapshot.value.rotation).toBe(0);
    await clickControl(user, container, '[data-testid="crop-ratio-preset-original"]');
    const historyBeforeRotate = useEditorStore.getState().history.length;
    await clickControl(user, container, '[data-testid="crop-panel-rotate-right"]');
    expect(useEditorStore.getState().adjustmentSnapshot.value).toMatchObject({
      aspectRatio: 3 / 4,
      orientationSteps: 1,
    });
    expect(useEditorStore.getState().history).toHaveLength(historyBeforeRotate + 1);

    unmount();
    expect(useEditorStore.getState().liveRotation).toBeNull();
  });
});

async function renderCropPanel() {
  const i18n = await createTestI18n();
  const user = userEvent.setup();
  const rendered = render(
    createElement(I18nextProvider, { i18n }, createElement(ContextMenuProvider, null, createElement(CropPanel))),
  );
  return { ...rendered, user };
}

function resetStores() {
  const editDocumentV2 = legacyAdjustmentsToEditDocumentV2(INITIAL_ADJUSTMENTS);
  useEditorStore.getState().hydrateEditorRenderAuthority({
    historyCheckpoints: [],
    historyIndex: 0,
    isStraightenActive: false,
    overlayMode: 'thirds',
    overlayRotation: 0,
    selectedImage: null,
    showOriginal: false,
    editDocumentV2,
    history: [editDocumentV2],
  });
  useUIStore.setState({ activeRightPanel: Panel.Adjustments, renderedRightPanel: Panel.Adjustments });
}

function required<T extends Element>(container: Element, selector: string): T {
  const element = container.querySelector<T>(selector);
  if (element === null) throw new Error(`Expected ${selector} to render.`);
  return element;
}

async function clickControl(user: UserEvent, container: Element, selector: string) {
  await user.click(required<HTMLButtonElement>(container, selector));
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
