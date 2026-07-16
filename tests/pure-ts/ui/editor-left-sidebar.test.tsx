import { expect, test } from 'bun:test';
import { render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { createElement, useEffect, useState } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import EditorLeftSidebar, {
  EDITOR_LEFT_SECTION_IDS,
  type EditorLeftSectionId,
} from '../../../src/components/panel/editor/EditorLeftSidebar';

test('renders one ordered Develop workflow with stable accessible slots and one scroll root', async () => {
  const { container } = await renderSidebar();
  const region = getRequiredElement<HTMLElement>(container, 'aside[aria-label="Develop workflow"]');
  const slotIds = Array.from(region.querySelectorAll<HTMLElement>('[data-editor-left-slot]')).map((slot) =>
    slot.getAttribute('data-editor-left-slot'),
  );

  expect(slotIds).toEqual([...EDITOR_LEFT_SECTION_IDS]);
  expect(region.querySelectorAll('[data-testid="editor-left-scroll-root"]')).toHaveLength(1);
  expect(region.querySelectorAll('[data-editor-left-slot]')).toHaveLength(5);
  expect(getRequiredElement(region, '[data-editor-left-slot="navigator"]').textContent).toBe('');
  expect(getRequiredElement(region, '[data-editor-left-slot="presets"]').textContent).toBe('');
  expect(getRequiredElement<HTMLElement>(container, '[data-testid="editor-left-region"]').style.width).toBe('296px');
  expect(getRequiredElement(container, '[data-testid="editor-left-resizer"]').getAttribute('aria-label')).toBe(
    'Resize Develop workflow',
  );
});

test('persists section disclosure changes through the typed callback', async () => {
  const user = userEvent.setup();
  const changes: Array<[EditorLeftSectionId, boolean]> = [];
  const { container } = await renderSidebar({ changes });
  const presets = getRequiredElement<HTMLButtonElement>(container, '[data-testid="editor-left-presets-toggle"]');

  await user.click(presets);

  expect(changes).toEqual([['presets', false]]);
  expect(presets.getAttribute('aria-expanded')).toBe('false');
});

test('collapse restores focus to the stable expand control and preserves geometry', async () => {
  const user = userEvent.setup();
  const { container } = await renderSidebar();
  const collapse = getRequiredElement<HTMLButtonElement>(container, '[data-testid="editor-left-collapse"]');

  collapse.focus();
  await user.click(collapse);

  const expand = getRequiredElement<HTMLButtonElement>(container, '[data-testid="editor-left-expand"]');
  const sidebar = getRequiredElement<HTMLElement>(container, 'aside[aria-label="Develop workflow"]');
  await waitFor(() => expect(document.activeElement).toBe(expand));
  expect(sidebar.getAttribute('data-editor-left-state')).toBe('collapsed');
  expect(sidebar.style.width).toBe('32px');
  expect(getRequiredElement<HTMLElement>(container, '[data-testid="editor-left-region"]').style.width).toBe('32px');
  expect(container.querySelector('[data-testid="editor-left-resizer"]')).toBeNull();
});

test('unmounts Presets workflow when its section or sidebar collapses', async () => {
  const user = userEvent.setup();
  const lifecycle: string[] = [];
  const { container } = await renderSidebar({ lifecycle });

  expect(lifecycle).toEqual(['mounted']);

  await user.click(getRequiredElement<HTMLButtonElement>(container, '[data-testid="editor-left-presets-toggle"]'));
  expect(lifecycle).toEqual(['mounted', 'unmounted']);

  await user.click(getRequiredElement<HTMLButtonElement>(container, '[data-testid="editor-left-presets-toggle"]'));
  expect(lifecycle).toEqual(['mounted', 'unmounted', 'mounted']);

  await user.click(getRequiredElement<HTMLButtonElement>(container, '[data-testid="editor-left-collapse"]'));
  expect(lifecycle).toEqual(['mounted', 'unmounted', 'mounted', 'unmounted']);
});

function PresetsLifecycleProbe({ lifecycle }: { lifecycle: string[] }) {
  useEffect(() => {
    lifecycle.push('mounted');
    return () => {
      lifecycle.push('unmounted');
    };
  }, [lifecycle]);
  return createElement('div', { 'data-testid': 'presets-workflow' });
}

function SidebarHarness({
  changes = [],
  lifecycle,
}: {
  changes?: Array<[EditorLeftSectionId, boolean]>;
  lifecycle?: string[];
}) {
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
    ...(lifecycle === undefined ? {} : { slots: { presets: createElement(PresetsLifecycleProbe, { lifecycle }) } }),
    width: 288,
  });
}

async function renderSidebar({
  changes = [],
  lifecycle,
}: {
  changes?: Array<[EditorLeftSectionId, boolean]>;
  lifecycle?: string[];
} = {}) {
  const i18n = i18next.createInstance();
  await i18n.use(initReactI18next).init({ fallbackLng: 'en', lng: 'en', react: { useSuspense: false } });
  return render(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(SidebarHarness, { changes, ...(lifecycle === undefined ? {} : { lifecycle }) }),
    ),
  );
}

function getRequiredElement<T extends Element = Element>(container: Element, selector: string): T {
  const element = container.querySelector<T>(selector);
  if (element === null) throw new Error(`Expected ${selector} to render.`);
  return element;
}
