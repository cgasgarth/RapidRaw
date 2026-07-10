import { afterEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import i18next from 'i18next';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import ViewerFooter from '../../../src/components/panel/editor/ViewerFooter.tsx';
import type { ViewerActiveTool } from '../../../src/components/panel/editor/viewerInputResolver.ts';
import type { SelectedImage } from '../../../src/components/ui/AppProperties.tsx';
import en from '../../../src/i18n/locales/en.json';
import { useEditorStore } from '../../../src/store/useEditorStore.ts';
import { useLibraryStore } from '../../../src/store/useLibraryStore.ts';
import type { PreviewQualityStatus } from '../../../src/utils/adaptivePreviewQuality.ts';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments.ts';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const selectedImage: SelectedImage = {
  exif: null,
  height: 4000,
  isRaw: true,
  isReady: true,
  metadata: null,
  originalUrl: null,
  path: '/photos/alaska.ARW',
  rawDevelopmentReport: null,
  thumbnailUrl: 'data:image/jpeg;base64,AAAA',
  width: 6000,
};
const resolvedZoom = {
  cssPercent: 100,
  devicePixelsPerImagePixel: 1,
  displayPercent: 100,
  imagePixelsPerCssPixel: 1,
  imagePixelsPerDevicePixel: 1,
  mode: { devicePixelsPerImagePixel: 1, kind: 'ratio' as const },
  requiredPreviewResolution: 4096,
  transformScale: 1,
};
const quality = (phase: PreviewQualityStatus['phase']): PreviewQualityStatus => ({
  backend: 'wgpu',
  effectiveRoi: null,
  effectiveTargetResolution: 4096,
  estimatedWorkingBytes: 1,
  generation: 1,
  limitedBy: phase === 'degraded_limited' ? 'memory' : null,
  phase,
  reason: 'test',
  requestId: 1,
  requestedTargetResolution: 4096,
  sufficientForSemanticZoom: phase !== 'degraded_limited',
  tier: phase === 'detail_ready' ? 'inspection_1to1' : 'viewport_full',
});

let rendered: { container: HTMLDivElement; root: Root } | null = null;

afterEach(() => {
  if (rendered) {
    act(() => rendered?.root.unmount());
    rendered.container.remove();
    rendered = null;
  }
  useEditorStore.getState().setEditor({
    adjustments: INITIAL_ADJUSTMENTS,
    compare: { dividerPosition: 0.5, isOriginalHeld: false, labelsVisible: true, mode: 'off', orientation: 'vertical' },
    previewQualityStatus: null,
    selectedImage: null,
    zoomMode: { kind: 'fit' },
  });
  useLibraryStore.setState({ imageList: [], multiSelectedPaths: [] });
});

describe('viewer footer', () => {
  test('keeps stable zones, moves secondary status into overflow, and remains focusable in fullscreen', async () => {
    prepareStores();
    const { container } = await renderFooter({ activeTool: 'crop', isFullScreen: true });

    const footer = container.querySelector<HTMLElement>('[data-testid="viewer-footer"]');
    expect(footer?.dataset.fullscreen).toBe('true');
    expect(footer?.dataset.density).toBe('compact');
    expect(container.querySelector('[data-testid="viewer-footer-left"]')?.textContent).toContain('1 of 1');
    expect(container.querySelector('[data-testid="viewer-footer-tool-hint"]')?.textContent).toContain('Enter applies');
    expect(container.querySelector('[data-testid="viewer-footer-overflow"]')).not.toBeNull();

    const zoomIn = container.querySelector<HTMLButtonElement>('button[aria-label="Zoom in"]');
    act(() => zoomIn?.focus());
    expect(document.activeElement).toBe(zoomIn);
  });

  test('routes selector and step controls through semantic zoom commands', async () => {
    prepareStores();
    const { container } = await renderFooter({});
    const select = container.querySelector<HTMLSelectElement>('[data-testid="viewer-footer-zoom-select"]');
    if (!select) throw new Error('Expected zoom selector');

    act(() => {
      select.value = 'two-to-one';
      const EventConstructor = select.ownerDocument.defaultView?.Event;
      if (!EventConstructor) throw new Error('Expected DOM Event constructor');
      select.dispatchEvent(new EventConstructor('change', { bubbles: true }));
    });
    expect(useEditorStore.getState().zoomMode).toEqual({ devicePixelsPerImagePixel: 2, kind: 'ratio' });

    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Zoom out"]')?.click());
    expect(useEditorStore.getState().zoomMode).toEqual({ devicePixelsPerImagePixel: 2 / 3, kind: 'ratio' });
  });

  test('coalesces routine completion and announces only meaningful boundaries', async () => {
    prepareStores(quality('rendering_interaction'));
    const { container } = await renderFooter({ isRendering: true });
    const status = () => container.querySelector<HTMLElement>('[data-testid="viewer-footer-render-status"]');
    const live = () => container.querySelector<HTMLElement>('[data-testid="viewer-footer-live-region"]');
    expect(status()?.dataset.phase).toBe('interactive');
    expect(live()?.getAttribute('aria-live')).toBeNull();

    act(() => useEditorStore.getState().setEditor({ previewQualityStatus: quality('final_ready') }));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 40)));
    expect(status()?.dataset.phase).toBe('interactive');
    await act(async () => new Promise((resolve) => setTimeout(resolve, 180)));
    expect(status()?.dataset.phase).toBe('coherent');

    act(() => useEditorStore.getState().setEditor({ previewQualityStatus: quality('degraded_limited') }));
    expect(status()?.dataset.phase).toBe('degraded');
    expect(live()?.getAttribute('aria-live')).toBe('assertive');
    expect(live()?.getAttribute('role')).toBe('alert');
  });
});

function prepareStores(previewQualityStatus: PreviewQualityStatus | null = null) {
  useEditorStore.getState().setEditor({ selectedImage, zoomMode: resolvedZoom.mode });
  useEditorStore.getState().setEditor({ previewQualityStatus });
  useLibraryStore.setState({ imageList: [selectedImage], multiSelectedPaths: [selectedImage.path] });
}

async function renderFooter({
  activeTool = 'none',
  isFullScreen = false,
  isRendering = false,
}: {
  activeTool?: ViewerActiveTool;
  isFullScreen?: boolean;
  isRendering?: boolean;
}) {
  if (!globalThis.window) {
    const window = new Window();
    Object.assign(globalThis, {
      document: window.document,
      Event: window.Event,
      HTMLElement: window.HTMLElement,
      window,
    });
  }
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const i18n = i18next.createInstance();
  await i18n.use(initReactI18next).init({
    interpolation: { escapeValue: false },
    lng: 'en',
    resources: { en: { translation: en } },
  });
  rendered = { container, root };
  await act(async () => {
    root.render(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(ViewerFooter, {
          activeTool,
          isFullScreen,
          isRendering,
          resolvedZoom,
          samplerState: null,
          zoomResolutionState: 'ready',
        }),
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return { container, root };
}
