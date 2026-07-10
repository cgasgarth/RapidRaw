import { afterEach, describe, expect, test } from 'bun:test';

import { Panel } from '../../../src/components/ui/AppProperties';
import { editorWorkspacePreferencesSchema } from '../../../src/schemas/editorWorkspacePreferencesSchemas';
import { useUIStore } from '../../../src/store/useUIStore';
import {
  createDefaultEditorWorkspacePreferences,
  EDITOR_WORKSPACE_PREFERENCES_STORAGE_KEY,
  getEffectiveEditorWorkspaceLayout,
  LEGACY_DEVELOP_PANEL_PINNED_CONTROL_IDS_STORAGE_KEY,
  LEGACY_LAST_EDITING_RIGHT_PANEL_STORAGE_KEY,
  migrateLegacyEditorWorkspacePreferences,
  readEditorWorkspacePreferences,
  saveEditorWorkspacePreferences,
} from '../../../src/utils/editorWorkspacePreferences';

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

const installStorage = (storage: Storage) => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
};

afterEach(() => {
  useUIStore.setState({
    activeRightPanel: Panel.Color,
    bottomPanelHeight: 144,
    compactEditorPanelHeightOverride: null,
    editorWorkspacePreferences: createDefaultEditorWorkspacePreferences(),
    editorWorkspaceViewport: { height: 0, isCompactPortrait: false, width: 0 },
    isCommandPaletteOpen: false,
    leftPanelWidth: 256,
    recentRightPanels: [Panel.Color],
    renderedRightPanel: Panel.Color,
    rightPanelWidth: 360,
    uiVisibility: { filmstrip: true, folderTree: true },
  });

  if (originalLocalStorageDescriptor) {
    Object.defineProperty(globalThis, 'localStorage', originalLocalStorageDescriptor);
  } else {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  }
});

