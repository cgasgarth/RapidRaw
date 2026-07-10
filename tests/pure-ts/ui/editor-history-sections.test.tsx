import { afterEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import {
  EditorHistorySection,
  EditorSnapshotsSection,
} from '../../../src/components/panel/editor/EditorHistorySections';
import { useEditorStore } from '../../../src/store/useEditorStore';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let renderedRoot: { container: HTMLDivElement; root: Root } | null = null;

afterEach(() => {
  if (renderedRoot !== null) {
    act(() => renderedRoot?.root.unmount());
    renderedRoot.container.remove();
    renderedRoot = null;
  }
  useEditorStore.getState().resetHistory(structuredClone(INITIAL_ADJUSTMENTS));
});

test('history rows use the real navigation command without duplicating entries', async () => {
  const initial = structuredClone(INITIAL_ADJUSTMENTS);
  const exposure = { ...initial, exposure: 0.4 };
  const contrast = { ...exposure, contrast: 12 };
  useEditorStore.setState({
    adjustments: contrast,
    history: [initial, exposure, contrast],
    historyCheckpoints: [],
    historyIndex: 2,
  });
  const container = await render(EditorHistorySection);

  expect(container.querySelectorAll('[role="option"]')).toHaveLength(3);
  const first = getRequired<HTMLButtonElement>(container, '[data-history-index="0"]');
  await act(async () => first.click());

  expect(useEditorStore.getState().adjustments).toEqual(initial);
  expect(useEditorStore.getState().historyIndex).toBe(0);
  expect(container.querySelectorAll('[aria-selected="true"]')).toHaveLength(1);

  const active = getRequired<HTMLButtonElement>(container, '[data-active="true"]');
  await act(async () => {
    active.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, key: 'End' }));
    await flushPromises();
  });

  expect(useEditorStore.getState().adjustments).toEqual(contrast);
  expect(useEditorStore.getState().historyIndex).toBe(2);
  expect(document.activeElement).toBe(getRequired(container, '[data-active="true"]'));
});

test('snapshots expose empty, create, rename, and apply behavior through the store', async () => {
  const initial = structuredClone(INITIAL_ADJUSTMENTS);
  const exposure = { ...initial, exposure: 0.4 };
  useEditorStore.setState({
    adjustments: exposure,
    history: [initial, exposure],
    historyCheckpoints: [],
    historyIndex: 1,
  });
  const container = await render(EditorSnapshotsSection);

  expect(container.querySelector('[data-testid="editor-sidebar-snapshots-empty"]')).not.toBeNull();
  await act(async () =>
    getRequired<HTMLButtonElement>(container, '[data-testid="editor-sidebar-snapshot-create"]').click(),
  );

  expect(useEditorStore.getState().historyCheckpoints).toHaveLength(1);
  expect(container.querySelectorAll('[role="option"]')).toHaveLength(1);

  await act(async () => getRequired<HTMLButtonElement>(container, '[data-snapshot-rename]').click());
  const input = getRequired<HTMLInputElement>(container, '[data-testid="editor-sidebar-snapshot-name-input"]');
  expect(document.activeElement).toBe(input);
  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    valueSetter?.call(input, 'Proof candidate');
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    const reactPropsKey = Object.keys(input).find((key) => key.startsWith('__reactProps$'));
    if (reactPropsKey === undefined) throw new Error('Snapshot input did not expose React input props.');
    const reactProps = Reflect.get(input, reactPropsKey) as {
      onChange: (event: { currentTarget: HTMLInputElement }) => void;
    };
    reactProps.onChange({ currentTarget: input });
    await flushPromises();
  });
  await act(async () => {
    input.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
    await flushPromises();
  });

  expect(useEditorStore.getState().historyCheckpoints[0]?.label).toBe('Proof candidate');
  await act(async () => {
    useEditorStore.getState().goToHistoryIndex(0);
    getRequired<HTMLButtonElement>(container, '[role="option"]').click();
  });
  expect(useEditorStore.getState().historyIndex).toBe(1);
  expect(useEditorStore.getState().adjustments).toEqual(exposure);
});

async function render(component: typeof EditorHistorySection | typeof EditorSnapshotsSection) {
  installDom();
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(component));
    await flushPromises();
  });
  renderedRoot = { container, root };
  return container;
}

function getRequired<T extends Element = Element>(container: Element, selector: string): T {
  const element = container.querySelector<T>(selector);
  if (element === null) throw new Error(`Expected ${selector} to render.`);
  return element;
}

function installDom() {
  const window = new Window({ url: 'http://localhost/editor-history-sections-test' });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window, writable: true });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: window.document, writable: true });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: window.navigator, writable: true });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: window.HTMLElement, writable: true });
  Object.defineProperty(globalThis, 'HTMLInputElement', {
    configurable: true,
    value: window.HTMLInputElement,
    writable: true,
  });
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    configurable: true,
    value: (callback: FrameRequestCallback) => setTimeout(callback, 0),
    writable: true,
  });
}

async function flushPromises() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
