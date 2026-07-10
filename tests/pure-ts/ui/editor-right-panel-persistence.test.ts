import { afterEach, describe, expect, test } from 'bun:test';

import {
  DEFAULT_EDITOR_RIGHT_PANEL,
  EDITING_RIGHT_PANELS,
  getRightPanelEntry,
  isEditingRightPanel,
  RIGHT_PANEL_ORDER,
  searchRightPanels,
} from '../../../src/components/panel/right/rightPanelRegistry';
import { Panel } from '../../../src/components/ui/AppProperties';
import {
  createRecentRightPanels,
  EDITOR_WORKSPACE_PREFERENCES_STORAGE_KEY,
  LAST_EDITING_RIGHT_PANEL_STORAGE_KEY,
  MAX_RECENT_RIGHT_PANELS,
  readLastEditingRightPanel,
  useUIStore,
} from '../../../src/store/useUIStore';

const originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

function installMemoryStorage() {
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  });
  return storage;
}

function resetRightPanelState(panel: Panel | null = DEFAULT_EDITOR_RIGHT_PANEL) {
  useUIStore.setState({
    activeRightPanel: panel,
    renderedRightPanel: panel,
    recentRightPanels: panel === null ? [] : [panel],
    slideDirection: 1,
  });
}

afterEach(() => {
  resetRightPanelState();

  if (originalLocalStorageDescriptor) {
    Object.defineProperty(globalThis, 'localStorage', originalLocalStorageDescriptor);
  } else {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  }
});

