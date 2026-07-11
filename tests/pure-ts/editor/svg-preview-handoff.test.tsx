import { afterEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act, createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';

import { SvgPreviewHandoff } from '../../../src/components/panel/editor/SvgPreviewHandoff.tsx';
import type { InteractivePatch } from '../../../src/store/useEditorStore.ts';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let renderedRoot: { container: HTMLDivElement; root: Root } | null = null;

interface HandoffRenderInput {
  baseSource: string;
  incomingPatch: InteractivePatch | null;
}

afterEach(() => {
  if (renderedRoot !== null) {
    act(() => {
      renderedRoot?.root.unmount();
    });
    renderedRoot.container.remove();
    renderedRoot = null;
  }
});

test('keeps rendered predecessor and successor SVG base layers until successor opacity handoff completes', async () => {
  const rendered = renderHandoff({ baseSource: 'blob:base-a', incomingPatch: null });
  expect(baseSources(rendered.container)).toEqual(['blob:base-a']);

  rendered.render({ baseSource: 'blob:base-b', incomingPatch: null });
  expect(baseSources(rendered.container)).toEqual(['blob:base-a', 'blob:base-b']);

  await loadLayer(rendered.container, 'svg-preview-base-layer', 'blob:base-b');
  expect(baseSources(rendered.container)).toEqual(['blob:base-a', 'blob:base-b']);

  await finishOpacityHandoff(rendered.container, 'svg-preview-base-layer', 'blob:base-b');
  expect(baseSources(rendered.container)).toEqual(['blob:base-b']);
  expect(rendered.released).toContain('base:/photo.ARW:blob:base-a:blob:base-a');
});

test('discards stale and failed SVG successors while preserving the painted predecessor', async () => {
  const rendered = renderHandoff({ baseSource: 'blob:base-a', incomingPatch: null });
  rendered.render({ baseSource: 'blob:base-b', incomingPatch: null });
  rendered.render({ baseSource: 'blob:base-c', incomingPatch: null });

  expect(baseSources(rendered.container)).toEqual(['blob:base-a', 'blob:base-c']);
  expect(rendered.released).toContain('base:/photo.ARW:blob:base-b:blob:base-b');

  await failLayer(rendered.container, 'svg-preview-base-layer', 'blob:base-c');
  expect(baseSources(rendered.container)).toEqual(['blob:base-a']);
  expect(rendered.released).toContain('base:/photo.ARW:blob:base-c:blob:base-c');
});

test('retains an interactive patch until the decoded final SVG layer begins its opacity handoff', async () => {
  const interactivePatch = patch('blob:patch-a');
  const rendered = renderHandoff({ baseSource: 'blob:base-a', incomingPatch: interactivePatch });

  await loadLayer(rendered.container, 'svg-preview-patch-layer', 'blob:patch-a');
  await finishOpacityHandoff(rendered.container, 'svg-preview-patch-layer', 'blob:patch-a');
  expect(patchSources(rendered.container)).toEqual(['blob:patch-a']);

  rendered.render({ baseSource: 'blob:base-final', incomingPatch: null });
  expect(baseSources(rendered.container)).toEqual(['blob:base-a', 'blob:base-final']);
  expect(patchSources(rendered.container)).toEqual(['blob:patch-a']);

  await loadLayer(rendered.container, 'svg-preview-base-layer', 'blob:base-final');
  await act(async () => {
    await flushAnimationFrames();
  });
  expect(patchSources(rendered.container)).toEqual(['blob:patch-a']);

  await finishOpacityHandoff(rendered.container, 'svg-preview-base-layer', 'blob:base-final');
  await finishOpacityHandoff(rendered.container, 'svg-preview-patch-layer', 'blob:patch-a');

  expect(baseSources(rendered.container)).toEqual(['blob:base-final']);
  expect(patchSources(rendered.container)).toEqual([]);
});

test('retires the predecessor after a two-frame paint fence when reduced motion disables transitions', async () => {
  const rendered = renderHandoff({ baseSource: 'blob:base-a', incomingPatch: null, reducedMotion: true });
  rendered.render({ baseSource: 'blob:base-b', incomingPatch: null, reducedMotion: true });

  await loadLayer(rendered.container, 'svg-preview-base-layer', 'blob:base-b');
  await act(async () => {
    await flushAnimationFrames();
  });

  expect(baseSources(rendered.container)).toEqual(['blob:base-b']);
});

test('keeps SVG layer ownership while WGPU temporarily hides the CPU preview', async () => {
  const rendered = renderHandoff({ baseSource: 'blob:base-a', incomingPatch: null, isCpuPreviewVisible: false });
  expect(baseSources(rendered.container)).toEqual([]);

  rendered.render({ baseSource: 'blob:base-b', incomingPatch: null, isCpuPreviewVisible: false });
  expect(baseSources(rendered.container)).toEqual([]);

  rendered.render({ baseSource: 'blob:base-b', incomingPatch: null, isCpuPreviewVisible: true });
  expect(baseSources(rendered.container)).toEqual(['blob:base-a', 'blob:base-b']);

  await loadLayer(rendered.container, 'svg-preview-base-layer', 'blob:base-b');
  await finishOpacityHandoff(rendered.container, 'svg-preview-base-layer', 'blob:base-b');
  expect(baseSources(rendered.container)).toEqual(['blob:base-b']);
});

function patch(url: string): InteractivePatch {
  return {
    basePreviewUrl: 'blob:base-a',
    fullHeight: 100,
    fullWidth: 200,
    geometryIdentity: 'geometry',
    normH: 0.5,
    normW: 0.5,
    normX: 0.1,
    normY: 0.1,
    pixelHeight: 50,
    pixelWidth: 100,
    sourceImagePath: '/photo.ARW',
    url,
  };
}

function renderHandoff({
  baseSource,
  incomingPatch,
  isCpuPreviewVisible = true,
  reducedMotion = false,
}: HandoffRenderInput & { isCpuPreviewVisible?: boolean; reducedMotion?: boolean }) {
  installDom();
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const released: string[] = [];

  const render = ({
    baseSource: nextBaseSource,
    incomingPatch: nextIncomingPatch,
    isCpuPreviewVisible: nextIsCpuPreviewVisible = true,
    reducedMotion: nextReducedMotion = false,
  }: HandoffRenderInput & { isCpuPreviewVisible?: boolean; reducedMotion?: boolean }) => {
    act(() => {
      flushSync(() => {
        root.render(
          createElement(
            'svg',
            null,
            createElement(SvgPreviewHandoff, {
              baseScopeKey: '/photo.ARW',
              baseSource: nextBaseSource,
              incomingPatch: nextIncomingPatch,
              isCpuPreviewVisible: nextIsCpuPreviewVisible,
              isMaxZoom: false,
              patchScopeKey: '/photo.ARW:geometry',
              reducedMotion: nextReducedMotion,
              releaseUrl: (owner: string, url: string) => released.push(`${owner}:${url}`),
              retainUrl: () => {},
            }),
          ),
        );
      });
    });
  };

  render({ baseSource, incomingPatch, isCpuPreviewVisible, reducedMotion });
  renderedRoot = { container, root };
  return { container, released, render };
}

function baseSources(container: Element): string[] {
  return sources(container, 'svg-preview-base-layer');
}

function patchSources(container: Element): string[] {
  return sources(container, 'svg-preview-patch-layer');
}

function sources(container: Element, testId: string): string[] {
  return Array.from(container.querySelectorAll<SVGImageElement>(`[data-testid="${testId}"]`)).map(
    (layer) => layer.getAttribute('href') ?? '',
  );
}

async function loadLayer(container: Element, testId: string, href: string) {
  await act(async () => {
    eventForLayer(container, testId, href, 'load');
    await flushAnimationFrames();
  });
}

async function failLayer(container: Element, testId: string, href: string) {
  await act(async () => {
    eventForLayer(container, testId, href, 'error');
    await flushAnimationFrames();
  });
}

async function finishOpacityHandoff(container: Element, testId: string, href: string) {
  await act(async () => {
    const event = new window.Event('transitionend', { bubbles: true });
    Object.defineProperty(event, 'propertyName', { value: 'opacity' });
    eventForLayer(container, testId, href, event);
    await flushAnimationFrames();
  });
}

function eventForLayer(container: Element, testId: string, href: string, event: Event | 'error' | 'load') {
  const layer = Array.from(container.querySelectorAll<SVGImageElement>(`[data-testid="${testId}"]`)).find(
    (candidate) => candidate.getAttribute('href') === href,
  );
  if (layer === undefined) throw new Error(`Expected ${testId} layer for ${href}.`);
  layer.dispatchEvent(typeof event === 'string' ? new window.Event(event, { bubbles: true }) : event);
}

async function flushAnimationFrames() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function installDom() {
  const domWindow = new Window({ url: 'http://localhost/svg-preview-handoff-test' });
  Object.assign(globalThis, {
    document: domWindow.document,
    Element: domWindow.Element,
    HTMLElement: domWindow.HTMLElement,
    HTMLDivElement: domWindow.HTMLDivElement,
    navigator: domWindow.navigator,
    requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0),
    cancelAnimationFrame: (id: number) => clearTimeout(id),
    SVGImageElement: domWindow.SVGImageElement,
    window: domWindow,
  });
}
