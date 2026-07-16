import { afterEach, describe, expect, test } from 'bun:test';
import { act, fireEvent, render as testingRender } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { createElement, Profiler } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import EditorNavigator, {
  createNavigatorPreviewState,
  type EditorTransformController,
  navigatorPreviewReducer,
  resolveNavigatorTransformUpdate,
} from '../../../src/components/panel/editor/EditorNavigator';
import { type NavigatorPreviewArtifact, useEditorStore } from '../../../src/store/useEditorStore';
import type { EditorZoomCommand } from '../../../src/utils/editorZoom';

const initialEditorState = useEditorStore.getState();
const i18n = await createTestI18n();

afterEach(() => {
  act(() => useEditorStore.getState().hydrateEditorRenderAuthority(initialEditorState));
});

test('routes every compact zoom mode through the canonical zoom command callback', async () => {
  const commands: EditorZoomCommand[] = [];
  const { container } = await renderNavigator({ onZoomChange: (command) => commands.push(command) });
  const buttons = Array.from(
    container.querySelectorAll<HTMLButtonElement>('[aria-label="Navigator zoom modes"] button'),
  );

  const user = userEvent.setup();
  for (const button of buttons) await user.click(button);

  expect(commands).toEqual([{ kind: 'fit' }, { kind: 'fill' }, { kind: 'one-to-one' }, { kind: 'two-to-one' }]);
});

test('keyboard pan updates only the canonical viewer transform', async () => {
  const transforms: number[][] = [];
  const adjustments = useEditorStore.getState().adjustmentSnapshot.value;
  const history = useEditorStore.getState().history;
  const controller: EditorTransformController = {
    instance: { transformState: { positionX: -400, positionY: -300, scale: 2 } },
    setTransform: (x, y, scale) => transforms.push([x, y, scale]),
  };
  const { container } = await renderNavigator({ controller });
  const overview = required<HTMLDivElement>(container, '[data-testid="editor-navigator-overview"]');

  fireEvent.keyDown(overview, { key: 'ArrowRight' });

  expect(transforms.at(-1)).toEqual([-440, -300, 2]);
  expect(useEditorStore.getState().adjustmentSnapshot.value).toBe(adjustments);
  expect(useEditorStore.getState().history).toBe(history);
});

test('rejects a stale overview load after the preview identity changes', async () => {
  useEditorStore.setState({ navigatorPreviewArtifact: artifact('a', 'graph-a', '1', 'blob:first') });
  const { container } = await renderNavigator();
  const staleImage = required<HTMLImageElement>(container, 'img[src="blob:first"]');

  act(() => {
    useEditorStore.setState({ navigatorPreviewArtifact: artifact('b', 'graph-b', '2', 'blob:second') });
  });
  fireEvent.load(staleImage);

  expect(container.querySelector('[aria-label="Loading Navigator preview"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="editor-navigator-viewport"]')).toBeNull();
});

test('does not reload a coherent artifact when equivalent adjustments are reallocated', async () => {
  useEditorStore.setState({ navigatorPreviewArtifact: artifact('coherent', 'graph-a', '1', 'blob:coherent') });
  const { container } = await renderNavigator();
  const image = required<HTMLImageElement>(container, 'img[src="blob:coherent"]');

  act(() => {
    useEditorStore.getState().hydrateEditorRenderAuthority((state) => ({
      editDocumentV2: structuredClone(state.editDocumentV2),
      history: state.history.map((entry, index) =>
        index === state.historyIndex ? structuredClone(state.editDocumentV2) : entry,
      ),
    }));
  });

  expect(container.querySelector('img[src="blob:coherent"]')).toBe(image);
});

test('keys interaction ownership by rapid A → B → A artifacts but not transform-only updates', async () => {
  useEditorStore.setState({ navigatorPreviewArtifact: artifact('a-1', 'graph-a', '1', 'blob:a') });
  const { container } = await renderNavigator();
  const firstOverview = required<HTMLDivElement>(container, '[data-testid="editor-navigator-overview"]');

  act(() => {
    useEditorStore.setState({ navigatorPreviewArtifact: artifact('b', 'graph-b', '2', 'blob:b') });
  });
  const secondOverview = required<HTMLDivElement>(container, '[data-testid="editor-navigator-overview"]');
  expect(secondOverview).not.toBe(firstOverview);

  act(() => {
    useEditorStore.setState({ navigatorPreviewArtifact: artifact('a-2', 'graph-a', '3', 'blob:a') });
  });
  const thirdOverview = required<HTMLDivElement>(container, '[data-testid="editor-navigator-overview"]');
  expect(thirdOverview).not.toBe(secondOverview);
  expect(required<HTMLElement>(container, '[data-testid="editor-navigator"]').dataset['previewSession']).toBe('3');

  act(() => {
    useEditorStore.setState((state) => ({ baseRenderSize: { ...state.baseRenderSize, offsetX: 2 } }));
  });
  expect(required<HTMLDivElement>(container, '[data-testid="editor-navigator-overview"]')).toBe(thirdOverview);
});

