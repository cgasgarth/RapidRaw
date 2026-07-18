import { afterEach, describe, expect, test } from 'bun:test';
import { act, fireEvent, render } from '@testing-library/react';
import i18next from 'i18next';
import { createElement } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import DevelopPanelCustomization from '../../../src/components/panel/right/color/DevelopPanelCustomization';
import { Panel } from '../../../src/components/ui/AppProperties';
import { useUIStore } from '../../../src/store/useUIStore';
import {
  DEFAULT_DEVELOP_PANEL_ORDER,
  normalizeDevelopPanelCustomization,
  normalizeDevelopPanelHidden,
  normalizeDevelopPanelOrder,
} from '../../../src/utils/developPanelCustomization';
import {
  createDefaultEditorWorkspacePreferences,
  EDITOR_WORKSPACE_PREFERENCES_STORAGE_KEY,
  readEditorWorkspacePreferences,
} from '../../../src/utils/editorWorkspacePreferences';

afterEach(() => {
  useUIStore.setState({
    activeRightPanel: Panel.Color,
    developPanelOrder: [...DEFAULT_DEVELOP_PANEL_ORDER],
    editorWorkspacePreferences: createDefaultEditorWorkspacePreferences(),
    hiddenDevelopPanelIds: [],
  });
  localStorage.clear();
});

describe('Develop panel customization', () => {
  test('normalizes malformed order and visibility without admitting unknown or duplicate ids', () => {
    expect(normalizeDevelopPanelOrder(['effects', 'effects', 'not-a-panel', 'curves'])).toEqual([
      'effects',
      'curves',
      'colorMixer',
      'colorGrading',
      'details',
      'lensCorrection',
      'transform',
      'calibration',
    ]);
    expect(normalizeDevelopPanelHidden(['effects', 'effects', 'unknown'])).toEqual(['effects']);
    expect(normalizeDevelopPanelCustomization({ order: ['details'], hidden: ['transform'] })).toEqual({
      hidden: ['transform'],
      order: [
        'details',
        'curves',
        'colorMixer',
        'colorGrading',
        'lensCorrection',
        'transform',
        'effects',
        'calibration',
      ],
    });
  });

  test('persists order and visibility as UI preferences without changing edit state', () => {
    const before = useUIStore.getState().editorWorkspacePreferences;
    useUIStore.getState().setDevelopPanelOrder(['effects', 'curves']);
    useUIStore.getState().setDevelopPanelVisibility('curves', false);

    const state = useUIStore.getState();
    expect(state.developPanelOrder).toEqual([
      'effects',
      'curves',
      'colorMixer',
      'colorGrading',
      'details',
      'lensCorrection',
      'transform',
      'calibration',
    ]);
    expect(state.hiddenDevelopPanelIds).toEqual(['curves']);
    expect(state.editorWorkspacePreferences.rightInspector.developPanelOrder).toEqual(state.developPanelOrder);
    expect(state.editorWorkspacePreferences.rightInspector.developPanelHidden).toEqual(['curves']);
    expect(state.editorWorkspacePreferences).not.toBe(before);
  });

  test('recovers invalid customization bytes while retaining valid workspace choices', () => {
    const preferences = createDefaultEditorWorkspacePreferences();
    preferences.rightInspector.activePanel = Panel.Masks;
    localStorage.setItem(
      EDITOR_WORKSPACE_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        ...preferences,
        rightInspector: {
          ...preferences.rightInspector,
          developPanelOrder: ['curves', 'curves', 'not-a-panel'],
          developPanelHidden: ['not-a-panel'],
        },
      }),
    );

    const recovered = readEditorWorkspacePreferences();
    expect(recovered.rightInspector.activePanel).toBe(Panel.Masks);
    expect(recovered.rightInspector.developPanelOrder).toEqual([...DEFAULT_DEVELOP_PANEL_ORDER]);
    expect(recovered.rightInspector.developPanelHidden).toEqual([]);
  });

  test('supports keyboard reorder, pointer reorder, visibility toggles, and restoring defaults', async () => {
    const i18n = i18next.createInstance();
    await i18n.use(initReactI18next).init({
      lng: 'en',
      resources: { en: { translation: {} } },
    });
    const { container } = render(
      createElement(I18nextProvider, { i18n }, createElement(DevelopPanelCustomization, { onClose: () => undefined })),
    );

    const curvesRow = container.querySelector<HTMLElement>('[data-testid="develop-panel-customization-row-curves"]');
    if (curvesRow === null) throw new Error('Expected Curves row.');
    act(() => {
      fireEvent.keyDown(curvesRow, { key: 'ArrowDown' });
    });
    expect(useUIStore.getState().developPanelOrder.slice(0, 2)).toEqual(['colorMixer', 'curves']);

    const detailsRow = container.querySelector<HTMLElement>('[data-testid="develop-panel-customization-row-details"]');
    const effectsRow = container.querySelector<HTMLElement>('[data-testid="develop-panel-customization-row-effects"]');
    if (detailsRow === null || effectsRow === null) throw new Error('Expected draggable rows.');
    act(() => {
      fireEvent.dragStart(detailsRow, { dataTransfer: createDataTransfer('details') });
      fireEvent.drop(effectsRow, { dataTransfer: createDataTransfer('details') });
    });
    expect(useUIStore.getState().developPanelOrder.indexOf('details')).toBeLessThan(
      useUIStore.getState().developPanelOrder.indexOf('effects'),
    );

    act(() => {
      fireEvent.click(getRequiredElement(container, '[data-testid="develop-panel-customization-visibility-curves"]'));
    });
    expect(useUIStore.getState().hiddenDevelopPanelIds).toContain('curves');

    act(() => {
      fireEvent.click(getRequiredElement(container, '[data-testid="develop-panel-customization-reset"]'));
    });
    expect(useUIStore.getState().developPanelOrder).toEqual([...DEFAULT_DEVELOP_PANEL_ORDER]);
    expect(useUIStore.getState().hiddenDevelopPanelIds).toEqual([]);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });
});

function createDataTransfer(value: string): DataTransfer {
  const store = new Map<string, string>();
  const transfer = Object.create(null) as DataTransfer;
  transfer.dropEffect = 'none';
  transfer.effectAllowed = 'all';
  transfer.getData = (format: string) => (format === 'text/plain' ? (store.get(format) ?? '') : '');
  transfer.setData = (format: string, data: string) => {
    store.set(format, data);
  };
  transfer.setDragImage = () => undefined;
  transfer.setData('text/plain', value);
  return transfer;
}

function getRequiredElement(container: Element, selector: string): Element {
  const element = container.querySelector(selector);
  if (element === null) throw new Error(`Expected ${selector}.`);
  return element;
}
