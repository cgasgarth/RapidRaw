import { afterEach, describe, expect, test } from 'bun:test';
import { act, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { createElement } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import { CropOverlaySurface } from '../../../src/components/panel/editor/CropOverlaySurface.tsx';
import CropPanel from '../../../src/components/panel/right/color/CropPanel.tsx';
import { Panel, type SelectedImage } from '../../../src/components/ui/AppProperties.tsx';
import { ContextMenuProvider } from '../../../src/context/ContextMenuContext.tsx';
import en from '../../../src/i18n/locales/en.json';
import { useEditorStore } from '../../../src/store/useEditorStore.ts';
import { useUIStore } from '../../../src/store/useUIStore.ts';
import { createDefaultEditDocumentV2, patchEditDocumentV2Node } from '../../../src/utils/editDocumentV2.ts';

const selectedImage: SelectedImage = {
  exif: null,
  height: 3000,
  isRaw: true,
  isReady: true,
  metadata: null,
  originalUrl: null,
  path: '/validation/lightroom-crop.ARW',
  rawDevelopmentReport: null,
  thumbnailUrl: 'data:image/jpeg;base64,AAAA',
  width: 4000,
};

afterEach(() => {
  act(() => {
    const editDocumentV2 = createDefaultEditDocumentV2();
    useEditorStore.getState().hydrateEditorRenderAuthority({
      cropDraft: null,
      editDocumentV2,
      history: [editDocumentV2],
      historyIndex: 0,
      overlayMode: 'thirds',
      overlayRotation: 0,
      selectedImage: null,
    });
    useUIStore.setState({ activeRightPanel: Panel.Adjustments, renderedRightPanel: Panel.Adjustments });
  });
});

describe('Lightroom Crop canvas-first draft workflow', () => {
  test('keeps controls out of committed history until Done, then creates one undoable entry', async () => {
    const initial = patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'geometry', { aspectRatio: 3 / 2 });
    useEditorStore.getState().hydrateEditorRenderAuthority({
      editDocumentV2: initial,
      history: [initial],
      historyIndex: 0,
      selectedImage,
    });
    useUIStore.setState({ activeRightPanel: Panel.Crop, renderedRightPanel: Panel.Crop });

    const { container, unmount } = await renderCropPanel();
    const user = userEvent.setup();
    await user.click(required<HTMLButtonElement>(container, '[data-testid="crop-ratio-preset-16-9"]'));

    expect(useEditorStore.getState().editDocumentV2.geometry.aspectRatio).toBe(3 / 2);
    expect(useEditorStore.getState().cropDraft?.geometry.aspectRatio).toBeCloseTo(16 / 9);
    expect(useEditorStore.getState().history).toHaveLength(1);

    await user.click(buttonByText(container, 'Apply'));
    expect(useEditorStore.getState().editDocumentV2.geometry.aspectRatio).toBeCloseTo(16 / 9);
    expect(useEditorStore.getState().history).toHaveLength(2);
    expect(useEditorStore.getState().cropDraft).toBeNull();

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().editDocumentV2.geometry.aspectRatio).toBe(3 / 2);
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().editDocumentV2.geometry.aspectRatio).toBeCloseTo(16 / 9);
    unmount();
  });

  test('cancels the draft without changing geometry, overlays, or history', async () => {
    const initial = patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'geometry', {
      aspectRatio: 4 / 3,
      rotation: 2,
    });
    useEditorStore.getState().hydrateEditorRenderAuthority({
      editDocumentV2: initial,
      history: [initial],
      historyIndex: 0,
      overlayMode: 'goldenSpiral',
      overlayRotation: 2,
      selectedImage,
    });
    useUIStore.setState({ activeRightPanel: Panel.Crop, renderedRightPanel: Panel.Crop });

    const { container, unmount } = await renderCropPanel();
    const user = userEvent.setup();
    await user.click(required<HTMLButtonElement>(container, '[data-testid="crop-ratio-preset-1-1"]'));
    await user.click(required<HTMLButtonElement>(container, '[data-testid="crop-panel-overlay-cycle"]'));
    await user.click(buttonByText(container, 'Cancel'));

    expect(useEditorStore.getState().editDocumentV2.geometry).toEqual(initial.geometry);
    expect(useEditorStore.getState().overlayMode).toBe('goldenSpiral');
    expect(useEditorStore.getState().overlayRotation).toBe(2);
    expect(useEditorStore.getState().history).toHaveLength(1);
    unmount();
  });

  test('renders a dense canvas selection frame and eight accessible-size handles', async () => {
    const i18n = await createTestI18n();
    const { container } = render(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(CropOverlaySurface, {
          aspectRatio: 16 / 9,
          crop: { height: 64, unit: '%', width: 68, x: 16, y: 18 },
          cropImageRef: { current: null },
          cropImageTransform: 'none',
          cropPreviewUrl: 'data:image/png;base64,AAAA',
          descriptor: {
            ariaLabel: 'crop geometry',
            geometryEpoch: 7,
            id: 'crop-geometry:4',
            kind: 'crop-geometry',
            pointerPolicy: 'capture',
            renderSize: { height: 405, width: 720 },
            sessionFingerprint: 'crop-session',
            sessionKey: {
              geometryEpoch: 7,
              imageSessionId: 'session-1',
              operationGeneration: 4,
              sourceIdentity: '/validation/lightroom-crop.ARW',
              sourceRevision: 'graph-1',
              tool: 'crop',
            },
            straightenLine: null,
            tool: 'crop',
            zOrder: 'tool-geometry',
          },
          handleCropComplete: () => undefined,
          isCropping: true,
          isCropViewVisible: true,
          isMaxZoom: false,
          isRotationActive: false,
          isStraightenActive: false,
          isTemporaryHand: false,
          onCropPreviewError: () => undefined,
          onCropPreviewLoad: () => undefined,
          overlayMode: 'thirds',
          overlayRotation: 0,
          setCrop: () => undefined,
        }),
      ),
    );

    expect(container.querySelector('[data-testid="crop-canvas-handles"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-testid="crop-canvas-handles"] circle')).toHaveLength(8);
    expect(container.querySelector('[data-crop-selection-active="true"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="composition-overlays"]')).not.toBeNull();
  });
});

async function renderCropPanel() {
  const i18n = i18next.createInstance();
  await i18n.use(initReactI18next).init({
    defaultNS: 'translation',
    interpolation: { escapeValue: false },
    lng: 'en',
    react: { useSuspense: false },
    resources: { en: { translation: en } },
  });
  const rendered = render(
    createElement(I18nextProvider, { i18n }, createElement(ContextMenuProvider, null, createElement(CropPanel))),
  );
  await act(async () => {
    await Promise.resolve();
  });
  return rendered;
}

async function createTestI18n() {
  const i18n = i18next.createInstance();
  await i18n.use(initReactI18next).init({
    defaultNS: 'translation',
    interpolation: { escapeValue: false },
    lng: 'en',
    react: { useSuspense: false },
    resources: { en: { translation: en } },
  });
  return i18n;
}

function required<T extends Element>(container: Element, selector: string): T {
  const element = container.querySelector<T>(selector);
  if (element === null) throw new Error(`Expected ${selector} to render.`);
  return element;
}

function buttonByText(container: Element, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
    (candidate) => candidate.textContent?.includes(text) === true,
  );
  if (button === undefined) throw new Error(`Expected button ${text}.`);
  return button;
}