describe('editor right panel persistence', () => {
  test('defaults the pro editing rail to Color first', () => {
    expect(DEFAULT_EDITOR_RIGHT_PANEL).toBe(Panel.Color);
    expect(RIGHT_PANEL_ORDER.slice(0, EDITING_RIGHT_PANELS.length)).toEqual([
      Panel.Color,
      Panel.Adjustments,
      Panel.Crop,
      Panel.Masks,
      Panel.Agent,
      Panel.Ai,
    ]);
    expect(useUIStore.getState().activeRightPanel).toBe(Panel.Color);
    expect(useUIStore.getState().renderedRightPanel).toBe(Panel.Color);
  });

  test('restores a persisted editing panel and ignores utility panels', () => {
    const storage = installMemoryStorage();

    storage.setItem(LAST_EDITING_RIGHT_PANEL_STORAGE_KEY, Panel.Masks);
    expect(readLastEditingRightPanel()).toBe(Panel.Masks);

    storage.setItem(LAST_EDITING_RIGHT_PANEL_STORAGE_KEY, Panel.Export);
    expect(readLastEditingRightPanel()).toBe(Panel.Color);

    storage.setItem(LAST_EDITING_RIGHT_PANEL_STORAGE_KEY, 'metadata');
    expect(readLastEditingRightPanel()).toBe(Panel.Color);

    storage.setItem(LAST_EDITING_RIGHT_PANEL_STORAGE_KEY, 'unknown-panel');
    expect(readLastEditingRightPanel()).toBe(Panel.Color);
  });

  test('persists only meaningful editing panel selections', () => {
    const storage = installMemoryStorage();
    resetRightPanelState(Panel.Color);

    useUIStore.getState().setRightPanel(Panel.Masks);
    expect(
      JSON.parse(storage.getItem(EDITOR_WORKSPACE_PREFERENCES_STORAGE_KEY) ?? '{}').rightInspector.activePanel,
    ).toBe(Panel.Masks);
    useUIStore.getState().setRightPanel(Panel.Export);
    expect(useUIStore.getState().activeRightPanel).toBe(Panel.Export);
    expect(
      JSON.parse(storage.getItem(EDITOR_WORKSPACE_PREFERENCES_STORAGE_KEY) ?? '{}').rightInspector.activePanel,
    ).toBe(Panel.Masks);

    useUIStore.getState().setRightPanel(Panel.Tether);
    expect(useUIStore.getState().activeRightPanel).toBe(Panel.Tether);
    expect(
      JSON.parse(storage.getItem(EDITOR_WORKSPACE_PREFERENCES_STORAGE_KEY) ?? '{}').rightInspector.activePanel,
    ).toBe(Panel.Masks);
  });

  test('keeps slide direction deterministic from rail ordering', () => {
    installMemoryStorage();
    resetRightPanelState(Panel.Color);

    useUIStore.getState().setRightPanel(Panel.Adjustments);
    expect(useUIStore.getState().slideDirection).toBe(1);

    useUIStore.getState().setRightPanel(Panel.Masks);
    expect(useUIStore.getState().slideDirection).toBe(1);

    useUIStore.getState().setRightPanel(Panel.Crop);
    expect(useUIStore.getState().slideDirection).toBe(-1);
  });

  test('records typed recent right panels from real panel selections', () => {
    installMemoryStorage();
    resetRightPanelState(Panel.Color);

    useUIStore.getState().setRightPanel(Panel.Masks);
    useUIStore.getState().setRightPanel(Panel.Export);
    useUIStore.getState().setRightPanel(Panel.Agent);

    expect(useUIStore.getState().recentRightPanels).toEqual([Panel.Agent, Panel.Export, Panel.Masks, Panel.Color]);

    useUIStore.getState().setRightPanel(Panel.Export);
    expect(useUIStore.getState().recentRightPanels).toEqual([Panel.Export, Panel.Agent, Panel.Masks, Panel.Color]);
  });

  test('bounds recent panel history while preserving most recent order', () => {
    expect(
      createRecentRightPanels(Panel.Tether, [
        Panel.Export,
        Panel.Agent,
        Panel.Masks,
        Panel.Crop,
        Panel.Adjustments,
        Panel.Color,
      ]),
    ).toEqual([Panel.Tether, Panel.Export, Panel.Agent, Panel.Masks, Panel.Crop]);
    expect(MAX_RECENT_RIGHT_PANELS).toBe(5);
  });

  test('collapses the active panel without replacing the rendered or persisted editing rail', () => {
    const storage = installMemoryStorage();
    resetRightPanelState(Panel.Masks);
    useUIStore.setState((state) => ({
      editorWorkspacePreferences: {
        ...state.editorWorkspacePreferences,
        rightInspector: { ...state.editorWorkspacePreferences.rightInspector, activePanel: Panel.Masks, visible: true },
      },
    }));

    useUIStore.getState().setRightPanel(Panel.Masks);
    expect(useUIStore.getState().activeRightPanel).toBeNull();
    expect(useUIStore.getState().renderedRightPanel).toBe(Panel.Masks);
    expect(
      JSON.parse(storage.getItem(EDITOR_WORKSPACE_PREFERENCES_STORAGE_KEY) ?? '{}').rightInspector.activePanel,
    ).toBe(Panel.Masks);
    expect(JSON.parse(storage.getItem(EDITOR_WORKSPACE_PREFERENCES_STORAGE_KEY) ?? '{}').compact.toolsExpanded).toBe(
      false,
    );

    useUIStore.getState().setRightPanel(Panel.Masks);
    expect(useUIStore.getState().activeRightPanel).toBe(Panel.Masks);
    expect(useUIStore.getState().renderedRightPanel).toBe(Panel.Masks);
    expect(useUIStore.getState().slideDirection).toBe(0);
    expect(JSON.parse(storage.getItem(EDITOR_WORKSPACE_PREFERENCES_STORAGE_KEY) ?? '{}').compact.toolsExpanded).toBe(
      true,
    );
  });

  test('classifies only primary editing rails as restorable editing panels', () => {
    for (const panel of EDITING_RIGHT_PANELS) {
      expect(isEditingRightPanel(panel)).toBe(true);
    }

    for (const panel of [Panel.Export, Panel.Tether, Panel.Presets, Panel.Metadata]) {
      expect(isEditingRightPanel(panel)).toBe(false);
    }
  });

  test('searches right panel registry labels and keywords', () => {
    expect(searchRightPanels('agent').map(({ id }) => id)).toContain(Panel.Agent);
    expect(searchRightPanels('output').map(({ id }) => id)).toEqual([Panel.Export]);
    expect(searchRightPanels('retouch').map(({ id }) => id)).toContain(Panel.Ai);
    expect(searchRightPanels('camera').map(({ id }) => id)).toEqual([Panel.Metadata, Panel.Tether]);
  });

  test('registry exposes compact labels for every panel in rail order', () => {
    expect(RIGHT_PANEL_ORDER.map((panel) => getRightPanelEntry(panel).shortLabel)).toEqual([
      'Color',
      'Adjust',
      'Crop',
      'Masks',
      'Agent',
      'Inpaint',
      'Info',
      'Presets',
      'Tether',
      'Export',
    ]);
  });
});
