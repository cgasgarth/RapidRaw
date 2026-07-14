import { afterEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act, createElement, type MouseEvent as ReactMouseEvent } from 'react';
import { createRoot, type Root } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const testWindow = new Window({ pretendToBeVisual: true, url: 'http://localhost/context-menu-keyboard' });
Object.assign(globalThis, {
  document: testWindow.document,
  Element: testWindow.Element,
  Event: testWindow.Event,
  HTMLElement: testWindow.HTMLElement,
  HTMLButtonElement: testWindow.HTMLButtonElement,
  KeyboardEvent: testWindow.KeyboardEvent,
  MouseEvent: testWindow.MouseEvent,
  Node: testWindow.Node,
  navigator: testWindow.navigator,
  requestAnimationFrame: testWindow.requestAnimationFrame.bind(testWindow),
  window: testWindow,
});

const { ContextMenuProvider, useContextMenu } = await import('../../../src/context/ContextMenuContext');

let renderedRoot: { container: HTMLDivElement; root: Root } | null = null;

afterEach(() => {
  if (renderedRoot) {
    act(() => renderedRoot?.root.unmount());
    renderedRoot.container.remove();
    renderedRoot = null;
  }
  document.body.replaceChildren();
});

test('keyboard focus does not scroll-close the root menu or its submenu', async () => {
  const originalFocus = testWindow.HTMLElement.prototype.focus;
  const focusOptions: Array<FocusOptions | undefined> = [];
  testWindow.HTMLElement.prototype.focus = function focus(options?: FocusOptions) {
    focusOptions.push(options);
    if (!options?.preventScroll) window.dispatchEvent(new Event('scroll'));
    originalFocus.call(this, options);
  };

  try {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    renderedRoot = { container, root };
    await act(async () => {
      root.render(createElement(ContextMenuProvider, null, createElement(MenuLauncher)));
      await flush();
    });

    const launcher = required<HTMLButtonElement>(container, '[data-testid="menu-launcher"]');
    await act(async () => {
      launcher.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 20, clientY: 20 }));
      await flush();
    });
    expect(activeMenuText()).toBe('First');

    await act(async () => {
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }));
      await flush();
    });
    expect(activeMenuText()).toBe('Productivity');

    await act(async () => {
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }));
      await flush();
    });
    expect(activeMenuText()).toBe('Auto Adjust Image');
    expect([...document.querySelectorAll('[role="menu"]')]).toHaveLength(2);
    expect(focusOptions.length).toBeGreaterThanOrEqual(3);
    expect(focusOptions.every((options) => options?.preventScroll === true)).toBe(true);
  } finally {
    testWindow.HTMLElement.prototype.focus = originalFocus;
  }
});

function MenuLauncher() {
  const { showContextMenu } = useContextMenu();
  return createElement(
    'button',
    {
      'data-testid': 'menu-launcher',
      onContextMenu: (event: ReactMouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        showContextMenu(20, 20, [
          { label: 'First', onClick: () => undefined },
          {
            label: 'Productivity',
            submenu: [{ label: 'Auto Adjust Image', onClick: () => undefined }],
          },
        ]);
      },
    },
    'Open menu',
  );
}

function activeMenuText(): string {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || active.getAttribute('role') !== 'menuitem') return '';
  return active.textContent?.trim() ?? '';
}

function required<T extends Element>(container: ParentNode, selector: string): T {
  const element = container.querySelector<T>(selector);
  if (!element) throw new Error(`Expected ${selector}`);
  return element;
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20));
}
