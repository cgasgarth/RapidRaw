import { expect, test } from 'bun:test';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { createElement, type MouseEvent as ReactMouseEvent } from 'react';

const { ContextMenuProvider, useContextMenu } = await import('../../../src/context/ContextMenuContext');

test('keyboard focus does not scroll-close the root menu or its submenu', async () => {
  const originalFocus = HTMLElement.prototype.focus;
  const focusOptions: Array<FocusOptions | undefined> = [];
  HTMLElement.prototype.focus = function focus(options?: FocusOptions) {
    focusOptions.push(options);
    if (!options?.preventScroll) window.dispatchEvent(new Event('scroll'));
    originalFocus.call(this, options);
  };

  try {
    const { container } = render(createElement(ContextMenuProvider, null, createElement(MenuLauncher)));

    const launcher = required<HTMLButtonElement>(container, '[data-testid="menu-launcher"]');
    fireEvent.contextMenu(launcher, { clientX: 20, clientY: 20 });
    await waitFor(() => expect(activeMenuText()).toBe('First'));
    expect(activeMenuText()).toBe('First');

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'ArrowDown' });
    await waitFor(() => expect(activeMenuText()).toBe('Productivity'));
    expect(activeMenuText()).toBe('Productivity');

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'ArrowRight' });
    await waitFor(() => expect(activeMenuText()).toBe('Auto Adjust Image'));
    expect(activeMenuText()).toBe('Auto Adjust Image');
    expect([...document.querySelectorAll('[role="menu"]')]).toHaveLength(2);
    expect(focusOptions.length).toBeGreaterThanOrEqual(3);
    expect(focusOptions.every((options) => options?.preventScroll === true)).toBe(true);
  } finally {
    HTMLElement.prototype.focus = originalFocus;
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