test('converges repeated pan, zoom, resize, and image snapshots without duplicate transform publication', () => {
  let current = { positionX: 0, positionY: 0, scale: 1 };
  let publications = 0;
  const synchronize = (candidate: typeof current) => {
    const next = resolveNavigatorTransformUpdate(current, candidate);
    if (next !== current) publications += 1;
    current = next;
  };

  for (let iteration = 0; iteration < 100; iteration += 1) synchronize({ ...current });
  synchronize({ positionX: -400, positionY: -300, scale: 2 });
  for (let iteration = 0; iteration < 100; iteration += 1) synchronize({ ...current });
  synchronize({ positionX: -440, positionY: -300, scale: 2 });
  synchronize({ positionX: -220, positionY: -150, scale: 1.5 });
  synchronize({ positionX: 0, positionY: 0, scale: 1 });
  for (let iteration = 0; iteration < 100; iteration += 1) synchronize({ ...current });

  const converged = current;
  synchronize({ positionX: Number.NaN, positionY: 0, scale: 1 });
  synchronize({ positionX: 0, positionY: Number.POSITIVE_INFINITY, scale: 1 });
  synchronize({ positionX: 0, positionY: 0, scale: 0 });

  expect(publications).toBe(4);
  expect(current).toBe(converged);
  expect(current).toEqual({ positionX: 0, positionY: 0, scale: 1 });
});

test('publishes one settled controller transform after continuous motion and cleans up its sampler', async () => {
  const intervalDriver = new ControlledIntervalDriver();
  const setIntervalDescriptor = Object.getOwnPropertyDescriptor(window, 'setInterval');
  const clearIntervalDescriptor = Object.getOwnPropertyDescriptor(window, 'clearInterval');
  Object.defineProperty(window, 'setInterval', { configurable: true, value: intervalDriver.setInterval });
  Object.defineProperty(window, 'clearInterval', { configurable: true, value: intervalDriver.clearInterval });
  let candidate = { positionX: 0, positionY: 0, scale: 1 };
  let renderCount = 0;
  const controller: EditorTransformController = {
    instance: {
      get transformState() {
        return { ...candidate };
      },
    },
    setTransform: () => undefined,
  };
  const rendered = await renderNavigator({
    controller,
    onRender: () => renderCount++,
  });
  const navigator = required<HTMLElement>(rendered.container, '[data-testid="editor-navigator"]');
  const initialRenderCount = renderCount;

  act(() => {
    for (let step = 1; step <= 100; step += 1) {
      candidate = { positionX: -step * 2, positionY: -step, scale: 1 + step / 100 };
      intervalDriver.tick();
    }
  });
  expect(renderCount).toBe(initialRenderCount);
  expect(readNavigatorTransform(navigator)).toEqual({ positionX: 0, positionY: 0, scale: 1 });

  candidate = { positionX: -240, positionY: -120, scale: 2.5 };
  act(() => {
    intervalDriver.tick();
  });
  expect(renderCount).toBe(initialRenderCount);
  act(() => {
    intervalDriver.tick();
  });
  expect(renderCount).toBe(initialRenderCount + 1);
  expect(readNavigatorTransform(navigator)).toEqual(candidate);
  expect(intervalDriver.activeCount).toBe(1);

  rendered.unmount();
  expect(intervalDriver.activeCount).toBe(0);
  restoreProperty(window, 'setInterval', setIntervalDescriptor);
  restoreProperty(window, 'clearInterval', clearIntervalDescriptor);
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

function renderNavigator({
  controller = {
    instance: { transformState: { positionX: -400, positionY: -300, scale: 2 } },
    setTransform: () => undefined,
  },
  onZoomChange = () => undefined,
  onRender,
}: {
  controller?: EditorTransformController;
  onRender?: () => void;
  onZoomChange?: (command: EditorZoomCommand) => void;
} = {}) {
  useEditorStore.setState({
    baseRenderSize: { containerHeight: 600, containerWidth: 800, height: 600, offsetX: 0, offsetY: 0, width: 800 },
    finalPreviewUrl: useEditorStore.getState().finalPreviewUrl,
    originalSize: { height: 3000, width: 4000 },
    zoomMode: { devicePixelsPerImagePixel: 1, kind: 'ratio' },
  });
  const navigator = createElement(EditorNavigator, {
    onZoomChange,
    transformControllerRef: { current: controller },
  });
  return testingRender(
    createElement(
      I18nextProvider,
      { i18n },
      onRender ? createElement(Profiler, { id: 'editor-navigator', onRender: () => onRender() }, navigator) : navigator,
    ),
  );
}

function artifact(id: string, graphIdentity: string, imageSessionId: string, url: string): NavigatorPreviewArtifact {
  return { graphIdentity, id, imageSessionId, url };
}

function required<T extends Element>(container: Element, selector: string): T {
  const element = container.querySelector<T>(selector);
  if (!element) throw new Error(`Expected ${selector}`);
  return element;
}

class ControlledIntervalDriver {
  private callbacks = new Map<number, () => void>();
  private nextId = 1;

  readonly setInterval = (callback: TimerHandler): number => {
    if (typeof callback !== 'function') throw new Error('Controlled interval requires a callback.');
    const id = this.nextId++;
    this.callbacks.set(id, () => Reflect.apply(callback, undefined, []));
    return id;
  };

  readonly clearInterval = (id: number): void => {
    this.callbacks.delete(id);
  };

  get activeCount(): number {
    return this.callbacks.size;
  }

  tick(): void {
    for (const callback of [...this.callbacks.values()]) callback();
  }
}

function readNavigatorTransform(element: HTMLElement): { positionX: number; positionY: number; scale: number } {
  return {
    positionX: Number(element.dataset['transformPositionX']),
    positionY: Number(element.dataset['transformPositionY']),
    scale: Number(element.dataset['transformScale']),
  };
}

function restoreProperty(target: Window, key: 'clearInterval' | 'setInterval', descriptor?: PropertyDescriptor) {
  if (descriptor === undefined) Reflect.deleteProperty(target, key);
  else Object.defineProperty(target, key, descriptor);
}

async function createTestI18n() {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({ fallbackLng: 'en', lng: 'en', react: { useSuspense: false } });
  return instance;
}
