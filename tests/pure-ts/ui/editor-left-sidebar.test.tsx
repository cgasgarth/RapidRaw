import { afterEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import i18next from 'i18next';
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import EditorLeftSidebar, {
  EDITOR_LEFT_SECTION_IDS,
  type EditorLeftSectionId,
} from '../../../src/components/panel/editor/EditorLeftSidebar';

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
});

test('renders one ordered Develop workflow with stable accessible slots and one scroll root', async () => {
  const { container } = await renderSidebar();
  const region = getRequiredElement<HTMLElement>(container, 'aside[aria-label="Develop workflow"]');
  const slotIds = Array.from(region.querySelectorAll<HTMLElement>('[data-editor-left-slot]')).map((slot) =>
    slot.getAttribute('data-editor-left-slot'),
  );

  expect(slotIds).toEqual([...EDITOR_LEFT_SECTION_IDS]);
  expect(region.querySelectorAll('[data-testid="editor-left-scroll-root"]')).toHaveLength(1);
  expect(region.querySelectorAll('[data-editor-left-slot]')).toHaveLength(4);
  expect(getRequiredElement<HTMLElement>(container, '[data-testid="editor-left-region"]').style.width).toBe('296px');
  expect(getRequiredElement(container, '[data-testid="editor-left-resizer"]').getAttribute('aria-label')).toBe(
    'Resize Develop workflow',
  );
});

test('persists section disclosure changes through the typed callback', async () => {
  const changes: Array<[EditorLeftSectionId, boolean]> = [];
  const { container } = await renderSidebar({ changes });
  const presets = getRequiredElement<HTMLButtonElement>(container, '[data-testid="editor-left-presets-toggle"]');

  await act(async () => {
    presets.click();
    await flushPromises();
  });

  expect(changes).toEqual([['presets', false]]);
  expect(presets.getAttribute('aria-expanded')).toBe('false');
});

test('collapse restores focus to the stable expand control and preserves geometry', async () => {
  const { container } = await renderSidebar();
  const collapse = getRequiredElement<HTMLButtonElement>(container, '[data-testid="editor-left-collapse"]');

  await act(async () => {
    collapse.focus();
    collapse.click();
    await flushPromises();
  });

  const expand = getRequiredElement<HTMLButtonElement>(container, '[data-testid="editor-left-expand"]');
  const sidebar = getRequiredElement<HTMLElement>(container, 'aside[aria-label="Develop workflow"]');
  expect(document.activeElement).toBe(expand);
  expect(sidebar.getAttribute('data-editor-left-state')).toBe('collapsed');
  expect(sidebar.style.width).toBe('32px');
  expect(getRequiredElement<HTMLElement>(container, '[data-testid="editor-left-region"]').style.width).toBe('32px');
  expect(container.querySelector('[data-testid="editor-left-resizer"]')).toBeNull();
});

function SidebarHarness({ changes = [] }: { changes?: Array<[EditorLeftSectionId, boolean]> }) {
  const [expandedSections, setExpandedSections] = useState<EditorLeftSectionId[]>(['navigator', 'presets']);
  const [isVisible, setIsVisible] = useState(true);

  return createElement(EditorLeftSidebar, {
    expandedSections,
    isFullScreen: false,
    isResizing: false,
    isVisible,
    onResizeStart: () => undefined,
    onSectionExpandedChange: (sectionId, expanded) => {
      changes.push([sectionId, expanded]);
      setExpandedSections((current) =>
        expanded ? [...new Set([...current, sectionId])] : current.filter((currentId) => currentId !== sectionId),
      );
    },
    onVisibleChange: setIsVisible,
    width: 288,
  });
}

async function renderSidebar({ changes = [] }: { changes?: Array<[EditorLeftSectionId, boolean]> } = {}) {
  installDom();
  const i18n = i18next.createInstance();
  await i18n.use(initReactI18next).init({ fallbackLng: 'en', lng: 'en', react: { useSuspense: false } });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(createElement(I18nextProvider, { i18n }, createElement(SidebarHarness, { changes })));
    await flushPromises();
  });

  renderedRoot = { container, root };
  return { container, root };
}

function getRequiredElement<T extends Element = Element>(container: Element, selector: string): T {
  const element = container.querySelector<T>(selector);
  if (element === null) throw new Error(`Expected ${selector} to render.`);
  return element;
}

function installDom() {
  const window = new Window({ url: 'http://localhost/editor-left-sidebar-test' });
  class TestResizeObserver {
    observe() {}
    disconnect() {}
  }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: window.document });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: window.navigator });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: window.HTMLElement });
  Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: TestResizeObserver });
}

async function flushPromises() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
