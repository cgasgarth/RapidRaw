import { afterEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import i18next from 'i18next';
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import BottomBar, { buildEditorBottomCommandModel } from '../../../src/components/panel/BottomBar';
import { type ImageFile, type SelectedImage, ThumbnailAspectRatio } from '../../../src/components/ui/AppProperties';
import en from '../../../src/i18n/locales/en.json';
import { useLibraryStore } from '../../../src/store/useLibraryStore';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const images: ImageFile[] = [
  createImage('/library/01.NEF', 'red'),
  createImage('/library/02.NEF', 'blue'),
  createImage('/library/03.NEF', null),
];
const ratings = { '/library/01.NEF': 2, '/library/02.NEF': 4, '/library/03.NEF': 4 };
const initialLibraryState = useLibraryStore.getState();
let renderedRoot: { container: HTMLDivElement; root: Root } | null = null;
let setFilmstripVisible: ((visible: boolean) => void) | null = null;

afterEach(() => {
  if (renderedRoot) {
    act(() => renderedRoot?.root.unmount());
    renderedRoot.container.remove();
    renderedRoot = null;
  }
  useLibraryStore.setState(initialLibraryState, true);
});

test('builds navigation, mixed organization, selection, and filter state from real editor inputs', () => {
  const model = buildEditorBottomCommandModel({
    filterColors: ['red'],
    filterRating: 3,
    imageList: images,
    imageRatings: ratings,
    multiSelectedPaths: ['/library/01.NEF', '/library/02.NEF'],
    selectedPath: '/library/02.NEF',
  });

  expect(model).toMatchObject({
    activeColor: 'blue',
    activeIndex: 1,
    activeRating: 4,
    hasActiveFilters: true,
    isColorMixed: true,
    isRatingMixed: true,
    nextPath: '/library/03.NEF',
    previousPath: '/library/01.NEF',
    selectedCount: 2,
    totalCount: 3,
  });
  expect(model.targetPaths).toEqual(['/library/01.NEF', '/library/02.NEF']);
});

test('routes compact editor navigation and commands without rendering zoom or export controls', async () => {
  const calls: string[] = [];
  const { container } = await renderBottomBar({
    onCopy: () => calls.push('copy'),
    onImageSelect: (path) => calls.push(path),
    onPaste: () => calls.push('paste'),
    onRate: (rating) => calls.push(`rate:${rating}`),
  });

  expect(container.querySelector('[data-testid="editor-bottom-navigation-zone"]')).not.toBeNull();
  expect(
    container.querySelector('[data-testid="editor-bottom-organization-zone"]')?.getAttribute('data-mixed'),
  ).toBeNull();
  expect(container.querySelector('[role="group"][data-mixed="true"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="editor-bottom-transfer-zone"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="editor-bottom-bar-zoom"]')).toBeNull();
  expect(container.querySelector('[aria-label="Export"]')).toBeNull();
  expect(container.querySelector('[data-active-filters="true"]')).not.toBeNull();

  await act(async () => {
    getButton(container, 'Previous image').click();
    getButton(container, 'Next image').click();
    getButton(container, 'Rate 5 stars').click();
    getButton(container, 'Copy Settings').click();
    getButton(container, 'Paste Settings').click();
  });

  expect(calls).toEqual(['/library/01.NEF', '/library/03.NEF', 'rate:5', 'copy', 'paste']);
});

test('moves focus to the filmstrip toggle when an externally controlled lane collapses', async () => {
  const { container } = await renderBottomBar({}, true);
  const lane = container.querySelector<HTMLDivElement>('[data-testid="editor-filmstrip-lane"]');
  const toggle = container.querySelector<HTMLButtonElement>('[data-testid="editor-filmstrip-toggle"]');
  if (!lane || !toggle) throw new Error('Expected filmstrip focus controls.');

  lane.tabIndex = 0;
  lane.focus();
  expect(document.activeElement).toBe(lane);
  await act(async () => setFilmstripVisible?.(false));

  expect(document.activeElement).toBe(toggle);
  expect(container.querySelector<HTMLElement>('[data-testid="editor-filmstrip-lane"]')?.style.height).toBe('0px');
});

async function renderBottomBar(
  overrides: Partial<React.ComponentProps<typeof BottomBar>> = {},
  controlledFilmstrip = false,
): Promise<{ container: HTMLDivElement }> {
  installDom();
  useLibraryStore.setState({
    filterCriteria: { colors: ['red'], rating: 3, rawStatus: initialLibraryState.filterCriteria.rawStatus },
    imageList: images,
    imageRatings: ratings,
    multiSelectedPaths: ['/library/01.NEF', '/library/02.NEF'],
  });
  const i18n = i18next.createInstance();
  await i18n.use(initReactI18next).init({
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    lng: 'en',
    react: { useSuspense: false },
    resources: { en: { translation: en } },
  });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const selectedImage: SelectedImage = {
    exif: null,
    height: 3024,
    isRaw: true,
    isReady: true,
    originalUrl: null,
    path: '/library/02.NEF',
    thumbnailUrl: 'data:image/png;base64,placeholder',
    width: 4032,
  };

  await act(async () => {
    root.render(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(controlledFilmstrip ? ControlledFilmstrip : BottomBar, {
          imageList: images,
          imageRatings: ratings,
          isCopied: false,
          isCopyDisabled: false,
          isFilmstripVisible: false,
          isPasted: false,
          isPasteDisabled: false,
          isRatingDisabled: false,
          multiSelectedPaths: ['/library/01.NEF', '/library/02.NEF'],
          onClearSelection: () => undefined,
          onCopy: () => undefined,
          onImageSelect: () => undefined,
          onOpenCopyPasteSettings: () => undefined,
          onPaste: () => undefined,
          onRate: () => undefined,
          rating: 4,
          selectedImage,
          showFilmstrip: controlledFilmstrip,
          thumbnailAspectRatio: ThumbnailAspectRatio.Cover,
          totalImages: images.length,
          ...overrides,
        }),
      ),
    );
  });
  renderedRoot = { container, root };
  return { container };
}

function ControlledFilmstrip(props: React.ComponentProps<typeof BottomBar>) {
  const [visible, setVisible] = useState(true);
  setFilmstripVisible = setVisible;
  return createElement(BottomBar, {
    ...props,
    filmstripHeight: 96,
    isFilmstripVisible: visible,
    setIsFilmstripVisible: setVisible,
  });
}

function createImage(path: string, color: string | null): ImageFile {
  return {
    exif: null,
    is_edited: false,
    is_virtual_copy: false,
    modified: 0,
    path,
    rating: 0,
    tags: color ? [`color:${color}`] : null,
  };
}

function getButton(container: Element, label: string): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!button) throw new Error(`Expected button: ${label}`);
  return button;
}

function installDom() {
  const window = new Window({ url: 'http://localhost/editor-bottom-command-bar-test' });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: window.document });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: window.navigator });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: window.HTMLElement });
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    value: class {
      disconnect() {}
      observe() {}
      unobserve() {}
    },
  });
}