describe('editor workspace preferences', () => {
  test('defines a strict, versioned UI-only preference contract', () => {
    const preferences = createDefaultEditorWorkspacePreferences();
    expect(editorWorkspacePreferencesSchema.safeParse(preferences).success).toBe(true);
    expect(editorWorkspacePreferencesSchema.safeParse({ ...preferences, version: 2 }).success).toBe(false);
    expect(
      editorWorkspacePreferencesSchema.safeParse({
        ...preferences,
        leftSidebar: { ...preferences.leftSidebar, width: 900 },
      }).success,
    ).toBe(false);
    expect(
      editorWorkspacePreferencesSchema.safeParse({ ...preferences, selectedImagePath: '/private/raw.nef' }).success,
    ).toBe(false);
  });

  test('migrates valid legacy editor layout settings once and ignores invalid dimensions', () => {
    const storage = new MemoryStorage();
    installStorage(storage);
    storage.setItem(LEGACY_LAST_EDITING_RIGHT_PANEL_STORAGE_KEY, Panel.Masks);
    storage.setItem(
      LEGACY_DEVELOP_PANEL_PINNED_CONTROL_IDS_STORAGE_KEY,
      JSON.stringify(['exposure', 'exposure', 'tone']),
    );

    const migrated = migrateLegacyEditorWorkspacePreferences({
      bottomPanelHeight: 180,
      compactEditorPanelHeightOverride: 360,
      leftPanelWidth: 288,
      rightPanelWidth: 420,
      uiVisibility: { filmstrip: false, folderTree: false },
    });

    expect(migrated).toMatchObject({
      compact: { toolsHeight: 360 },
      filmstrip: { height: 180, visible: false },
      leftSidebar: { visible: false, width: 288 },
      rightInspector: { activePanel: Panel.Masks, pinnedControlIds: ['exposure', 'tone'], width: 420 },
    });
    expect(migrateLegacyEditorWorkspacePreferences({ rightPanelWidth: 900 }).rightInspector.width).toBe(360);
  });

  test('uses a valid current preference over legacy values and safely falls back from corrupt or future data', () => {
    const storage = new MemoryStorage();
    installStorage(storage);
    const current = createDefaultEditorWorkspacePreferences();
    current.rightInspector.activePanel = Panel.Agent;
    storage.setItem(EDITOR_WORKSPACE_PREFERENCES_STORAGE_KEY, JSON.stringify(current));
    storage.setItem(LEGACY_LAST_EDITING_RIGHT_PANEL_STORAGE_KEY, Panel.Masks);

    expect(readEditorWorkspacePreferences({ uiVisibility: { filmstrip: false } })).toEqual(current);

    storage.setItem(EDITOR_WORKSPACE_PREFERENCES_STORAGE_KEY, '{not-json');
    expect(readEditorWorkspacePreferences().rightInspector.activePanel).toBe(Panel.Masks);

    storage.setItem(EDITOR_WORKSPACE_PREFERENCES_STORAGE_KEY, JSON.stringify({ ...current, version: 2 }));
    expect(readEditorWorkspacePreferences().rightInspector.activePanel).toBe(Panel.Masks);
  });

  test('clamps only the effective viewport layout and retains desktop preferences across compact transitions', () => {
    const preferences = createDefaultEditorWorkspacePreferences();
    preferences.leftSidebar.width = 500;
    preferences.rightInspector.width = 600;
    preferences.filmstrip.height = 400;
    preferences.compact.toolsHeight = 700;

    const compact = getEffectiveEditorWorkspaceLayout(preferences, {
      height: 560,
      isCompactPortrait: true,
      width: 760,
    });
    const desktop = getEffectiveEditorWorkspaceLayout(preferences, {
      height: 900,
      isCompactPortrait: false,
      width: 1600,
    });

    expect(compact.leftPanelWidth + compact.rightPanelWidth).toBeLessThanOrEqual(280);
    expect(compact.bottomPanelHeight).toBe(320);
    expect(compact.compactEditorPanelHeightOverride).toBe(260);
    expect(desktop).toMatchObject({ bottomPanelHeight: 400, leftPanelWidth: 500, rightPanelWidth: 600 });
    expect(preferences).toMatchObject({
      compact: { toolsHeight: 700 },
      filmstrip: { height: 400 },
      leftSidebar: { width: 500 },
      rightInspector: { width: 600 },
    });
  });

  test('persists narrow preference actions but not transient UI state', () => {
    const storage = new MemoryStorage();
    installStorage(storage);
    useUIStore.getState().setEditorWorkspaceViewport({ height: 900, isCompactPortrait: false, width: 1440 });
    useUIStore.getState().setEditorRegionSize('leftSidebar', 312);
    useUIStore.getState().setEditorRegionVisibility('filmstrip', false);
    useUIStore.getState().setEditorSectionExpanded(Panel.Adjustments, 'details', true);
    useUIStore.getState().setDefaultEditorZoomMode('oneToOne');
    useUIStore.getState().setEditorLightsOutLevel('dim');
    useUIStore.getState().setUI({ isCommandPaletteOpen: true });

    const persisted = JSON.parse(storage.getItem(EDITOR_WORKSPACE_PREFERENCES_STORAGE_KEY) ?? '{}');
    expect(persisted).toMatchObject({
      filmstrip: { visible: false },
      leftSidebar: { width: 312 },
      viewer: { defaultZoomMode: 'oneToOne', lightsOutLevel: 'dim' },
    });
    expect(persisted.rightInspector.expandedSectionsByPanel.adjustments).toContain('details');
    expect(persisted.isCommandPaletteOpen).toBeUndefined();
  });

  test('tolerates unavailable storage without blocking preference updates', () => {
    installStorage({
      clear: () => undefined,
      getItem: () => {
        throw new Error('storage unavailable');
      },
      key: () => null,
      length: 0,
      removeItem: () => undefined,
      setItem: () => {
        throw new Error('quota exceeded');
      },
    });

    expect(() => saveEditorWorkspacePreferences(createDefaultEditorWorkspacePreferences())).not.toThrow();
    expect(() => useUIStore.getState().setDefaultEditorZoomMode('fill')).not.toThrow();
  });
});
