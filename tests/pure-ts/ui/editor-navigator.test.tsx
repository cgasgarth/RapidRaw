import { afterEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import i18next from 'i18next';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import EditorNavigator, {
  createNavigatorPreviewState,
  type EditorTransformController,
  navigatorPreviewReducer,
} from '../../../src/components/panel/editor/EditorNavigator';
import { type NavigatorPreviewArtifact, useEditorStore } from '../../../src/store/useEditorStore';
import type { EditorZoomCommand } from '../../../src/utils/editorZoom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let renderedRoot: { container: HTMLDivElement; root: Root } | null = null;
const initialEditorState = useEditorStore.getState();

afterEach(() => {
  if (renderedRoot) {
    act(() => renderedRoot?.root.unmount());
    renderedRoot.container.remove();
    renderedRoot = null;
  }
  useEditorStore.setState(initialEditorState, true);
});

test('routes every compact zoom mode through the canonical zoom command callback', async () => {
  const commands: EditorZoomCommand[] = [];
  const { container } = await renderNavigator({ onZoomChange: (command) => commands.push(command) });
  const buttons = Array.from(
    container.querySelectorAll<HTMLButtonElement>('[aria-label="Navigator zoom modes"] button'),
  );

  await act(async () => {
    buttons.forEach((button) => button.click());
    await flushPromises();
  });

  expect(commands).toEqual([{ kind: 'fit' }, { kind: 'fill' }, { kind: 'one-to-one' }, { kind: 'two-to-one' }]);
});

test('keyboard pan updates only the canonical viewer transform', async () => {
  const transforms: number[][] = [];
  const adjustments = useEditorStore.getState().adjustments;
  const history = useEditorStore.getState().history;
  const controller: EditorTransformController = {
    instance: { transformState: { positionX: -400, positionY: -300, scale: 2 } },
    setTransform: (x, y, scale) => transforms.push([x, y, scale]),
  };
  const { container } = await renderNavigator({ controller });
  const overview = required<HTMLDivElement>(container, '[data-testid="editor-navigator-overview"]');

  await act(async () => {
    overview.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }));
    await flushPromises();
  });

  expect(transforms.at(-1)).toEqual([-440, -300, 2]);
  expect(useEditorStore.getState().adjustments).toBe(adjustments);
  expect(useEditorStore.getState().history).toBe(history);
});

test('rejects a stale overview load after the preview identity changes', async () => {
  useEditorStore.setState({ navigatorPreviewArtifact: artifact('a', 'graph-a', '1', 'blob:first') });
  const { container } = await renderNavigator();
  const staleImage = required<HTMLImageElement>(container, 'img[src="blob:first"]');

  await act(async () => {
    useEditorStore.setState({ navigatorPreviewArtifact: artifact('b', 'graph-b', '2', 'blob:second') });
    await flushPromises();
    staleImage.dispatchEvent(new window.Event('load'));
    await flushPromises();
  });

  expect(container.querySelector('[aria-label="Loading Navigator preview"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="editor-navigator-viewport"]')).toBeNull();
});

test('does not reload a coherent artifact when equivalent adjustments are reallocated', async () => {
  useEditorStore.setState({ navigatorPreviewArtifact: artifact('coherent', 'graph-a', '1', 'blob:coherent') });
  const { container } = await renderNavigator();
  const image = required<HTMLImageElement>(container, 'img[src="blob:coherent"]');

  await act(async () => {
    useEditorStore.setState((state) => ({
      adjustments: { ...state.adjustments },
    }));
    await flushPromises();
  });

  expect(container.querySelector('img[src="blob:coherent"]')).toBe(image);
});

test('keys interaction ownership by rapid A → B → A artifacts but not transform-only updates', async () => {
  useEditorStore.setState({ navigatorPreviewArtifact: artifact('a-1', 'graph-a', '1', 'blob:a') });
  const { container } = await renderNavigator();
  const firstOverview = required<HTMLDivElement>(container, '[data-testid="editor-navigator-overview"]');

  await act(async () => {
    useEditorStore.setState({ navigatorPreviewArtifact: artifact('b', 'graph-b', '2', 'blob:b') });
    await flushPromises();
  });
  const secondOverview = required<HTMLDivElement>(container, '[data-testid="editor-navigator-overview"]');
  expect(secondOverview).not.toBe(firstOverview);

  await act(async () => {
    useEditorStore.setState({ navigatorPreviewArtifact: artifact('a-2', 'graph-a', '3', 'blob:a') });
    await flushPromises();
  });
  const thirdOverview = required<HTMLDivElement>(container, '[data-testid="editor-navigator-overview"]');
  expect(thirdOverview).not.toBe(secondOverview);
  expect(required<HTMLElement>(container, '[data-testid="editor-navigator"]').dataset.previewSession).toBe('3');

  await act(async () => {
    useEditorStore.setState((state) => ({ baseRenderSize: { ...state.baseRenderSize, offsetX: 2 } }));
    await flushPromises();
  });
  expect(required<HTMLDivElement>(container, '[data-testid="editor-navigator-overview"]')).toBe(thirdOverview);
});

