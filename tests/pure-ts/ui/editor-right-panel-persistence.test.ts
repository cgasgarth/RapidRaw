import { afterEach, describe, expect, test } from 'bun:test';

import {
  DEFAULT_EDITOR_RIGHT_PANEL,
  EDITING_RIGHT_PANELS,
  isEditingRightPanel,
  RIGHT_PANEL_ORDER,
} from '../../../src/components/panel/right/rightPanelRegistry';
import { Panel } from '../../../src/components/ui/AppProperties';
import {
  LAST_EDITING_RIGHT_PANEL_STORAGE_KEY,
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
    expect(storage.getItem(LAST_EDITING_RIGHT_PANEL_STORAGE_KEY)).toBe(Panel.Masks);

    useUIStore.getState().setRightPanel(Panel.Export);
    expect(useUIStore.getState().activeRightPanel).toBe(Panel.Export);
    expect(storage.getItem(LAST_EDITING_RIGHT_PANEL_STORAGE_KEY)).toBe(Panel.Masks);

    useUIStore.getState().setRightPanel(Panel.Tether);
    expect(useUIStore.getState().activeRightPanel).toBe(Panel.Tether);
    expect(storage.getItem(LAST_EDITING_RIGHT_PANEL_STORAGE_KEY)).toBe(Panel.Masks);
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

  test('collapses the active panel without replacing the rendered or persisted editing rail', () => {
    const storage = installMemoryStorage();
    resetRightPanelState(Panel.Masks);
    storage.setItem(LAST_EDITING_RIGHT_PANEL_STORAGE_KEY, Panel.Masks);

    useUIStore.getState().setRightPanel(Panel.Masks);
    expect(useUIStore.getState().activeRightPanel).toBeNull();
    expect(useUIStore.getState().renderedRightPanel).toBe(Panel.Masks);
    expect(storage.getItem(LAST_EDITING_RIGHT_PANEL_STORAGE_KEY)).toBe(Panel.Masks);

    useUIStore.getState().setRightPanel(Panel.Masks);
    expect(useUIStore.getState().activeRightPanel).toBe(Panel.Masks);
    expect(useUIStore.getState().renderedRightPanel).toBe(Panel.Masks);
    expect(useUIStore.getState().slideDirection).toBe(0);
  });

  test('classifies only primary editing rails as restorable editing panels', () => {
    for (const panel of EDITING_RIGHT_PANELS) {
      expect(isEditingRightPanel(panel)).toBe(true);
    }

    for (const panel of [Panel.Export, Panel.Tether, Panel.Presets, Panel.Metadata]) {
      expect(isEditingRightPanel(panel)).toBe(false);
    }
  });
});
