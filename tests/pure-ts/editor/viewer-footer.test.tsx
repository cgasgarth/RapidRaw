import { afterEach, describe, expect, test } from 'bun:test';
import { act, render } from '@testing-library/react';
import i18next from 'i18next';
import { createElement } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import ViewerFooter from '../../../src/components/panel/editor/ViewerFooter.tsx';
import type { ViewerActiveTool } from '../../../src/components/panel/editor/viewerInputResolver.ts';
import type { ImageFile, SelectedImage } from '../../../src/components/ui/AppProperties.tsx';
import en from '../../../src/i18n/locales/en.json';
import { useEditorStore } from '../../../src/store/useEditorStore.ts';
import { useLibraryStore } from '../../../src/store/useLibraryStore.ts';
import type { PreviewQualityStatus } from '../../../src/utils/adaptivePreviewQuality.ts';

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
const libraryImage: ImageFile = {
  exif: null,
  is_edited: false,
  is_virtual_copy: false,
  modified: 0,
  path: selectedImage.path,
  rating: 0,
  tags: null,
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

afterEach(() => {
  act(() => {
    useEditorStore.getState().hydrateEditorRenderAuthority({
      compare: {
        dividerPosition: 0.5,
        isOriginalHeld: false,
        labelsVisible: true,
        mode: 'off',
        orientation: 'vertical',
        source: { identity: null, kind: 'original' },
        synchronizedTransform: 'locked',
      },
      previewQualityStatus: null,
      selectedImage: null,
      zoomMode: { kind: 'fit' },
      editDocumentV2: useEditorStore.getState().editDocumentV2,
      history: [useEditorStore.getState().editDocumentV2],
      historyIndex: 0,
    });
    useLibraryStore.setState({ imageList: [], multiSelectedPaths: [] });
  });
});

describe('viewer footer', () => {
  test('keeps stable zones, moves secondary status into overflow, and remains focusable in fullscreen', async () => {
    prepareStores();
    const { container } = await renderFooter({ activeTool: 'crop', isFullScreen: true });

    const footer = container.querySelector<HTMLElement>('[data-testid="viewer-footer"]');
    expect(footer?.dataset['fullscreen']).toBe('true');
    expect(footer?.dataset['density']).toBe('compact');
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
    expect(status()?.dataset['phase']).toBe('interactive');
    expect(live()?.getAttribute('aria-live')).toBeNull();

    act(() => useEditorStore.getState().setEditor({ previewQualityStatus: quality('final_ready') }));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 40)));
    expect(status()?.dataset['phase']).toBe('interactive');
    await act(async () => new Promise((resolve) => setTimeout(resolve, 180)));
    expect(status()?.dataset['phase']).toBe('coherent');

    act(() => useEditorStore.getState().setEditor({ previewQualityStatus: quality('degraded_limited') }));
    expect(status()?.dataset['phase']).toBe('degraded');
    expect(live()?.getAttribute('aria-live')).toBe('assertive');
    expect(live()?.getAttribute('role')).toBe('alert');
  });

  test('wires Lightroom viewer actions to compare, zoom, proof, and geometry authority', async () => {
    prepareStores();
    const calls: string[] = [];
    const { container } = await renderFooter({
      onFlip: (axis) => calls.push(`flip:${axis}`),
      onRotate: (degrees) => calls.push(`rotate:${String(degrees)}`),
    });

    act(() => container.querySelector<HTMLButtonElement>('[data-testid="viewer-toolbar-before-after"]')?.click());
    expect(useEditorStore.getState().compare.mode).toBe('hold-original');
    act(() => container.querySelector<HTMLButtonElement>('[data-testid="viewer-toolbar-original"]')?.click());
    expect(useEditorStore.getState().compare.mode).toBe('off');
    act(() => container.querySelector<HTMLButtonElement>('[data-testid="viewer-toolbar-soft-proof"]')?.click());
    expect(useEditorStore.getState().isExportSoftProofEnabled).toBe(true);
    act(() => container.querySelector<HTMLButtonElement>('[data-testid="viewer-toolbar-loupe"]')?.click());
    expect(useEditorStore.getState().zoomMode).toEqual({ kind: 'fit' });
    act(() => container.querySelector<HTMLButtonElement>('[data-testid="viewer-toolbar-rotate-left"]')?.click());
    act(() => container.querySelector<HTMLButtonElement>('[data-testid="viewer-toolbar-flip-horizontal"]')?.click());
    expect(calls).toEqual(['rotate:-90', 'flip:horizontal']);
  });
});

function prepareStores(previewQualityStatus: PreviewQualityStatus | null = null) {
  useEditorStore.getState().setEditor({ isExportSoftProofEnabled: false, selectedImage, zoomMode: resolvedZoom.mode });
  useEditorStore.getState().setEditor({ previewQualityStatus });
  useLibraryStore.setState({ imageList: [libraryImage], multiSelectedPaths: [selectedImage.path] });
}

async function renderFooter({
  activeTool = 'none',
  isFullScreen = false,
  isRendering = false,
  onFlip,
  onRotate,
}: {
  activeTool?: ViewerActiveTool;
  isFullScreen?: boolean;
  isRendering?: boolean;
  onFlip?: (axis: 'horizontal' | 'vertical') => void;
  onRotate?: (degrees: number) => void;
}) {
  const i18n = i18next.createInstance();
  await i18n.use(initReactI18next).init({
    interpolation: { escapeValue: false },
    lng: 'en',
    resources: { en: { translation: en } },
  });
  const view = render(
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
        ...(onFlip === undefined ? {} : { onFlip }),
        ...(onRotate === undefined ? {} : { onRotate }),
      }),
    ),
  );
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  return view;
}