describe('Navigator preview artifact reducer', () => {
  test('owns empty, loading, ready, and error phases', () => {
    expect(createNavigatorPreviewState(null)).toEqual({ artifact: null, phase: 'empty' });
    const current = artifact('a', 'graph-a', '1', 'blob:a');
    const loading = createNavigatorPreviewState(current);
    expect(loading.phase).toBe('loading');
    expect(navigatorPreviewReducer(loading, { artifactId: 'a', type: 'image-load' }).phase).toBe('ready');
    expect(navigatorPreviewReducer(loading, { artifactId: 'a', type: 'image-error' }).phase).toBe('error');
  });

  test('rejects out-of-order events across same-URL graph changes and A → B → A sessions', () => {
    const firstA = createNavigatorPreviewState(artifact('a-1', 'graph-a', '1', 'blob:shared'));
    const imageB = createNavigatorPreviewState(artifact('b', 'graph-b', '2', 'blob:b'));
    const secondA = createNavigatorPreviewState(artifact('a-2', 'graph-a', '3', 'blob:shared'));
    expect(navigatorPreviewReducer(imageB, { artifactId: 'a-1', type: 'image-load' })).toBe(imageB);
    expect(navigatorPreviewReducer(secondA, { artifactId: 'b', type: 'image-error' })).toBe(secondA);
    expect(navigatorPreviewReducer(firstA, { artifactId: 'a-1', type: 'image-load' }).phase).toBe('ready');
  });
});

async function renderNavigator({
  controller = {
    instance: { transformState: { positionX: -400, positionY: -300, scale: 2 } },
    setTransform: () => undefined,
  },
  onZoomChange = () => undefined,
}: {
  controller?: EditorTransformController;
  onZoomChange?: (command: EditorZoomCommand) => void;
} = {}) {
  installDom();
  useEditorStore.setState({
    baseRenderSize: { containerHeight: 600, containerWidth: 800, height: 600, offsetX: 0, offsetY: 0, width: 800 },
    finalPreviewUrl: useEditorStore.getState().finalPreviewUrl,
    originalSize: { height: 3000, width: 4000 },
    zoomMode: { devicePixelsPerImagePixel: 1, kind: 'ratio' },
  });
  const i18n = i18next.createInstance();
  await i18n.use(initReactI18next).init({ fallbackLng: 'en', lng: 'en', react: { useSuspense: false } });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(EditorNavigator, { onZoomChange, transformControllerRef: { current: controller } }),
      ),
    );
    await flushPromises();
  });
  renderedRoot = { container, root };
  return { container, root };
}

function artifact(id: string, graphIdentity: string, imageSessionId: string, url: string): NavigatorPreviewArtifact {
  return { graphIdentity, id, imageSessionId, url };
}

function required<T extends Element>(container: Element, selector: string): T {
  const element = container.querySelector<T>(selector);
  if (!element) throw new Error(`Expected ${selector}`);
  return element;
}

function installDom() {
  const window = new Window({ url: 'http://localhost/editor-navigator-test' });
  class TestResizeObserver {
    observe() {}
    disconnect() {}
  }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window, writable: true });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: window.document, writable: true });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: window.navigator, writable: true });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: window.HTMLElement, writable: true });
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    value: TestResizeObserver,
    writable: true,
  });
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    configurable: true,
    value: () => 1,
    writable: true,
  });
  Object.defineProperty(globalThis, 'cancelAnimationFrame', {
    configurable: true,
    value: (handle: number) => window.clearTimeout(handle),
    writable: true,
  });
}

async function flushPromises() {
  await new Promise((resolve) => setTimeout(resolve, 5));
}
