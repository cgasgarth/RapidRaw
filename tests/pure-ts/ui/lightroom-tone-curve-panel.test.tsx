import { expect, test } from 'bun:test';
import { fireEvent, render } from '@testing-library/react';
import i18next from 'i18next';
import { createElement, useState } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import CurveGraph, { type CurveAdjustmentView } from '../../../src/components/adjustments/Curves';
import { Theme } from '../../../src/components/ui/AppProperties';
import { ContextMenuProvider } from '../../../src/context/ContextMenuContext';
import en from '../../../src/i18n/locales/en.json';
import { selectEditDocumentNode } from '../../../src/utils/editDocumentSelectors';
import { createDefaultEditDocumentV2 } from '../../../src/utils/editDocumentV2';

const i18n = i18next.createInstance();
await i18n.use(initReactI18next).init({
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  lng: 'en',
  react: { useSuspense: false },
  resources: { en: { translation: en } },
});

const defaultCurve = (): CurveAdjustmentView =>
  structuredClone(selectEditDocumentNode(createDefaultEditDocumentV2(), 'scene_curve').params);

test('Tone Curve keeps the point/parametric workflow primary and exposes advanced domains', () => {
  const view = render(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(ContextMenuProvider, null, createElement(CurveHarness, { initialAdjustments: defaultCurve() })),
    ),
  );

  const panel = required(view.container, '[data-testid="tone-curve-panel"]');
  const editor = required(panel, '[data-testid="curves-editor"]');
  expect(editor.getAttribute('data-curve-mode')).toBe('point');
  expect(editor.getAttribute('data-active-channel')).toBe('luma');
  expect(panel.querySelector('[data-testid="tone-curve-mode-switcher"]')).not.toBeNull();
  expect(panel.querySelector('[data-testid="tone-curve-channel-switcher"]')).not.toBeNull();
  expect(panel.querySelector('[data-advanced-curve-domain="true"]')).not.toBeNull();
  expect(panel.querySelectorAll('circle[role="button"]')).toHaveLength(2);

  const region = required<HTMLDivElement>(panel, '[role="region"]');
  region.getBoundingClientRect = () =>
    ({ bottom: 255, height: 255, left: 0, right: 255, top: 0, width: 255 }) as DOMRect;
  fireEvent.mouseDown(region, { button: 0, clientX: 128, clientY: 128 });
  fireEvent.mouseUp(window);
  expect(panel.querySelectorAll('circle[role="button"]')).toHaveLength(3);

  const point = required<SVGCircleElement>(panel, 'circle[role="button"]:nth-of-type(1)');
  fireEvent.keyDown(point, { key: 'ArrowUp' });
  expect(point.getAttribute('aria-label')).toContain('Y Axis 1');

  fireEvent.click(required<HTMLButtonElement>(panel, 'button[aria-label="Green"]'));
  expect(editor.getAttribute('data-active-channel')).toBe('green');
  fireEvent.click(required<HTMLButtonElement>(panel, 'button[aria-label="Parametric Curve"]'));
  expect(editor.getAttribute('data-curve-mode')).toBe('parametric');
  expect(panel.querySelector('[aria-label="Highlights"]')).not.toBeNull();

  fireEvent.click(
    required<HTMLButtonElement>(panel, '[data-testid="curve-domain-switcher"] button[aria-label="Scene"]'),
  );
  expect(panel.querySelector('[data-testid="typed-curve-editor"]')).not.toBeNull();
  fireEvent.click(
    required<HTMLButtonElement>(panel, '[data-testid="curve-domain-switcher"] button[aria-label="Tone Curve"]'),
  );
  expect(panel.querySelector('[data-testid="curves-editor"]')).not.toBeNull();

  view.unmount();
});

test('Tone Curve reports one interaction boundary for drag commit and cancel', () => {
  const lifecycle = { cancel: 0, commit: 0, start: 0 };
  const view = render(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(
        ContextMenuProvider,
        null,
        createElement(CurveHarness, {
          initialAdjustments: defaultCurve(),
          onInteractionCancel: () => {
            lifecycle.cancel += 1;
          },
          onInteractionCommit: () => {
            lifecycle.commit += 1;
          },
          onInteractionStart: () => {
            lifecycle.start += 1;
          },
        }),
      ),
    ),
  );
  const region = required<HTMLDivElement>(view.container, '[role="region"]');
  region.getBoundingClientRect = () =>
    ({ bottom: 255, height: 255, left: 0, right: 255, top: 0, width: 255 }) as DOMRect;
  fireEvent.mouseDown(region, { button: 0, clientX: 128, clientY: 128 });
  fireEvent.mouseMove(window, { clientX: 140, clientY: 110 });
  fireEvent.mouseUp(window);
  expect(lifecycle).toEqual({ cancel: 0, commit: 1, start: 1 });

  const point = view.container.querySelectorAll<SVGCircleElement>('circle[role="button"]')[1];
  if (point === undefined) throw new Error('Expected a second curve point.');
  fireEvent.mouseDown(point, { button: 0, clientX: 128, clientY: 128 });
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(lifecycle).toEqual({ cancel: 1, commit: 1, start: 2 });
  view.unmount();
});

function CurveHarness({
  initialAdjustments,
  onInteractionCancel,
  onInteractionCommit,
  onInteractionStart,
}: {
  initialAdjustments: CurveAdjustmentView;
  onInteractionCancel?: () => void;
  onInteractionCommit?: () => void;
  onInteractionStart?: () => void;
}) {
  const [adjustments, setAdjustments] = useState(initialAdjustments);
  return createElement(CurveGraph, {
    adjustments,
    histogram: null,
    onInteractionCancel,
    onInteractionCommit,
    onInteractionStart,
    setAdjustments: (update) => {
      setAdjustments((previous) => update(previous));
    },
    theme: Theme.Dark,
  });
}

function required<T extends Element>(container: Element, selector: string): T {
  const element = container.querySelector<T>(selector);
  if (element === null) throw new Error(`Expected ${selector} to render.`);
  return element;
}
