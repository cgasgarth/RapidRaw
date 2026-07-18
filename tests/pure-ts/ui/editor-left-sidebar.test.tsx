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
  expect(region.querySelectorAll('[data-editor-left-slot]')).toHaveLength(6);
  expect(getRequiredElement(region, '[data-editor-left-slot="navigator"]').textContent).toBe('');
  expect(getRequiredElement(region, '[data-editor-left-slot="presets"]').textContent).toBe('');
  expect(getRequiredElement<HTMLElement>(container, '[data-testid="editor-left-region"]').style.width).toBe('292px');
  expect(getRequiredElement(container, 'header').className).toContain('!min-h-9');
  expect(getRequiredElement(container, '[data-testid="editor-left-resizer"]').getAttribute('aria-label')).toBe(
    'Resize Develop workflow',
  );
  expect(region.querySelector('h2')).toBeNull();
  expect(
    getRequiredElement<HTMLElement>(region, '[data-editor-left-slot="navigator"]').dataset['editorLeftPrimary'],
  ).toBe('true');
  expect(getRequiredElement<HTMLElement>(region, '[data-editor-left-slot="presets"]').className).not.toContain(
    'bg-editor-panel-well',
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

test('supports optional solo disclosure without losing persisted section order', async () => {
  const user = userEvent.setup();
  const soloChanges: Array<EditorLeftSectionId | null> = [];
  const { container } = await renderSidebar({ soloChanges });

  await user.click(getRequiredElement<HTMLButtonElement>(container, '[data-testid="editor-left-navigator-solo"]'));

  expect(soloChanges).toEqual(['navigator']);
  expect(
    getRequiredElement<HTMLButtonElement>(container, '[data-testid="editor-left-navigator-toggle"]').getAttribute(
      'aria-expanded',
    ),
  ).toBe('true');
  expect(
    getRequiredElement<HTMLButtonElement>(container, '[data-testid="editor-left-presets-toggle"]').getAttribute(
      'aria-expanded',
    ),
  ).toBe('false');
  expect(
    getRequiredElement(container, '[data-editor-left-slot="navigator"]').getAttribute('data-editor-left-solo'),
  ).toBe('true');

  await user.click(getRequiredElement<HTMLButtonElement>(container, '[data-testid="editor-left-presets-solo"]'));
  expect(soloChanges).toEqual(['navigator', 'presets']);
  expect(getRequiredElement(container, '[data-editor-left-slot="presets"]').getAttribute('data-editor-left-solo')).toBe(
    'true',
  );
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

test('fullscreen temporarily removes left-rail focus and restores the prior control', async () => {
  const rendered = await renderSidebar();
  const collapse = getRequiredElement<HTMLButtonElement>(rendered.container, '[data-testid="editor-left-collapse"]');
  collapse.focus();

  rendered.rerender(
    createElement(
      I18nextProvider,
      { i18n: await createTestI18n() },
      createElement(SidebarHarness, { isFullScreen: true }),
    ),
  );
  await waitFor(() => expect(document.activeElement).not.toBe(collapse));

  rendered.rerender(
    createElement(
      I18nextProvider,
      { i18n: await createTestI18n() },
      createElement(SidebarHarness, { isFullScreen: false }),
    ),
  );
  await waitFor(() => expect(document.activeElement?.getAttribute('data-testid')).toBe('editor-left-collapse'));
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
  isFullScreen = false,
  lifecycle,
  soloChanges,
}: {
  changes?: Array<[EditorLeftSectionId, boolean]>;
  isFullScreen?: boolean;
  lifecycle?: string[];
  soloChanges?: Array<EditorLeftSectionId | null>;
}) {
  const [expandedSections, setExpandedSections] = useState<EditorLeftSectionId[]>(['navigator', 'presets']);
  const [soloSectionId, setSoloSectionId] = useState<EditorLeftSectionId | null>(null);
  const [isVisible, setIsVisible] = useState(true);

  return createElement(EditorLeftSidebar, {
    expandedSections,
    isFullScreen,
    isResizing: false,
    isVisible,
    onResizeStart: () => undefined,
    onSectionExpandedChange: (sectionId, expanded) => {
      changes.push([sectionId, expanded]);
      setExpandedSections((current) =>
        expanded ? [...new Set([...current, sectionId])] : current.filter((currentId) => currentId !== sectionId),
      );
    },
    ...(soloChanges === undefined
      ? {}
      : {
          onSectionSoloChange: (sectionId: EditorLeftSectionId | null) => {
            soloChanges.push(sectionId);
            setSoloSectionId(sectionId);
          },
          soloSectionId,
        }),
    onVisibleChange: setIsVisible,
    ...(lifecycle === undefined ? {} : { slots: { presets: createElement(PresetsLifecycleProbe, { lifecycle }) } }),
    width: 288,
  });
}

async function renderSidebar({
  changes = [],
  isFullScreen = false,
  lifecycle,
  soloChanges,
}: {
  changes?: Array<[EditorLeftSectionId, boolean]>;
  isFullScreen?: boolean;
  lifecycle?: string[];
  soloChanges?: Array<EditorLeftSectionId | null>;
} = {}) {
  const i18n = i18next.createInstance();
  await i18n.use(initReactI18next).init({ fallbackLng: 'en', lng: 'en', react: { useSuspense: false } });
  return render(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(SidebarHarness, {
        changes,
        isFullScreen,
        ...(lifecycle === undefined ? {} : { lifecycle }),
        ...(soloChanges === undefined ? {} : { soloChanges }),
      }),
    ),
  );
}

async function createTestI18n() {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({ fallbackLng: 'en', lng: 'en', react: { useSuspense: false } });
  return instance;
}

function getRequiredElement<T extends Element = Element>(container: Element, selector: string): T {
  const element = container.querySelector<T>(selector);
  if (element === null) throw new Error(`Expected ${selector} to render.`);
  return element;
}
