import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { createElement } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import DevelopToolStrip, {
  resolveDevelopToolAvailability,
} from '../../../src/components/panel/right/inspector/DevelopToolStrip';
import { getRightPanelEntry } from '../../../src/components/panel/right/rightPanelRegistry';
import { Panel } from '../../../src/components/ui/AppProperties';
import en from '../../../src/i18n/locales/en.json';
import { useEditorStore } from '../../../src/store/useEditorStore';
import { useUIStore } from '../../../src/store/useUIStore';

const testI18n = i18next.createInstance();
await testI18n.use(initReactI18next).init({
  defaultNS: 'translation',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  lng: 'en',
  react: { useSuspense: false },
  resources: { en: { translation: en } },
});

describe('Develop tool strip', () => {
  beforeEach(() => {
    useEditorStore.getState().setEditor({ selectedImage: null });
    useUIStore.setState({ activeDevelopTool: null, activeRightPanel: Panel.Color });
  });

  afterEach(() => cleanup());

  test('exposes unavailable and loading states without claiming a pressed tool', () => {
    expect(resolveDevelopToolAvailability(null)).toEqual({ disabled: true, state: 'unavailable' });
    expect(resolveDevelopToolAvailability({ isReady: false })).toEqual({ disabled: true, state: 'loading' });

    const { container, rerender } = renderStrip();
    const buttons = [...container.querySelectorAll<HTMLButtonElement>('[data-develop-tool-id]')];
    expect(buttons).toHaveLength(4);
    expect(buttons.every((button) => button.disabled)).toBe(true);
    expect(container.querySelector('[data-develop-tool-state="unavailable"]')).not.toBeNull();

    act(() => useEditorStore.getState().setEditor({ selectedImage: { ...selectedImage(), isReady: false } }));
    rerender(renderElement());
    expect(container.querySelector('[data-develop-tool-state="loading"]')).not.toBeNull();
    expect(buttons.every((button) => button.disabled)).toBe(true);
    expect(buttons.some((button) => button.getAttribute('aria-pressed') === 'true')).toBe(false);
  });

  test('switches one authoritative tool with pointer and restores Escape state', async () => {
    const user = userEvent.setup();
    useEditorStore.getState().setEditor({ selectedImage: selectedImage() });
    const { container } = renderStrip();

    const crop = required<HTMLButtonElement>(container, '[data-testid="develop-tool-strip-crop"]');
    const remove = required<HTMLButtonElement>(container, '[data-testid="develop-tool-strip-remove"]');
    const masking = required<HTMLButtonElement>(container, '[data-testid="develop-tool-strip-masking"]');

    await user.click(crop);
    expect(useUIStore.getState()).toMatchObject({ activeDevelopTool: 'crop', activeRightPanel: Panel.Crop });
    expect(crop.getAttribute('aria-pressed')).toBe('true');
    expect(remove.getAttribute('aria-pressed')).toBe('false');

    await user.click(remove);
    expect(useUIStore.getState()).toMatchObject({ activeDevelopTool: 'remove', activeRightPanel: Panel.Masks });
    expect(remove.getAttribute('aria-pressed')).toBe('true');
    expect(crop.getAttribute('aria-pressed')).toBe('false');

    masking.focus();
    fireEvent.keyDown(masking, { key: 'Escape' });
    expect(useUIStore.getState().activeDevelopTool).toBeNull();
    expect(document.activeElement).toBe(masking);
  });

  test('keeps RapidRaw-only workspaces in the secondary switcher group', () => {
    expect(getRightPanelEntry(Panel.Agent).priority).toBe('secondary');
    expect(getRightPanelEntry(Panel.Ai).priority).toBe('secondary');
    expect(getRightPanelEntry(Panel.Export).priority).toBe('secondary');
    expect(getRightPanelEntry(Panel.Tether).priority).toBe('secondary');
  });
});

function renderElement() {
  return createElement(
    I18nextProvider,
    { i18n: testI18n },
    createElement(DevelopToolStrip, { testId: 'develop-tool-strip' }),
  );
}

function renderStrip() {
  return render(renderElement());
}

function required<T extends Element>(container: Element, selector: string): T {
  const element = container.querySelector<T>(selector);
  if (element === null) throw new Error(`Expected ${selector} to render.`);
  return element;
}

function selectedImage() {
  return {
    exif: null,
    height: 1200,
    isRaw: true,
    isReady: true,
    metadata: null,
    originalUrl: null,
    path: '/private/alaska/_DSC8786.ARW',
    rawDevelopmentReport: null,
    thumbnailUrl: 'data:image/jpeg;base64,AAAA',
    width: 1800,
  };
}
