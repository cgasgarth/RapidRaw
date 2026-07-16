import { afterEach, describe, expect, test } from 'bun:test';
import { act, render, waitFor } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import i18next from 'i18next';
import { createElement } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import RightPanelSwitcher from '../../../src/components/panel/right/RightPanelSwitcher.tsx';
import { getRecentRightPanelEntries } from '../../../src/components/panel/right/rightPanelRegistry.ts';
import { Panel } from '../../../src/components/ui/AppProperties.tsx';
import en from '../../../src/i18n/locales/en.json';
import { useUIStore } from '../../../src/store/useUIStore.ts';

type RenderedSwitcher = {
  container: HTMLElement;
  selectedPanels: Panel[];
  user: UserEvent;
};

afterEach(() => {
  act(() => {
    useUIStore.setState({
      activeRightPanel: Panel.Color,
      recentRightPanels: [Panel.Color],
      renderedRightPanel: Panel.Color,
      slideDirection: 1,
    });
  });
});

describe('right panel switcher', () => {
  test('marks the active vertical workspace and dispatches existing tool selections', async () => {
    const { container, selectedPanels, user } = await renderSwitcher({
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

    await user.click(required<HTMLButtonElement>(container, '[data-testid="right-panel-switcher-button-crop"]'));
    expect(selectedPanels).toEqual([Panel.Crop]);
  });

  test('keeps horizontal search keyboard-complete and returns focus to the selected panel', async () => {
    const { container, selectedPanels, user } = await renderSwitcher({
      activePanel: Panel.Color,
      layout: 'horizontal',
      recentPanels: [Panel.Color, Panel.Adjustments, Panel.Masks],
    });

    await user.click(
      required<HTMLButtonElement>(container, '[data-testid="right-panel-search-disclosure-horizontal"]'),
    );
    const input = required<HTMLInputElement>(container, '[data-testid="right-panel-search-input-horizontal"]');
    await waitFor(() => expect(document.activeElement).toBe(input));

    input.focus();
    await user.keyboard('{ArrowDown}');
    const filmResult = required<HTMLButtonElement>(container, '[data-testid="right-panel-search-result-row-film"]');
    expect(document.activeElement).toBe(filmResult);

    filmResult.focus();
    await user.keyboard('{End}');
    const exportResult = required<HTMLButtonElement>(container, '[data-testid="right-panel-search-result-row-export"]');
    expect(document.activeElement).toBe(exportResult);

    exportResult.focus();
    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(filmResult);

    filmResult.focus();
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(input);

    await user.type(input, 'output');
    expect(container.querySelector('[data-testid="right-panel-search-result-row-export"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="right-panel-search-result-row-color"]')).toBeNull();

    input.focus();
    await user.keyboard('{Enter}');
    expect(selectedPanels).toEqual([Panel.Export]);
    expect(container.querySelector('[data-testid="right-panel-search-popover-horizontal"]')).toBeNull();
    expect(document.activeElement?.getAttribute('data-testid')).toBe('right-panel-switcher-button-export');
  });

  test('keeps recent panels actionable and restores disclosure focus on Escape', async () => {
    const { container, selectedPanels, user } = await renderSwitcher({
      activePanel: Panel.Color,
      layout: 'vertical',
      recentPanels: [Panel.Color, Panel.Masks, Panel.Export, Panel.Crop],
    });

    const disclosure = required<HTMLButtonElement>(container, '[data-testid="right-panel-search-disclosure-vertical"]');
    await user.click(disclosure);

    expect(container.querySelector('[data-testid="right-panel-recent-row-color"]')).toBeNull();
    await user.click(required<HTMLButtonElement>(container, '[data-testid="right-panel-recent-row-masks"]'));
    expect(selectedPanels).toEqual([Panel.Masks]);
    expect(document.activeElement?.getAttribute('data-testid')).toBe('right-panel-switcher-button-masks');

    await user.click(disclosure);
    const input = required<HTMLInputElement>(container, '[data-testid="right-panel-search-input-vertical"]');
    input.focus();
    await user.keyboard('{Escape}');

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
  useUIStore.setState({ recentRightPanels: recentPanels });

  const selectedPanels: Panel[] = [];
  const i18n = await createTestI18n();
  const user = userEvent.setup();
  const { container } = render(
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

  return { container, selectedPanels, user };
}

function required<T extends Element>(container: Element, selector: string): T {
  const element = container.querySelector<T>(selector);
  if (element === null) throw new Error(`Expected ${selector} to render.`);
  return element;
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
