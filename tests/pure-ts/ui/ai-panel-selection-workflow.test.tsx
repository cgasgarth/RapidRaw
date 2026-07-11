import { afterEach, describe, expect, test } from 'bun:test';
import { ClerkProvider } from '@clerk/react';
import { Window } from 'happy-dom';
import i18next from 'i18next';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { AIPanel } from '../../../src/components/panel/right/ai/AIPanel.tsx';
import { Mask, type SubMask, SubMaskMode } from '../../../src/components/panel/right/layers/Masks.tsx';
import { ContextMenuProvider } from '../../../src/context/ContextMenuContext.tsx';
import en from '../../../src/i18n/locales/en.json';
import { useEditorStore } from '../../../src/store/useEditorStore.ts';
import { type AiPatch, INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments.ts';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const target = (id: string): SubMask => ({
  id,
  invert: false,
  mode: SubMaskMode.Additive,
  opacity: 100,
  type: Mask.Brush,
  visible: true,
});

const edit = (id: string, targets: Array<string>): AiPatch => ({
  id,
  invert: false,
  isLoading: false,
  name: id,
  patchData: null,
  prompt: '',
  subMasks: targets.map(target),
  visible: true,
});

let renderedRoot: { container: HTMLDivElement; root: Root } | null = null;

afterEach(() => {
  if (renderedRoot) {
    act(() => renderedRoot?.root.unmount());
    renderedRoot.container.remove();
    renderedRoot = null;
  }
  useEditorStore.setState({
    activeAiPatchContainerId: null,
    activeAiSubMaskId: null,
    adjustments: structuredClone(INITIAL_ADJUSTMENTS),
    history: [structuredClone(INITIAL_ADJUSTMENTS)],
    historyIndex: 0,
    selectedImage: null,
  });
});

describe('AI panel command-owned selection', () => {
  test('keeps manual collapse stable and commits adjacent deletion fallback without an Effect', async () => {
    const adjustments = {
      ...structuredClone(INITIAL_ADJUSTMENTS),
      aiPatches: [edit('first', ['one', 'middle', 'last']), edit('second', [])],
    };
    useEditorStore.setState({
      activeAiPatchContainerId: 'first',
      activeAiSubMaskId: null,
      adjustments,
      history: [adjustments],
      historyIndex: 0,
      selectedImage: {
        exif: null,
        height: 800,
        isRaw: false,
        isReady: true,
        originalUrl: null,
        path: '/test/image.jpg',
        thumbnailUrl: '',
        width: 1200,
      },
    });

    let passiveStoreWrites = 0;
    const unsubscribe = useEditorStore.subscribe(() => {
      passiveStoreWrites += 1;
    });
    const { container } = await renderAiPanel();
    unsubscribe();
    expect(passiveStoreWrites).toBe(0);
    const first = required<HTMLElement>(container, '[data-testid="inpaint-edit-first"]');
    expect(container.querySelector('[data-testid="inpaint-target-middle"]')).toBeNull();

    await click(required<HTMLButtonElement>(first, 'button'));
    const middle = required<HTMLElement>(container, '[data-testid="inpaint-target-middle"]');
    await click(middle);
    expect(useEditorStore.getState().activeAiSubMaskId).toBe('middle');

    await click(required<HTMLButtonElement>(first, 'button'));
    expect(required<HTMLButtonElement>(first, 'button').getAttribute('aria-label')).toBe('Expand edit targets');

    await act(async () => {
      useEditorStore.getState().applyAiEditCommand(({ aiPatches, selection }) => ({
        aiPatches: aiPatches.map((candidate) =>
          candidate.id === 'second' ? { ...candidate, visible: !candidate.visible } : candidate,
        ),
        selection,
      }));
      await flush();
    });
    expect(required<HTMLButtonElement>(first, 'button').getAttribute('aria-label')).toBe('Expand edit targets');
    expect(useEditorStore.getState().activeAiSubMaskId).toBe('middle');

    await click(required<HTMLButtonElement>(first, 'button'));
    const reopenedMiddle = required<HTMLElement>(container, '[data-testid="inpaint-target-middle"]');
    const deleteButton = required<HTMLButtonElement>(reopenedMiddle, 'button:last-of-type');
    await click(deleteButton);

    const state = useEditorStore.getState();
    expect(state.adjustments.aiPatches[0]?.subMasks.map((subMask) => subMask.id)).toEqual(['one', 'last']);
    expect(state.activeAiPatchContainerId).toBe('first');
    expect(state.activeAiSubMaskId).toBe('last');
    expect(required<HTMLElement>(container, '[data-testid="inpaint-target-last"]').getAttribute('aria-pressed')).toBe(
      'true',
    );
  });
});

async function renderAiPanel() {
  installDom();
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const i18n = await createTestI18n();

  await act(async () => {
    root.render(
      createElement(
        ClerkProvider,
        { publishableKey: 'pk_test_Y2xlcmsuZXhhbXBsZS5jb20k' },
        createElement(I18nextProvider, { i18n }, createElement(ContextMenuProvider, null, createElement(AIPanel))),
      ),
    );
    await flush();
    await flush();
  });
  renderedRoot = { container, root };
  return { container };
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.click();
    await flush();
    await flush();
  });
}

function required<T extends Element>(container: Element, selector: string): T {
  const element = container.querySelector<T>(selector);
  if (!element) throw new Error(`Expected ${selector} to render.`);
  return element;
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function installDom() {
  const window = new Window({ url: 'http://localhost/ai-panel-test' });
  Object.defineProperty(window, '__TAURI_INTERNALS__', {
    value: { invoke: async () => null },
  });
  Object.assign(globalThis, {
    document: window.document,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    HTMLInputElement: window.HTMLInputElement,
    KeyboardEvent: window.KeyboardEvent,
    MouseEvent: window.MouseEvent,
    Node: window.Node,
    navigator: window.navigator,
    window,
  });
  Object.assign(globalThis, { ResizeObserver: TestResizeObserver });
}

class TestResizeObserver {
  disconnect() {}
  observe(_target: Element, _options?: ResizeObserverOptions) {}
  unobserve(_target: Element) {}
}

async function createTestI18n() {
  const i18n = i18next.createInstance();
  await i18n.use(initReactI18next).init({
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    lng: 'en',
    resources: { en: { translation: en } },
  });
  return i18n;
}
