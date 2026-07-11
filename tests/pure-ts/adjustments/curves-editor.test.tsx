import { afterEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import i18next from 'i18next';
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import CurveGraph, {
  clientPointToCurvePoint,
  constrainCurvePoint,
  constrainParametricSplit,
} from '../../../src/components/adjustments/Curves.tsx';
import { Theme } from '../../../src/components/ui/AppProperties.tsx';
import { ContextMenuProvider } from '../../../src/context/ContextMenuContext.tsx';
import en from '../../../src/i18n/locales/en.json';
import { type Adjustments, INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments.ts';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let renderedRoot: { container: HTMLDivElement; root: Root } | null = null;

afterEach(() => {
  if (renderedRoot) {
    act(() => {
      renderedRoot?.root.unmount();
    });
    renderedRoot.container.remove();
    renderedRoot = null;
  }
});

test('curve graph geometry maps clients consistently and clamps outside coordinates', () => {
  expect(clientPointToCurvePoint(110, 220, { left: 10, top: 20, width: 200, height: 200 })).toEqual({
    x: 127.5,
    y: 0,
  });
  expect(clientPointToCurvePoint(60, 45, { left: 10, top: 20, width: 100, height: 50 })).toEqual({
    x: 127.5,
    y: 127.5,
  });
  expect(clientPointToCurvePoint(-100, -100, { left: 0, top: 0, width: 240, height: 240 })).toEqual({
    x: 0,
    y: 255,
  });
});

test('curve point constraints preserve ordering, endpoint snap, and output bounds', () => {
  const points = [
    { x: 0, y: 0 },
    { x: 80, y: 90 },
    { x: 180, y: 170 },
    { x: 255, y: 255 },
  ];

  expect(constrainCurvePoint(points, 1, { x: 220, y: 300 })).toEqual({ x: 179.99, y: 255 });
  expect(constrainCurvePoint(points, 2, { x: 20, y: -10 })).toEqual({ x: 80.01, y: 0 });
  expect(constrainCurvePoint(points, 0, { x: 3, y: 20 })).toEqual({ x: 0, y: 20 });
  expect(constrainCurvePoint(points, 3, { x: 252, y: 230 })).toEqual({ x: 255, y: 230 });
});

test('parametric split constraints retain ten percent region gaps', () => {
  const settings = { ...INITIAL_ADJUSTMENTS.parametricCurve.luma, split1: 25, split2: 50, split3: 75 };
  expect(constrainParametricSplit(settings, 'split1', 48)).toBe(40);
  expect(constrainParametricSplit(settings, 'split2', 5)).toBe(35);
  expect(constrainParametricSplit(settings, 'split2', 90)).toBe(65);
  expect(constrainParametricSplit(settings, 'split3', 55)).toBe(60);
});

test('point curve exposes professional controls and keyboard point editing', async () => {
  const changes: Adjustments[] = [];
  const { container } = await renderCurveEditor(changes);

  expect(container.querySelector('[data-testid="curves-editor"]')).not.toBeNull();
  expect(getButton(container, 'Point Curve').getAttribute('aria-pressed')).toBe('true');
  expect(getButton(container, 'Parametric Curve').getAttribute('aria-pressed')).toBe('false');
  expect(getButton(container, 'Luma Channel').getAttribute('aria-pressed')).toBe('true');
  expect(container.textContent).toContain('Curve data not available.');

  const point = container.querySelector<SVGCircleElement>('circle[role="button"]');
  if (!point) throw new Error('Expected an accessible curve point.');
  await act(async () => {
    point.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
    await flushPromises();
  });
  await act(async () => {
    point.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, key: 'ArrowUp' }));
    await flushPromises();
  });

  expect(changes.at(-1)?.curves.luma[0]).toEqual({ x: 0, y: 1 });
  expect(container.querySelector<HTMLInputElement>('input[aria-label="X Axis"]')?.value).toBe('0');
  expect(container.querySelector<HTMLInputElement>('input[aria-label="Y Axis"]')?.value).toBe('1');
});

