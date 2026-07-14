import { afterEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import i18next from 'i18next';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import RightPanelSwitcher from '../../../src/components/panel/right/RightPanelSwitcher.tsx';
import { getRecentRightPanelEntries } from '../../../src/components/panel/right/rightPanelRegistry.ts';
import { Panel } from '../../../src/components/ui/AppProperties.tsx';
import en from '../../../src/i18n/locales/en.json';
import { useUIStore } from '../../../src/store/useUIStore.ts';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type RenderedSwitcher = {
  container: HTMLDivElement;
  selectedPanels: Panel[];
  root: Root;
};

let renderedSwitcher: RenderedSwitcher | null = null;

afterEach(() => {
  if (renderedSwitcher !== null) {
    act(() => {
      renderedSwitcher?.root.unmount();
    });
    renderedSwitcher.container.remove();
    renderedSwitcher = null;
  }

  useUIStore.setState({
    activeRightPanel: Panel.Color,
    recentRightPanels: [Panel.Color],
    renderedRightPanel: Panel.Color,
    slideDirection: 1,
  });
});

describe('right panel switcher', () => {
  test('marks the active vertical workspace and dispatches existing tool selections', async () => {
    const { container, selectedPanels } = await renderSwitcher({
      activePanel: Panel.Adjustments,
      layout: 'vertical',
      recentPanels: [Panel.Adjustments, Panel.Color],
    });

    const activeButton = required<HTMLButtonElement>(
      container,
      '[data-testid="right-panel-switcher-button-adjustments"]',
    );
    expect(activeButton.getAttribute('aria-pressed')).toBe('true');
    expect(activeButton.dataset.panelState).toBe('active');
    expect(activeButton.dataset.panelPriority).toBe('primary');
    expect(required(container, '[data-testid="right-panel-switcher-group-1"]')).not.toBeNull();

    await click(required<HTMLButtonElement>(container, '[data-testid="right-panel-switcher-button-crop"]'));
    expect(selectedPanels).toEqual([Panel.Crop]);
  });

  test('keeps horizontal search keyboard-complete and returns focus to the selected panel', async () => {
    const { container, selectedPanels } = await renderSwitcher({
      activePanel: Panel.Color,
      layout: 'horizontal',
      recentPanels: [Panel.Color, Panel.Adjustments, Panel.Masks],
    });

    await click(required<HTMLButtonElement>(container, '[data-testid="right-panel-search-disclosure-horizontal"]'));
    const input = required<HTMLInputElement>(container, '[data-testid="right-panel-search-input-horizontal"]');
    expect(document.activeElement).toBe(input);

    await keyDown(input, 'ArrowDown');
    const filmResult = required<HTMLButtonElement>(container, '[data-testid="right-panel-search-result-row-film"]');
    expect(document.activeElement).toBe(filmResult);

    await keyDown(filmResult, 'End');
    const exportResult = required<HTMLButtonElement>(container, '[data-testid="right-panel-search-result-row-export"]');
    expect(document.activeElement).toBe(exportResult);

    await keyDown(exportResult, 'Home');
    expect(document.activeElement).toBe(filmResult);

    await keyDown(filmResult, 'ArrowUp');
    expect(document.activeElement).toBe(input);

    await setInputValue(input, 'output');
    expect(container.querySelector('[data-testid="right-panel-search-result-row-export"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="right-panel-search-result-row-color"]')).toBeNull();

    await keyDown(input, 'Enter');
    expect(selectedPanels).toEqual([Panel.Export]);
    expect(container.querySelector('[data-testid="right-panel-search-popover-horizontal"]')).toBeNull();
    expect(document.activeElement?.getAttribute('data-testid')).toBe('right-panel-switcher-button-export');
  });

  test('keeps recent panels actionable and restores disclosure focus on Escape', async () => {
    const { container, selectedPanels } = await renderSwitcher({
      activePanel: Panel.Color,
      layout: 'vertical',
      recentPanels: [Panel.Color, Panel.Masks, Panel.Export, Panel.Crop],
    });

    const disclosure = required<HTMLButtonElement>(container, '[data-testid="right-panel-search-disclosure-vertical"]');
    await click(disclosure);

    expect(container.querySelector('[data-testid="right-panel-recent-row-color"]')).toBeNull();
    await click(required<HTMLButtonElement>(container, '[data-testid="right-panel-recent-row-masks"]'));
    expect(selectedPanels).toEqual([Panel.Masks]);
    expect(document.activeElement?.getAttribute('data-testid')).toBe('right-panel-switcher-button-masks');

    await click(disclosure);
    const input = required<HTMLInputElement>(container, '[data-testid="right-panel-search-input-vertical"]');
    await keyDown(input, 'Escape');

    expect(container.querySelector('[data-testid="right-panel-search-popover-vertical"]')).toBeNull();
    expect(document.activeElement).toBe(disclosure);
  });

  test('filters stale and duplicate recent panel ids before rendering a recent list', () => {
    expect(
      getRecentRightPanelEntries(['retired-panel', Panel.Masks, Panel.Masks, Panel.Export], Panel.Color).map(
        ({ id }) => id,
      ),
    ).toEqual([Panel.Masks, Panel.Export]);
  });
});

async function renderSwitcher({
  activePanel,
  layout,
  recentPanels,
}: {
  activePanel: Panel;
  layout: 'horizontal' | 'vertical';
  recentPanels: Panel[];
}): Promise<RenderedSwitcher> {
  installDom();
  useUIStore.setState({ recentRightPanels: recentPanels });

  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const selectedPanels: Panel[] = [];
  const i18n = await createTestI18n();

  await act(async () => {
    root.render(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(RightPanelSwitcher, {
          activePanel,
          isInstantTransition: true,
          layout,
          onPanelSelect: (panel) => {
            selectedPanels.push(panel);
          },
        }),
      ),
    );
    await flush();
    await flush();
  });

  renderedSwitcher = { container, root, selectedPanels };
  return renderedSwitcher;
}

