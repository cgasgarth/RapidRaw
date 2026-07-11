import { afterEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { LibraryThumbnailImage } from '../../../src/components/panel/library/LibraryItems.tsx';
import { ThumbnailAspectRatio } from '../../../src/components/ui/AppProperties.tsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let mounted: { container: HTMLDivElement; root: Root } | null = null;

afterEach(() => {
  if (mounted !== null) {
    act(() => mounted?.root.unmount());
    mounted.container.remove();
    mounted = null;
  }
});

test('cached URLs render immediately with shared grid/list layer behavior', async () => {
  const view = await renderThumbnail('/library/A.ARW', 'thumb://a', false);
  expect(layerUrls(view.container)).toEqual(['thumb://a']);
  expect(layer(view.container, 'thumb://a').style.opacity).toBe('1');

  await view.render('/library/A.ARW', 'thumb://a', true);
  expect(layerUrls(view.container)).toEqual(['thumb://a']);
  expect(view.container.querySelector('img')?.className).not.toContain('group-hover:scale');
});

test('missing initial URL shows the delayed placeholder and later URL fades in', async () => {
  const view = await renderThumbnail('/library/delayed.ARW', null, false);
  expect(view.container.querySelector('[data-testid="library-thumbnail-placeholder"]')).toBeNull();
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 520));
  });
  expect(view.container.querySelector('[data-testid="library-thumbnail-placeholder"]')).not.toBeNull();
  await view.render('/library/delayed.ARW', 'thumb://delayed', false);
  await flushTimer();
  expect(layerUrls(view.container)).toEqual(['thumb://delayed']);
});

test('same-path URL replacement cross-fades once while duplicate URLs do not append layers', async () => {
  const loads: string[] = [];
  const view = await renderThumbnail('/library/A.ARW', 'thumb://a', false, loads);
  await view.render('/library/A.ARW', 'thumb://b', false);
  await flushTimer();
  expect(layerUrls(view.container)).toEqual(['thumb://a', 'thumb://b']);

  await view.render('/library/A.ARW', 'thumb://b', false);
  await flushTimer();
  expect(layerUrls(view.container)).toEqual(['thumb://a', 'thumb://b']);

  await act(async () => {
    layer(view.container, 'thumb://a').dispatchEvent(new window.Event('transitionend', { bubbles: true }));
  });
  expect(layerUrls(view.container)).toEqual(['thumb://a', 'thumb://b']);
  await act(async () => {
    layer(view.container, 'thumb://b').dispatchEvent(new window.Event('transitionend', { bubbles: true }));
  });
  expect(layerUrls(view.container)).toEqual(['thumb://b']);
  await act(async () => {
    view.container.querySelector('img')?.dispatchEvent(new window.Event('load', { bubbles: true }));
  });
  expect(loads).toEqual(['/library/A.ARW']);
});

test('keyed path replacement discards outgoing layers and an unmounted placeholder timer cannot leak', async () => {
  const view = await renderThumbnail('/library/A.ARW?vc=copy-1', null, false);
  expect(view.container.querySelector('[data-testid="library-thumbnail-placeholder"]')).toBeNull();

  await view.render('/library/B.jpg', 'thumb://b', false);
  expect(layerUrls(view.container)).toEqual(['thumb://b']);
  expect(view.container.querySelector('img')?.getAttribute('alt')).toBe('B.jpg');

  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 520));
  });
  expect(view.container.querySelector('[data-testid="library-thumbnail-placeholder"]')).toBeNull();
  expect(layerUrls(view.container)).toEqual(['thumb://b']);
});

async function renderThumbnail(path: string, url: string | null, compact: boolean, loads: string[] = []) {
  installDom();
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const render = async (nextPath: string, nextUrl: string | null, nextCompact: boolean) => {
    await act(async () => {
      root.render(
        createElement(LibraryThumbnailImage, {
          aspectRatio: ThumbnailAspectRatio.Cover,
          compact: nextCompact,
          key: nextPath,
          onLoad: (loadedPath) => loads.push(loadedPath),
          path: nextPath,
          url: nextUrl,
        }),
      );
      await Promise.resolve();
    });
  };
  await render(path, url, compact);
  mounted = { container, root };
  return { container, render };
}

function layerUrls(container: Element) {
  return [...container.querySelectorAll<HTMLElement>('[data-thumbnail-layer-url]')].map(
    (element) => element.dataset.thumbnailLayerUrl,
  );
}

function layer(container: Element, url: string) {
  const element = [...container.querySelectorAll<HTMLElement>('[data-thumbnail-layer-url]')].find(
    (candidate) => candidate.dataset.thumbnailLayerUrl === url,
  );
  if (element === undefined) throw new Error(`Expected thumbnail layer ${url}.`);
  return element;
}

async function flushTimer() {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 5));
  });
}

function installDom() {
  const testWindow = new Window({ url: 'http://localhost/library-thumbnail-test' });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: testWindow });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: testWindow.document });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: testWindow.navigator });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: testWindow.HTMLElement });
}