test('numeric point editing commits valid changes and Escape does not add history', async () => {
  const changes: Adjustments[] = [];
  const initialAdjustments = structuredClone(INITIAL_ADJUSTMENTS);
  initialAdjustments.curves.luma[0] = { x: 0, y: 0.4 };
  const { container } = await renderCurveEditor(changes, initialAdjustments);
  const point = container.querySelector<SVGCircleElement>('circle[role="button"]');
  if (!point) throw new Error('Expected an accessible curve point.');

  await act(flushPromises);
  await act(async () => {
    point.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
    await flushPromises();
  });

  const yInput = container.querySelector<HTMLInputElement>('input[aria-label="Y Axis"]');
  if (!yInput) throw new Error('Expected the selected point Y input.');
  yInput.value = '42';
  await act(async () => {
    yInput.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
    await flushPromises();
  });
  expect(changes).toHaveLength(0);

  yInput.value = '42';
  await act(async () => {
    yInput.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true }));
    await flushPromises();
  });
  expect(changes.at(-1)?.curves.luma[0]).toEqual({ x: 0, y: 42 });
});

test('mode, channel, and point deletion operate on their existing curve models', async () => {
  const changes: Adjustments[] = [];
  const initialAdjustments = structuredClone(INITIAL_ADJUSTMENTS);
  initialAdjustments.curves.luma = [
    { x: 0, y: 0 },
    { x: 128, y: 160 },
    { x: 255, y: 255 },
  ];
  const { container } = await renderCurveEditor(changes, initialAdjustments);

  await click(getButton(container, 'Red Channel'));
  expect(getButton(container, 'Red Channel').getAttribute('aria-pressed')).toBe('true');
  expect(changes).toHaveLength(0);

  await click(getButton(container, 'Luma Channel'));
  const interiorPoint = container.querySelectorAll<SVGCircleElement>('circle[role="button"]')[1];
  if (!interiorPoint) throw new Error('Expected an interior curve point.');
  await act(async () => {
    interiorPoint.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, key: 'Delete' }));
    await flushPromises();
  });
  expect(changes.at(-1)?.curves.luma).toEqual([
    { x: 0, y: 0 },
    { x: 255, y: 255 },
  ]);

  await click(getButton(container, 'Parametric Curve'));
  expect(changes.at(-1)?.curveMode).toBe('parametric');
  expect(changes.at(-1)?.pointCurves?.luma).toEqual([
    { x: 0, y: 0 },
    { x: 255, y: 255 },
  ]);
  expect(container.querySelectorAll('button[aria-label$="%"]')).toHaveLength(3);
});

test('point interaction emits one start and one finish when released outside the graph', async () => {
  const dragStates: boolean[] = [];
  const { container } = await renderCurveEditor([], INITIAL_ADJUSTMENTS, dragStates);
  const point = container.querySelector<SVGCircleElement>('circle[role="button"]');
  if (!point) throw new Error('Expected an accessible curve point.');

  await act(async () => {
    point.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0 }));
    await flushPromises();
  });
  expect(dragStates).toEqual([true]);

  await act(async () => {
    window.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));
    window.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));
    await flushPromises();
  });
  expect(dragStates).toEqual([true, false]);
});

test('channel and mode commands finish an active draft synchronously without timers', async () => {
  const dragStates: boolean[] = [];
  const changes: Adjustments[] = [];
  const { container } = await renderCurveEditor(changes, INITIAL_ADJUSTMENTS, dragStates);
  const point = container.querySelector<SVGCircleElement>('circle[role="button"]');
  if (!point) throw new Error('Expected an accessible curve point.');

  await act(async () => {
    point.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0 }));
    getButton(container, 'Red Channel').click();
  });
  expect(dragStates).toEqual([true, false]);
  expect(getButton(container, 'Red Channel').getAttribute('aria-pressed')).toBe('true');

  const redPoint = container.querySelector<SVGCircleElement>('circle[role="button"]');
  if (!redPoint) throw new Error('Expected a red curve point.');
  await act(async () => {
    redPoint.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0 }));
    getButton(container, 'Parametric Curve').click();
  });
  expect(dragStates.slice(0, 4)).toEqual([true, false, true, false]);
  expect(changes.at(-1)?.curveMode).toBe('parametric');
});

test('Escape rolls a point interaction back and finishes exactly once', async () => {
  const dragStates: boolean[] = [];
  const changes: Adjustments[] = [];
  const initial = structuredClone(INITIAL_ADJUSTMENTS);
  initial.curves.luma = [
    { x: 0, y: 0 },
    { x: 100, y: 140 },
    { x: 255, y: 255 },
  ];
  const { container } = await renderCurveEditor(changes, initial, dragStates);
  const point = container.querySelectorAll<SVGCircleElement>('circle[role="button"]')[1];
  if (!point) throw new Error('Expected an interior point.');

  await act(async () => {
    point.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0 }));
    await flushPromises();
  });
  await act(async () => {
    window.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
    await flushPromises();
  });
  expect(changes.at(-1)?.curves.luma).toEqual(initial.curves.luma);
  expect(dragStates).toEqual([true, false]);
});