function required<T extends Element>(container: Element, selector: string): T {
  const element = container.querySelector<T>(selector);
  if (element === null) throw new Error(`Expected ${selector} to render.`);
  return element;
}

async function click(element: HTMLButtonElement) {
  await act(async () => {
    element.click();
    await flush();
    await flush();
  });
}

async function keyDown(element: HTMLElement, key: string) {
  await act(async () => {
    element.focus();
    element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key }));
    await flush();
    await flush();
  });
}

async function setInputValue(element: HTMLInputElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  if (valueSetter === undefined) throw new Error('Search input did not expose a value setter.');

  await act(async () => {
    valueSetter.call(element, value);
    element.dispatchEvent(createInputEvent());
    element.dispatchEvent(new window.Event('change', { bubbles: true }));
    const reactPropsKey = Object.keys(element).find((key) => key.startsWith('__reactProps$'));
    if (reactPropsKey === undefined) throw new Error('Search input did not expose React input props.');

    const reactProps = Reflect.get(element, reactPropsKey);
    if (!hasInputChangeHandler(reactProps)) throw new Error('Search input did not expose an onChange handler.');
    reactProps.onChange({ currentTarget: element, target: element });
    await flush();
  });
}

function hasInputChangeHandler(value: unknown): value is {
  onChange: (event: { currentTarget: HTMLInputElement; target: HTMLInputElement }) => void;
} {
  return typeof value === 'object' && value !== null && 'onChange' in value && typeof value.onChange === 'function';
}

function createInputEvent(): Event {
  if ('InputEvent' in window) {
    return new window.InputEvent('input', { bubbles: true });
  }
  return new window.Event('input', { bubbles: true });
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function installDom() {
  const testWindow = new Window({ url: 'http://localhost/right-panel-switcher-test' });
  Object.assign(globalThis, {
    document: testWindow.document,
    HTMLElement: testWindow.HTMLElement,
    HTMLButtonElement: testWindow.HTMLButtonElement,
    HTMLInputElement: testWindow.HTMLInputElement,
    KeyboardEvent: testWindow.KeyboardEvent,
    navigator: testWindow.navigator,
    window: testWindow,
  });
  Object.defineProperty(testWindow, 'requestAnimationFrame', {
    configurable: true,
    value: (callback: FrameRequestCallback) => testWindow.setTimeout(() => callback(Date.now()), 0),
  });
  Object.defineProperty(testWindow, 'cancelAnimationFrame', {
    configurable: true,
    value: (frame: number) => testWindow.clearTimeout(frame),
  });
}

async function createTestI18n() {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    defaultNS: 'translation',
    interpolation: { escapeValue: false },
    lng: 'en',
    react: { useSuspense: false },
    resources: { en: { translation: en } },
  });
  return instance;
}
