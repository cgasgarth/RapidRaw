import { afterEach, describe, expect, test } from 'bun:test';
import { ClerkProvider } from '@clerk/react';
import { Window } from 'happy-dom';
import i18next from 'i18next';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { Mask } from '../../../src/components/panel/right/layers/Masks.tsx';
import { MasksPanel } from '../../../src/components/panel/right/layers/MasksPanel.tsx';
import { ContextMenuProvider } from '../../../src/context/ContextMenuContext.tsx';
import en from '../../../src/i18n/locales/en.json';
import { useEditorStore } from '../../../src/store/useEditorStore.ts';
import { INITIAL_ADJUSTMENTS, INITIAL_MASK_ADJUSTMENTS, type MaskContainer } from '../../../src/utils/adjustments.ts';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const firstMask: MaskContainer = {
  adjustments: structuredClone(INITIAL_MASK_ADJUSTMENTS),
  id: 'mask-first',
  invert: false,
  name: 'Sky recovery',
  opacity: 100,
  subMasks: [],
  visible: true,
};

const secondMask: MaskContainer = {
  adjustments: structuredClone(INITIAL_MASK_ADJUSTMENTS),
  id: 'mask-second',
  invert: false,
  name: 'Foreground lift',
  opacity: 100,
  subMasks: [],
  visible: true,
};

let renderedRoot: { container: HTMLDivElement; root: Root } | null = null;

afterEach(() => {
  if (renderedRoot !== null) {
    act(() => {
      renderedRoot?.root.unmount();
    });
    renderedRoot.container.remove();
    renderedRoot = null;
  }
  useEditorStore.setState({
    activeMaskContainerId: null,
    activeMaskId: null,
    adjustments: INITIAL_ADJUSTMENTS,
    history: [INITIAL_ADJUSTMENTS],
    historyIndex: 0,
    selectedImage: null,
  });
});

describe('compact masks panel workflow', () => {
  test('keeps create, select, visibility, keyboard, and context-menu commands bound to the mask state', async () => {
    const adjustments = { ...INITIAL_ADJUSTMENTS, masks: [firstMask, secondMask] };
    useEditorStore.setState({
      activeMaskContainerId: secondMask.id,
      activeMaskId: null,
      adjustments,
      history: [adjustments],
      historyIndex: 0,
      selectedImage: null,
    });

    const { container } = await renderMasksPanel();
    const firstRow = required<HTMLElement>(container, '[data-testid="mask-container-row-mask-first"]');
    const secondRow = required<HTMLElement>(container, '[data-testid="mask-container-row-mask-second"]');
    const initialActiveContainerId = useEditorStore.getState().activeMaskContainerId;
    if (initialActiveContainerId === null) throw new Error('Expected the mask panel to select an initial mask.');

    expect(required<HTMLElement>(container, '[data-testid="mask-panel-mask-count"]').textContent).toBe('2');
    expect(required<HTMLElement>(container, '[data-testid="mask-stack-count"]').textContent).toBe('2');
    expect(
      required<HTMLElement>(container, `[data-testid="mask-container-row-${initialActiveContainerId}"]`).dataset
        .maskContainerActive,
    ).toBe('true');
    expect(firstRow.dataset.maskContainerVisible).toBe('true');

    await clickControl(container, '[data-testid="mask-contextual-create-brush"]');

    const activeContainer = useEditorStore
      .getState()
      .adjustments.masks.find((mask) => mask.id === initialActiveContainerId);
    const createdSubMask = activeContainer?.subMasks[0];
    expect(createdSubMask?.type).toBe(Mask.Brush);
    expect(useEditorStore.getState().activeMaskContainerId).toBe(initialActiveContainerId);
    expect(useEditorStore.getState().activeMaskId).toBe(createdSubMask?.id);
    expect(
      required<HTMLElement>(container, `[data-testid="mask-submask-row-${createdSubMask?.id ?? ''}"]`).dataset
        .maskSubmaskActive,
    ).toBe('true');

    await act(async () => {
      required<HTMLButtonElement>(firstRow, '[aria-label="Hide Mask"]').click();
      await flush();
    });

    expect(useEditorStore.getState().adjustments.masks[0]?.visible).toBe(false);
    expect(firstRow.dataset.maskContainerVisible).toBe('false');

    await act(async () => {
      firstRow.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
      await flush();
    });

    expect(useEditorStore.getState().activeMaskContainerId).toBe(firstMask.id);
    expect(firstRow.getAttribute('aria-current')).toBe('true');

    await act(async () => {
      secondRow.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
      await flush();
    });

    expect(useEditorStore.getState().activeMaskContainerId).toBe(secondMask.id);
    expect(useEditorStore.getState().activeMaskId).toBeNull();
    expect(secondRow.getAttribute('aria-current')).toBe('true');

    await act(async () => {
      secondRow.dispatchEvent(
        new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 16, clientY: 16 }),
      );
      await flush();
    });

    const duplicate = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find((button) =>
      button.textContent?.includes('Duplicate Mask'),
    );
    if (duplicate === undefined) throw new Error('Expected Duplicate Mask in the mask context menu.');

    await act(async () => {
      duplicate.click();
      await flush();
    });

    expect(useEditorStore.getState().adjustments.masks).toHaveLength(3);
    expect(required<HTMLElement>(container, '[data-testid="mask-stack-count"]').textContent).toBe('3');
  });
});

async function renderMasksPanel() {
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
        createElement(I18nextProvider, { i18n }, createElement(ContextMenuProvider, null, createElement(MasksPanel))),
      ),
    );
    await flush();
    await flush();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await flush();
  });

  renderedRoot = { container, root };
  return { container, root };
}

function required<T extends Element>(container: Element, selector: string): T {
  const element = container.querySelector<T>(selector);
  if (element === null) throw new Error(`Expected ${selector} to render.`);
  return element;
}

async function clickControl(container: Element, selector: string) {
  await act(async () => {
    required<HTMLButtonElement>(container, selector).click();
    await flush();
    await flush();
  });
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function installDom() {
  const window = new Window({ url: 'http://localhost/masks-panel-test' });
  Object.defineProperty(window, '__TAURI_INTERNALS__', {
    value: {
      invoke: async (command: string) => (command === 'load_presets' ? [] : null),
    },
  });
  Object.assign(globalThis, {
    document: window.document,
    HTMLElement: window.HTMLElement,
    HTMLInputElement: window.HTMLInputElement,
    KeyboardEvent: window.KeyboardEvent,
    MouseEvent: window.MouseEvent,
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