test('parent curve updates stay hidden by a matching draft and become canonical on finish', async () => {
  const { container } = await renderCurveEditor([]);
  const point = container.querySelector<SVGCircleElement>('circle[role="button"]');
  const parentUpdate = container.querySelector<HTMLButtonElement>('[data-testid="parent-curve-update"]');
  if (!point || !parentUpdate) throw new Error('Expected curve point and parent update control.');

  await act(async () => {
    point.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0 }));
    await flushPromises();
  });
  await click(parentUpdate);
  expect(container.querySelector('circle[role="button"]')?.getAttribute('aria-label')).toContain('Y Axis 0');

  await act(async () => {
    window.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));
    await flushPromises();
  });
  expect(container.querySelector('circle[role="button"]')?.getAttribute('aria-label')).toContain('Y Axis 37');
});

test('parametric split pointer cancellation uses the same exact finish path', async () => {
  const dragStates: boolean[] = [];
  const { container } = await renderCurveEditor([], INITIAL_ADJUSTMENTS, dragStates);
  await click(getButton(container, 'Parametric Curve'));
  dragStates.length = 0;
  const split = container.querySelector<HTMLButtonElement>('button[aria-label$="%"]');
  if (!split) throw new Error('Expected a parametric split control.');

  await act(async () => {
    split.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0 }));
    await flushPromises();
  });
  await act(async () => {
    window.dispatchEvent(new window.Event('pointercancel'));
    await flushPromises();
  });
  expect(dragStates).toEqual([true, false]);
});

function CurveHarness({
  changes,
  dragStates,
  initialAdjustments,
}: {
  changes: Adjustments[];
  dragStates: boolean[];
  initialAdjustments: Adjustments;
}) {
  const [adjustments, setAdjustments] = useState<Adjustments>(() => structuredClone(initialAdjustments));
  return createElement(
    'div',
    null,
    createElement(CurveGraph, {
      adjustments,
      histogram: null,
      setAdjustments: (updater) => {
        setAdjustments((previous) => {
          const next = updater(previous);
          changes.push(next);
          return next;
        });
      },
      theme: Theme.Dark,
      onDragStateChange: (dragging) => dragStates.push(dragging),
    }),
    createElement(
      'button',
      {
        'data-testid': 'parent-curve-update',
        onClick: () =>
          setAdjustments((previous) => ({
            ...previous,
            curves: {
              ...previous.curves,
              luma: [
                { x: 0, y: 37 },
                { x: 255, y: 255 },
              ],
            },
          })),
        type: 'button',
      },
      'Parent update',
    ),
  );
}

async function renderCurveEditor(
  changes: Adjustments[],
  initialAdjustments = INITIAL_ADJUSTMENTS,
  dragStates: boolean[] = [],
) {
  installDom();
  const i18n = i18next.createInstance();
  await i18n.use(initReactI18next).init({ lng: 'en', resources: { en: { translation: en } } });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(
          ContextMenuProvider,
          null,
          createElement(CurveHarness, { changes, dragStates, initialAdjustments }),
        ),
      ),
    );
    await flushPromises();
  });

  renderedRoot = { container, root };
  return { container, root };
}

async function click(button: HTMLButtonElement) {
  await act(async () => {
    button.dispatchEvent(new window.MouseEvent('click', { bubbles: true, button: 0 }));
    await flushPromises();
  });
}

function getButton(container: Element, title: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === title || candidate.title === title,
  );
  if (!button) throw new Error(`Expected ${title} button.`);
  return button;
}

function installDom() {
  if (globalThis.document) return;
  const window = new Window({ url: 'http://localhost/' });
  Object.assign(globalThis, {
    document: window.document,
    Element: window.Element,
    Event: window.Event,
    HTMLElement: window.HTMLElement,
    HTMLInputElement: window.HTMLInputElement,
    KeyboardEvent: window.KeyboardEvent,
    MouseEvent: window.MouseEvent,
    Node: window.Node,
    SVGCircleElement: window.SVGCircleElement,
    SVGElement: window.SVGElement,
    window,
  });
}

async function flushPromises() {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}
