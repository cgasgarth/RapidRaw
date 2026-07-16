import { afterEach, beforeEach, expect, test } from 'bun:test';
import { act, render as testingRender } from '@testing-library/react';
import { createElement } from 'react';

import { SvgPreviewHandoff } from '../../../src/components/panel/editor/SvgPreviewHandoff.tsx';
import type { InteractivePatch } from '../../../src/store/useEditorStore.ts';

interface HandoffRenderInput {
  baseSource: string;
  incomingPatch: InteractivePatch | null;
}

const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;

beforeEach(() => {
  globalThis.requestAnimationFrame = (callback) => window.setTimeout(() => callback(Date.now()), 0);
  globalThis.cancelAnimationFrame = (id) => window.clearTimeout(id);
});

afterEach(() => {
  globalThis.requestAnimationFrame = originalRequestAnimationFrame;
  globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
});

test('keeps rendered predecessor and successor SVG base layers until successor opacity handoff completes', async () => {
  const rendered = renderHandoff({ baseSource: 'blob:base-a', incomingPatch: null });
  expect(baseSources(rendered.container)).toEqual(['blob:base-a']);

  rendered.render({ baseSource: 'blob:base-b', incomingPatch: null });
  expect(baseSources(rendered.container)).toEqual(['blob:base-a', 'blob:base-b']);

  await loadLayer(rendered.container, 'svg-preview-base-layer', 'blob:base-b');
  expect(baseSources(rendered.container)).toEqual(['blob:base-a', 'blob:base-b']);
  expect(rendered.presented).not.toContain('blob:base-b');

  await finishOpacityHandoff(rendered.container, 'svg-preview-base-layer', 'blob:base-b');
  expect(baseSources(rendered.container)).toEqual(['blob:base-b']);
  expect(rendered.presented).toContain('blob:base-b');
  expect(rendered.released).toContain('base:/photo.ARW:blob:base-a:blob:base-a');
});

test('A to B to exact A reuse discards only B and never duplicates or releases visible A', async () => {
  const rendered = renderHandoff({ baseSource: 'blob:base-a', incomingPatch: null });
  await loadLayer(rendered.container, 'svg-preview-base-layer', 'blob:base-a');
  rendered.render({ baseSource: 'blob:base-b', incomingPatch: null });
  expect(baseSources(rendered.container)).toEqual(['blob:base-a', 'blob:base-b']);

  rendered.render({ baseSource: 'blob:base-a', incomingPatch: null });
  expect(baseSources(rendered.container)).toEqual(['blob:base-a']);
  expect(rendered.released.filter((entry) => entry.endsWith(':blob:base-b'))).toHaveLength(1);
  expect(rendered.released.some((entry) => entry.endsWith(':blob:base-a'))).toBe(false);
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

test('reports original successor readiness only from the rendered layer and keeps predecessor on failure', async () => {
  const rendered = renderHandoff({ baseSource: 'blob:original-a', incomingPatch: null });
  await loadLayer(rendered.container, 'svg-preview-base-layer', 'blob:original-a');
  expect(rendered.presented).toEqual(['blob:original-a']);

  rendered.render({ baseSource: 'blob:original-b', incomingPatch: null });
  expect(rendered.presented).not.toContain('blob:original-b');
  await failLayer(rendered.container, 'svg-preview-base-layer', 'blob:original-b');
  expect(rendered.failed).toEqual(['blob:original-b']);
  expect(baseSources(rendered.container)).toEqual(['blob:original-a']);
  expect(rendered.presented).not.toContain('blob:original-b');

  rendered.render({ baseSource: 'blob:original-c', incomingPatch: null });
  await loadLayer(rendered.container, 'svg-preview-base-layer', 'blob:original-c');
  expect(rendered.presented).not.toContain('blob:original-c');
  await finishOpacityHandoff(rendered.container, 'svg-preview-base-layer', 'blob:original-c');
  expect(rendered.presented).toContain('blob:original-c');
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
    geometryIdentity: 1,
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
  onBasePresented,
  reducedMotion = false,
}: HandoffRenderInput & {
  isCpuPreviewVisible?: boolean;
  onBasePresented?: (url: string) => void;
  reducedMotion?: boolean;
}) {
  const failed: string[] = [];
  const presented: string[] = [];
  const released: string[] = [];

  const element = ({
    baseSource: nextBaseSource,
    incomingPatch: nextIncomingPatch,
    isCpuPreviewVisible: nextIsCpuPreviewVisible = true,
    reducedMotion: nextReducedMotion = false,
  }: HandoffRenderInput & { isCpuPreviewVisible?: boolean; reducedMotion?: boolean }) =>
    createElement(
      'svg',
      null,
      createElement(SvgPreviewHandoff, {
        baseScopeKey: '/photo.ARW',
        baseSource: nextBaseSource,
        incomingPatch: nextIncomingPatch,
        isCpuPreviewVisible: nextIsCpuPreviewVisible,
        isMaxZoom: false,
        onBaseFailed: (url: string) => failed.push(url),
        onBasePresented: (url: string) => {
          presented.push(url);
          onBasePresented?.(url);
        },
        patchScopeKey: '/photo.ARW:geometry',
        reducedMotion: nextReducedMotion,
        releaseUrl: (owner: string, url: string) => released.push(`${owner}:${url}`),
        retainUrl: () => {},
      }),
    );

  const view = testingRender(element({ baseSource, incomingPatch, isCpuPreviewVisible, reducedMotion }));
  return {
    container: view.container,
    failed,
    presented,
    released,
    render: (input: HandoffRenderInput & { isCpuPreviewVisible?: boolean; reducedMotion?: boolean }) =>
      view.rerender(element(input)),
  };
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
