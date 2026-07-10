import { afterEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import i18next from 'i18next';
import { act, createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import {
  FilmstripThumbnail,
  getFilmstripColumnWidth,
  resolveFilmstripThumbnailUrl,
} from '../../../src/components/panel/Filmstrip.tsx';
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

describe('filmstrip thumbnail loading', () => {
  test('does not render a recycled cell predecessor while its successor thumbnail loads', async () => {
    const previous = image('/validation/previous.ARW');
    const successor = image('/validation/successor.ARW');
    useProcessStore.setState({
      thumbnails: {
        [previous.path]: 'blob:previous',
        [successor.path]: 'blob:successor',
      },
    });

    const rendered = await renderThumbnail(previous);
    expect(imageSources(rendered.container)).toEqual(['blob:previous']);

    rendered.render(successor);

    const preload = required<HTMLImageElement>(rendered.container, '[data-filmstrip-thumbnail-preload="true"]');
    expect(imageSources(rendered.container)).toEqual([]);

    await act(async () => {
      preload.dispatchEvent(new window.Event('load', { bubbles: true }));
      await flush();
    });
    await act(async () => {
      await flush();
    });

    expect(imageSources(rendered.container)).toEqual(['blob:successor']);

    const successorLayer = Array.from(
      rendered.container.querySelectorAll<HTMLImageElement>('[data-testid="filmstrip-thumbnail-image"]'),
    ).find((element) => element.src === 'blob:successor');
    if (successorLayer?.parentElement === null || successorLayer === undefined) {
      throw new Error('Expected the decoded successor thumbnail layer.');
    }

    expect(imageSources(rendered.container)).toEqual(['blob:successor']);
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
  return { container, render };
}

function imageSources(container: Element): string[] {
  return Array.from(container.querySelectorAll<HTMLImageElement>('[data-testid="filmstrip-thumbnail-image"]')).map(
    (element) => element.src,
  );
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
  const domWindow = new Window({ url: 'http://localhost/filmstrip-thumbnail-test' });
  Object.assign(globalThis, {
    document: domWindow.document,
    HTMLElement: domWindow.HTMLElement,
    HTMLDivElement: domWindow.HTMLDivElement,
    HTMLImageElement: domWindow.HTMLImageElement,
    Image: domWindow.Image,
    navigator: domWindow.navigator,
    requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0),
    cancelAnimationFrame: (id: number) => clearTimeout(id),
    window: domWindow,
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
