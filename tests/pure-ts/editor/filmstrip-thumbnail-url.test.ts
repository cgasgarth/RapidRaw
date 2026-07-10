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

  test('keeps the real Grid anchor and virtual cell width stable through a contain switch and thumbnail decode', async () => {
    const images = Array.from({ length: 40 }, (_value, index) => image(`/validation/contain-${index}.ARW`));
    useProcessStore.setState({
      thumbnails: Object.fromEntries(images.map((imageFile, index) => [imageFile.path, `blob:contain-${index}`])),
    });

    const rendered = await renderFilmstrip(images);
    const grid = requiredElement<HTMLDivElement>(rendered.container, '[role="listbox"]');
    await scrollGrid(grid, 275);

    const coverAnchor = recordFilmstripAnchor(rendered.container);
    expect(coverAnchor.columnWidths).toEqual([74]);

    rendered.render(images, ThumbnailAspectRatio.Contain);
    await settleReact();
    const beforeDecode = recordFilmstripAnchor(rendered.container);
    expect(beforeDecode).toEqual(coverAnchor);

    const dimensions = [
      { height: 3000, width: 4000 },
      { height: 4000, width: 3000 },
      { height: 3000, width: 12000 },
      { height: 3000, width: 3000 },
    ];
    for (const [index, imageElement] of filmstripThumbnailImages(rendered.container).entries()) {
      const dimension = dimensions[index % dimensions.length];
      if (!dimension) throw new Error('Expected thumbnail dimensions.');
      await loadImageWithDimensions(imageElement, dimension.width, dimension.height);
    }

    expect(recordFilmstripAnchor(rendered.container)).toEqual(beforeDecode);
    expect(
      filmstripThumbnailImages(rendered.container).every((imageElement) =>
        imageElement.className.includes('object-contain'),
      ),
    ).toBe(true);
  });
});

test('uses fixed virtual geometry regardless of thumbnail presentation mode', () => {
  expect(getFilmstripColumnWidth(100)).toBe(108);
  expect(getFilmstripColumnWidth(66)).toBe(74);
});

test('keeps virtual cells settled across unchanged parent renders and applies selection revisions in list order', async () => {
  let thumbnailExifReads = 0;
  const images = Array.from({ length: 2_000 }, (_value, index) => {
    const imageFile = image(`/validation/stable-cell-${index}.ARW`);
    Object.defineProperty(imageFile, 'exif', {
      configurable: true,
      enumerable: true,
      get: () => {
        thumbnailExifReads += 1;
        return null;
      },
    });
    return imageFile;
  });
  const initialSelection: string[] = [];
  const rendered = await renderFilmstrip(images, ThumbnailAspectRatio.Cover, initialSelection);

  thumbnailExifReads = 0;
  for (let index = 0; index < 20; index += 1) {
    rendered.render(images, ThumbnailAspectRatio.Cover, initialSelection);
  }
  await settleReact();
  expect(thumbnailExifReads).toBe(0);

  const revisedSelection = Array.from({ length: 1_000 }, (_value, index) => images[(999 - index) * 2]?.path).filter(
    (path): path is string => path !== undefined,
  );
  rendered.render(images, ThumbnailAspectRatio.Cover, revisedSelection);
  await settleReact();
  expect(thumbnailExifReads).toBeGreaterThan(0);

  const visibleThumbnails = Array.from(
    rendered.container.querySelectorAll<HTMLDivElement>('[data-testid="filmstrip-thumbnail"]'),
  );
  expect(visibleThumbnails.slice(0, 3).map((thumbnail) => thumbnail.dataset.imagePath)).toEqual(
    images.slice(0, 3).map((imageFile) => imageFile.path),
  );
  expect(visibleThumbnails.slice(0, 3).map((thumbnail) => thumbnail.getAttribute('aria-selected'))).toEqual([
    'true',
    'false',
    'true',
  ]);
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
              onRegisterThumbnail: () => {},
              onThumbnailRovingKeyDown: () => {},
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

async function renderFilmstrip(
  initialImages: ImageFile[],
  thumbnailAspectRatio: ThumbnailAspectRatio = ThumbnailAspectRatio.Cover,
  initialSelectedPaths: string[] = [],
) {
  installDom();
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const i18n = await createTestI18n();

  const render = (
    imageList: ImageFile[],
    nextThumbnailAspectRatio: ThumbnailAspectRatio = thumbnailAspectRatio,
    multiSelectedPaths: string[] = initialSelectedPaths,
  ) => {
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
              multiSelectedPaths,
              thumbnailAspectRatio: nextThumbnailAspectRatio,
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

async function loadImageWithDimensions(imageElement: HTMLImageElement, naturalWidth: number, naturalHeight: number) {
  Object.defineProperties(imageElement, {
    naturalHeight: { configurable: true, value: naturalHeight },
    naturalWidth: { configurable: true, value: naturalWidth },
  });
  await loadImage(imageElement);
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
  return filmstripThumbnailImages(container).map((element) => element.src);
}

function filmstripThumbnailImages(container: Element): HTMLImageElement[] {
  return Array.from(container.querySelectorAll<HTMLImageElement>('[data-testid="filmstrip-thumbnail-image"]'));
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

async function scrollGrid(grid: HTMLDivElement, scrollLeft: number) {
  await act(async () => {
    grid.scrollLeft = scrollLeft;
    grid.dispatchEvent(new window.Event('scroll'));
    await Promise.resolve();
  });
  await settleReact();
}

function recordFilmstripAnchor(container: Element) {
  const grid = requiredElement<HTMLDivElement>(container, '[role="listbox"]');
  const cells = Array.from(container.querySelectorAll<HTMLDivElement>('[data-testid="filmstrip-thumbnail"]'))
    .map((thumbnail) => {
      const cell = thumbnail.parentElement?.parentElement;
      if (!(cell instanceof HTMLDivElement)) throw new Error('Expected a Filmstrip Grid cell.');

      const offset = pixelValue(cell.style.left) + translateX(cell.style.transform);
      return {
        path: thumbnail.dataset.imagePath ?? '',
        offset,
        width: pixelValue(cell.style.width),
      };
    })
    .sort((left, right) => left.offset - right.offset);
  const firstVisible = cells.find((cell) => cell.offset + cell.width > grid.scrollLeft);
  if (!firstVisible?.path) throw new Error('Expected a visible Filmstrip thumbnail.');

  return {
    columnWidths: [...new Set(cells.map((cell) => cell.width))],
    firstVisiblePath: firstVisible.path,
    pixelOffset: grid.scrollLeft - firstVisible.offset,
    scrollLeft: grid.scrollLeft,
  };
}

function pixelValue(value: string) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) throw new Error(`Expected a pixel value, received "${value}".`);
  return parsed;
}

function translateX(transform: string) {
  const match = /^translate\(([-.\d]+)px,/u.exec(transform);
  if (!match?.[1]) throw new Error(`Expected a translate transform, received "${transform}".`);
  return pixelValue(match[1]);
}

function requiredElement<ElementType extends Element>(container: Element, selector: string): ElementType {
  const element = container.querySelector<ElementType>(selector);
  if (element === null) throw new Error(`Expected ${selector}.`);
  return element;
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
