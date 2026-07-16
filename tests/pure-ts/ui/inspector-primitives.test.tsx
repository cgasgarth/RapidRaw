import { expect, test } from 'bun:test';
import { fireEvent, render, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { createElement, useState } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import CollapsibleSection from '../../../src/components/ui/CollapsibleSection.tsx';
import InspectorSegmentedControl from '../../../src/components/ui/primitives/InspectorSegmentedControl.tsx';

test('collapsible sections restore focus to their disclosure and inert hidden controls', async () => {
  const { container } = await renderWithI18n(createElement(CollapsibleHarness));
  const toggle = getRequiredElement<HTMLButtonElement>(container, '[data-testid="tone-section-toggle"]');
  const input = getRequiredElement<HTMLInputElement>(container, '[data-testid="tone-section-input"]');

  input.focus();
  fireEvent.click(toggle);

  const region = getRequiredElement<HTMLDivElement>(container, '[role="region"]');
  await waitFor(() => expect(document.activeElement).toBe(toggle));
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(region.getAttribute('aria-hidden')).toBe('true');
  expect(region.inert).toBe(true);
});

test('collapsible sections retain Shift+F10 actions without nesting action buttons in the disclosure', async () => {
  const actionPositions: Array<[number, number]> = [];
  const { container } = await renderWithI18n(
    createElement(CollapsibleHarness, {
      onOpenActionsMenu: (x: number, y: number) => {
        actionPositions.push([x, y]);
      },
    }),
  );
  const toggle = getRequiredElement<HTMLButtonElement>(container, '[data-testid="tone-section-toggle"]');

  fireEvent.keyDown(toggle, { key: 'F10', shiftKey: true });

  expect(actionPositions).toHaveLength(1);
  expect(toggle.querySelector('button')).toBeNull();
});

test('segmented controls use roving focus with arrow, Home, and End keyboard selection', async () => {
  const changes: string[] = [];
  const { container } = await renderWithI18n(createElement(SegmentedHarness, { changes }));
  const raw = getRequiredElement<HTMLButtonElement>(container, '[role="radio"][aria-checked="true"]');

  raw.focus();
  fireEvent.keyDown(raw, { key: 'ArrowRight' });
  expect(changes).toEqual(['proof']);
  expect(document.activeElement?.textContent).toBe('Proof');

  const proof = getRequiredElement<HTMLButtonElement>(container, '[role="radio"][aria-checked="true"]');
  fireEvent.keyDown(proof, { key: 'End' });
  expect(changes).toEqual(['proof', 'mask']);
  expect(document.activeElement?.textContent).toBe('Mask');

  const mask = getRequiredElement<HTMLButtonElement>(container, '[role="radio"][aria-checked="true"]');
  fireEvent.keyDown(mask, { key: 'Home' });
  expect(changes).toEqual(['proof', 'mask', 'raw']);
  expect(document.activeElement?.textContent).toBe('RAW');
});

function CollapsibleHarness({ onOpenActionsMenu }: { onOpenActionsMenu?: (x: number, y: number) => void }) {
  const [isOpen, setIsOpen] = useState(true);

  return createElement(
    CollapsibleSection,
    {
      isContentVisible: true,
      isDirty: true,
      isOpen,
      onOpenActionsMenu,
      onToggle: () => {
        setIsOpen((current) => !current);
      },
      testId: 'tone-section',
      title: 'Tone',
    },
    createElement('input', { 'data-testid': 'tone-section-input' }),
  );
}

function SegmentedHarness({ changes }: { changes: string[] }) {
  const [value, setValue] = useState<'raw' | 'proof' | 'mask'>('raw');

  return createElement(InspectorSegmentedControl, {
    ariaLabel: 'Preview mode',
    onChange: (nextValue) => {
      changes.push(nextValue);
      setValue(nextValue);
    },
    options: [
      { label: 'RAW', value: 'raw' },
      { label: 'Proof', value: 'proof' },
      { label: 'Mask', value: 'mask' },
    ],
    value,
  });
}

async function renderWithI18n(element: React.ReactNode) {
  const i18n = await createTestI18n();
  return render(createElement(I18nextProvider, { i18n }, element));
}

function getRequiredElement<T extends Element>(container: Element, selector: string): T {
  const element = container.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`Expected ${selector} to render.`);
  }
  return element;
}

async function createTestI18n() {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    defaultNS: 'translation',
    interpolation: { escapeValue: false },
    lng: 'en',
    react: { useSuspense: false },
    resources: {
      en: {
        translation: {
          ui: {
            collapsibleSection: {
              dirtyBadge: 'Edited',
              disabledBadge: 'Off',
            },
          },
        },
      },
    },
  });
  return instance;
}
