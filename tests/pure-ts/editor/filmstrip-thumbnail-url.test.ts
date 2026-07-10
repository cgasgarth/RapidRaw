import { afterEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import i18next from 'i18next';
import { act, createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import Filmstrip, {
  FilmstripThumbnail,
  getFilmstripColumnWidth,
  resolveFilmstripThumbnailUrl,
} from '../../../src/components/panel/Filmstrip.tsx';
import { DecodedThumbnailReadinessCache } from '../../../src/components/panel/filmstripThumbnailLifecycle.ts';
import { type ImageFile, ThumbnailAspectRatio } from '../../../src/components/ui/AppProperties.tsx';
import en from '../../../src/i18n/locales/en.json';
import { useProcessStore } from '../../../src/store/useProcessStore.ts';
import { useSettingsStore } from '../../../src/store/useSettingsStore.ts';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let renderedRoot: { container: HTMLDivElement; root: Root } | null = null;

afterEach(() => {
  if (renderedRoot !== null) {
    act(() => {
      renderedRoot?.root.unmount();
    });
    renderedRoot.container.remove();
    renderedRoot = null;
  }
  useProcessStore.setState({ thumbnails: {} });
  useSettingsStore.setState({ appSettings: null });
});

test('uses the active selected-image thumbnail as a filmstrip fallback', () => {
  expect(resolveFilmstripThumbnailUrl(undefined, 'data:image/jpeg;base64,abc', true)).toBe(
    'data:image/jpeg;base64,abc',
  );
});

test('keeps placeholder state for inactive images without a cached thumbnail', () => {
  expect(resolveFilmstripThumbnailUrl(undefined, 'data:image/jpeg;base64,abc', false)).toBeUndefined();
});

test('prefers the cached thumbnail when present', () => {
  expect(resolveFilmstripThumbnailUrl('data:image/jpeg;base64,cached', 'data:image/jpeg;base64,selected', true)).toBe(
    'data:image/jpeg;base64,cached',
  );
});

test('bounds decoded readiness entries and refreshes recent revisions', () => {
  const cache = new DecodedThumbnailReadinessCache(2);
  cache.markDecoded('/validation/one.ARW', 'blob:one');
  cache.markDecoded('/validation/two.ARW', 'blob:two');
  expect(cache.has('/validation/one.ARW', 'blob:one')).toBe(true);

  cache.markDecoded('/validation/three.ARW', 'blob:three');

  expect(cache.has('/validation/two.ARW', 'blob:two')).toBe(false);
  expect(cache.has('/validation/one.ARW', 'blob:one')).toBe(true);
  expect(cache.has('/validation/three.ARW', 'blob:three')).toBe(true);
});

describe('filmstrip thumbnail decode handoff', () => {
  test('keeps a same-path predecessor visible until the actual successor image decodes and completes opacity handoff', async () => {
    const current = image('/validation/revision.ARW');
    useProcessStore.setState({ thumbnails: { [current.path]: 'blob:revision-one' } });
    const rendered = await renderThumbnail(current);
    const predecessor = requiredImage(rendered.container, 'blob:revision-one');

    expect(placeholder(rendered.container)).not.toBeNull();
    await loadImage(predecessor);
    expect(placeholder(rendered.container)).toBeNull();

    await setThumbnails({ [current.path]: 'blob:revision-two' });
    const successor = requiredImage(rendered.container, 'blob:revision-two');
    const decode = deferred<void>();
    setImageDecode(successor, decode.promise);

    expect(imageSources(rendered.container)).toEqual(['blob:revision-one', 'blob:revision-two']);
    expect(layerOpacity(successor)).toBe('0');

    await dispatchLoad(successor);
    expect(layerOpacity(successor)).toBe('0');
    expect(imageSources(rendered.container)).toEqual(['blob:revision-one', 'blob:revision-two']);

    await act(async () => {
      decode.resolve();
    });
    await settleReact();
    expect(layerOpacity(successor)).toBe('1');

    await dispatchTransition(successor, 'transform');
    expect(imageSources(rendered.container)).toEqual(['blob:revision-one', 'blob:revision-two']);

    await dispatchTransition(layer(successor), 'opacity');
    expect(imageSources(rendered.container)).toEqual(['blob:revision-two']);
  });

  test('rejects stale same-path revision callbacks without removing the valid predecessor', async () => {
    const current = image('/validation/stale-revision.ARW');
    useProcessStore.setState({ thumbnails: { [current.path]: 'blob:stale-one' } });
    const rendered = await renderThumbnail(current);
    const predecessor = requiredImage(rendered.container, 'blob:stale-one');
    await loadImage(predecessor);

    await setThumbnails({ [current.path]: 'blob:stale-two' });
    const successor = requiredImage(rendered.container, 'blob:stale-two');

    await act(async () => {
      predecessor.dispatchEvent(new window.Event('error'));
      await settle();
    });

    expect(imageSources(rendered.container)).toEqual(['blob:stale-one', 'blob:stale-two']);
    await loadImage(successor);
    await dispatchTransition(layer(successor), 'opacity');
    expect(imageSources(rendered.container)).toEqual(['blob:stale-two']);
  });

  test('keeps a same-path predecessor when successor decode rejects', async () => {
    const current = image('/validation/decode-error.ARW');
    useProcessStore.setState({ thumbnails: { [current.path]: 'blob:decode-error-one' } });
    const rendered = await renderThumbnail(current);
    const predecessor = requiredImage(rendered.container, 'blob:decode-error-one');
    await loadImage(predecessor);

    await setThumbnails({ [current.path]: 'blob:decode-error-two' });
    const successor = requiredImage(rendered.container, 'blob:decode-error-two');
    setImageDecode(successor, Promise.reject(new Error('decode failed')));

    await dispatchLoad(successor);
    await settleReact();

    expect(imageSources(rendered.container)).toEqual(['blob:decode-error-one']);
    expect(placeholder(rendered.container)).toBeNull();
  });

  test('does not retain a different-path predecessor while a recycled thumbnail cell decodes', async () => {
    const previous = image('/validation/previous.ARW');
    const successor = image('/validation/successor.ARW');
    useProcessStore.setState({
      thumbnails: {
        [previous.path]: 'blob:previous',
        [successor.path]: 'blob:successor',
      },
    });

    const rendered = await renderThumbnail(previous);
    await loadImage(requiredImage(rendered.container, 'blob:previous'));

    rendered.render(successor);
    await settleReact();

    expect(imageSources(rendered.container)).toEqual(['blob:successor']);
    expect(placeholder(rendered.container)).not.toBeNull();
    await loadImage(requiredImage(rendered.container, 'blob:successor'));
    expect(placeholder(rendered.container)).toBeNull();
  });

  test('preserves decoded readiness across a virtualized remount without showing the placeholder', async () => {
    const current = image('/validation/warm-remount.ARW');
    useProcessStore.setState({ thumbnails: { [current.path]: 'blob:warm-remount' } });
    const rendered = await renderThumbnail(current);
    await loadImage(requiredImage(rendered.container, 'blob:warm-remount'));

    rendered.unmount();
    const remounted = await renderThumbnail(current);

    expect(imageSources(remounted.container)).toEqual(['blob:warm-remount']);
    expect(placeholder(remounted.container)).toBeNull();
  });

  test('uses the real Grid path without showing a different-path predecessor after its cell changes', async () => {
    const previous = image('/validation/grid-previous.ARW');
    const successor = image('/validation/grid-successor.ARW');
    useProcessStore.setState({
      thumbnails: {
        [previous.path]: 'blob:grid-previous',
        [successor.path]: 'blob:grid-successor',
      },
    });

    const rendered = await renderFilmstrip([previous]);
    await loadImage(requiredImage(rendered.container, 'blob:grid-previous'));

    rendered.render([successor]);
    await settleReact();

    expect(imageSources(rendered.container)).toEqual(['blob:grid-successor']);
    await loadImage(requiredImage(rendered.container, 'blob:grid-successor'));
    expect(placeholder(rendered.container)).toBeNull();
  });
});

test('uses fixed cover geometry and measured contain geometry', () => {
  expect(getFilmstripColumnWidth(100, ThumbnailAspectRatio.Cover, 0.5)).toBe(108);
  expect(getFilmstripColumnWidth(100, ThumbnailAspectRatio.Cover, 2)).toBe(108);
  expect(getFilmstripColumnWidth(100, ThumbnailAspectRatio.Contain, 0.5)).toBe(58);
  expect(getFilmstripColumnWidth(100, ThumbnailAspectRatio.Contain, 2)).toBe(208);
});

function image(path: string): ImageFile {
  return {
    exif: null,
    is_edited: false,
    is_virtual_copy: false,
    modified: 0,
    path,
    rating: 0,
    tags: null,
  };
}

async function renderThumbnail(initialImage: ImageFile) {
  installDom();
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const i18n = await createTestI18n();

  const render = (imageFile: ImageFile) => {
    act(() => {
      flushSync(() => {
        root.render(
          createElement(
            I18nextProvider,
            { i18n },
            createElement(FilmstripThumbnail, {
              imageFile,
              imageRatings: null,
              index: 0,
              isActive: false,
              isSelected: false,
              itemHeight: 100,
              onRegisterThumbnail: () => {},
              onThumbnailRovingKeyDown: () => {},
              setRatio: () => {},
              tabIndex: 0,
              thumbnailAspectRatio: ThumbnailAspectRatio.Cover,
            }),
          ),
        );
      });
    });
  };

  render(initialImage);
  renderedRoot = { container, root };
  return {
    container,
    render,
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
      renderedRoot = null;
    },
  };
}

async function renderFilmstrip(initialImages: ImageFile[]) {
  installDom();
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const i18n = await createTestI18n();

  const render = (imageList: ImageFile[]) => {
    act(() => {
      flushSync(() => {
        root.render(
          createElement(
            I18nextProvider,
            { i18n },
            createElement(Filmstrip, {
              imageList,
              imageRatings: null,
              isLoading: false,
              multiSelectedPaths: [],
              thumbnailAspectRatio: ThumbnailAspectRatio.Cover,
            }),
          ),
        );
      });
    });
  };

  render(initialImages);
  await settleReact();
  renderedRoot = { container, root };
  return { container, render };
}

async function setThumbnails(thumbnails: Record<string, string>) {
  act(() => {
    useProcessStore.setState({ thumbnails });
  });
  await settleReact();
}

async function loadImage(imageElement: HTMLImageElement) {
  await act(async () => {
    imageElement.dispatchEvent(new window.Event('load'));
    await Promise.resolve();
  });
  await settleReact();
}

async function dispatchLoad(imageElement: HTMLImageElement) {
  await act(async () => {
    imageElement.dispatchEvent(new window.Event('load'));
    await Promise.resolve();
  });
}

function setImageDecode(imageElement: HTMLImageElement, decode: Promise<void>) {
  Object.defineProperty(imageElement, 'decode', {
    configurable: true,
    value: () => decode,
  });
}

async function dispatchTransition(element: Element, propertyName: string) {
  await act(async () => {
    const event = new window.Event('transitionend', { bubbles: true });
    Object.defineProperty(event, 'propertyName', { value: propertyName });
    element.dispatchEvent(event);
    await Promise.resolve();
  });
  await settleReact();
}

function imageSources(container: Element): string[] {
  return Array.from(container.querySelectorAll<HTMLImageElement>('[data-testid="filmstrip-thumbnail-image"]')).map(
    (element) => element.src,
  );
}

function requiredImage(container: Element, url: string): HTMLImageElement {
  const imageElement = Array.from(
    container.querySelectorAll<HTMLImageElement>('[data-testid="filmstrip-thumbnail-image"]'),
  ).find((element) => element.src === url);
  if (imageElement === undefined) throw new Error(`Expected thumbnail image ${url}.`);
  return imageElement;
}

function layer(imageElement: HTMLImageElement): HTMLDivElement {
  const parent = imageElement.parentElement;
  if (!(parent instanceof HTMLDivElement)) throw new Error('Expected a thumbnail image layer.');
  return parent;
}

function layerOpacity(imageElement: HTMLImageElement): string {
  return layer(imageElement).style.opacity;
}

function placeholder(container: Element) {
  return container.querySelector('[data-testid="filmstrip-thumbnail-placeholder"]');
}

function deferred<Value>() {
  let resolvePromise: (value: Value | PromiseLike<Value>) => void = () => {};
  const promise = new Promise<Value>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function settleReact() {
  await act(async () => {
    await settle();
  });
}

function installDom() {
  const domWindow = new Window({ url: 'http://localhost/filmstrip-thumbnail-test' });
  Object.assign(globalThis, {
    DOMRectReadOnly: domWindow.DOMRectReadOnly,
    document: domWindow.document,
    HTMLElement: domWindow.HTMLElement,
    HTMLDivElement: domWindow.HTMLDivElement,
    HTMLImageElement: domWindow.HTMLImageElement,
    Image: domWindow.Image,
    navigator: domWindow.navigator,
    requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0),
    cancelAnimationFrame: (id: number) => clearTimeout(id),
    ResizeObserver: TestResizeObserver,
    window: domWindow,
  });

  Object.defineProperty(domWindow.HTMLImageElement.prototype, 'decode', {
    configurable: true,
    value: () => Promise.resolve(),
  });
}

class TestResizeObserver implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}

  disconnect() {}

  observe(target: Element, _options?: ResizeObserverOptions) {
    const size: ResizeObserverSize = { blockSize: 120, inlineSize: 320 };
    const entry: ResizeObserverEntry = {
      borderBoxSize: [size],
      contentBoxSize: [size],
      contentRect: new DOMRectReadOnly(0, 0, 320, 120),
      devicePixelContentBoxSize: [size],
      target,
    };
    this.callback([entry], this);
  }

  unobserve(_target: Element) {}
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
