import { afterEach, describe, expect, test } from 'bun:test';

import { Panel } from '../../../src/components/ui/AppProperties';
import { editorWorkspacePreferencesSchema } from '../../../src/schemas/editorWorkspacePreferencesSchemas';
import { useEditorStore } from '../../../src/store/useEditorStore';
import { useUIStore } from '../../../src/store/useUIStore';
import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { legacyAdjustmentsToEditDocumentV2 } from '../../../src/utils/editDocumentV2';
import {
  createDefaultEditorWorkspacePreferences,
  EDITOR_WORKSPACE_PREFERENCES_STORAGE_KEY,
  getEffectiveEditorWorkspaceLayout,
  readEditorWorkspacePreferences,
  saveEditorWorkspacePreferences,
} from '../../../src/utils/editorWorkspacePreferences';
import {
  createDefaultLibraryWorkspacePreferences,
  LIBRARY_WORKSPACE_PREFERENCES_STORAGE_KEY,
  readLibraryWorkspacePreferences,
} from '../../../src/utils/libraryWorkspacePreferences';

const installStorage = () => {
  localStorage.clear();
  return localStorage;
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

  localStorage.clear();
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
    const { drawerState: _drawerState, ...incompleteCompact } = preferences.compact;
    expect(editorWorkspacePreferencesSchema.safeParse({ ...preferences, compact: incompleteCompact }).success).toBe(
      false,
    );
  });

  test('ignores obsolete keys and incomplete current editor state', () => {
    const storage = installStorage();
    storage.setItem('rapidraw.lastEditingRightPanel.v1', Panel.Masks);
    storage.setItem('rapidraw.developPanelPinnedControlIds.v1', JSON.stringify(['exposure']));
    expect(readEditorWorkspacePreferences()).toEqual(createDefaultEditorWorkspacePreferences());

    const current = createDefaultEditorWorkspacePreferences();
    const { drawerState: _drawerState, ...incompleteCompact } = current.compact;
    storage.setItem(
      EDITOR_WORKSPACE_PREFERENCES_STORAGE_KEY,
      JSON.stringify({ ...current, compact: incompleteCompact }),
    );
    expect(readEditorWorkspacePreferences()).toEqual(createDefaultEditorWorkspacePreferences());
  });

  test('uses valid current preferences and resets corrupt or future data', () => {
    const storage = installStorage();
    const current = createDefaultEditorWorkspacePreferences();
    current.rightInspector.activePanel = Panel.Agent;
    storage.setItem(EDITOR_WORKSPACE_PREFERENCES_STORAGE_KEY, JSON.stringify(current));
    storage.setItem('rapidraw.lastEditingRightPanel.v1', Panel.Masks);
    expect(readEditorWorkspacePreferences()).toEqual(current);

    storage.setItem(EDITOR_WORKSPACE_PREFERENCES_STORAGE_KEY, '{not-json');
    expect(readEditorWorkspacePreferences().rightInspector.activePanel).toBe(Panel.Color);

    storage.setItem(EDITOR_WORKSPACE_PREFERENCES_STORAGE_KEY, JSON.stringify({ ...current, version: 2 }));
    expect(readEditorWorkspacePreferences().rightInspector.activePanel).toBe(Panel.Color);
  });

  test('persists a complete default after current editor storage recovery', () => {
    const storage = installStorage();
    storage.setItem(EDITOR_WORKSPACE_PREFERENCES_STORAGE_KEY, '{not-json');

    useUIStore.getState().hydrateEditorWorkspacePreferences();

    const persisted = JSON.parse(storage.getItem(EDITOR_WORKSPACE_PREFERENCES_STORAGE_KEY) ?? '{}');
    expect(editorWorkspacePreferencesSchema.parse(persisted)).toEqual(createDefaultEditorWorkspacePreferences());
  });

  test('accepts only complete current library workspace storage', () => {
    const storage = installStorage();
    const current = createDefaultLibraryWorkspacePreferences();
    current.folderTree = { visible: false, width: 320 };
    storage.setItem(LIBRARY_WORKSPACE_PREFERENCES_STORAGE_KEY, JSON.stringify(current));
    expect(readLibraryWorkspacePreferences()).toEqual(current);

    storage.setItem(LIBRARY_WORKSPACE_PREFERENCES_STORAGE_KEY, JSON.stringify({ version: 1, folderTree: {} }));
    useUIStore.getState().hydrateLibraryWorkspacePreferences();
    expect(readLibraryWorkspacePreferences()).toEqual(createDefaultLibraryWorkspacePreferences());
  });

  test('persists compact drawer states without overwriting the preferred drawer height', () => {
    const storage = installStorage();
    const preferences = createDefaultEditorWorkspacePreferences();
    preferences.compact.toolsHeight = 520;
    useUIStore.setState({
      activeRightPanel: Panel.Color,
      editorWorkspacePreferences: preferences,
      renderedRightPanel: Panel.Color,
    });

    useUIStore.getState().setCompactEditorDrawerState('peek');
    expect(useUIStore.getState().activeRightPanel).toBe(Panel.Color);
    expect(useUIStore.getState().editorWorkspacePreferences.compact).toMatchObject({
      drawerState: 'peek',
      toolsExpanded: true,
      toolsHeight: 520,
    });

    useUIStore.getState().setCompactEditorDrawerState('collapsed');
    expect(useUIStore.getState().activeRightPanel).toBe(Panel.Color);
    expect(JSON.parse(storage.getItem(EDITOR_WORKSPACE_PREFERENCES_STORAGE_KEY) ?? '{}').compact).toMatchObject({
      drawerState: 'collapsed',
      toolsExpanded: false,
      toolsHeight: 520,
    });
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
    const storage = installStorage();
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

  test('collapses Effects as a workspace-only preference with zero edit side effects', () => {
    const storage = installStorage();
    const adjustments = { ...structuredClone(INITIAL_ADJUSTMENTS), effectsEnabled: false, grainAmount: 42 };
    const editDocumentV2 = legacyAdjustmentsToEditDocumentV2(adjustments);
    useEditorStore.getState().hydrateEditorRenderAuthority({
      adjustmentRevision: 7,
      editDocumentV2,
      historyIndex: 0,
      lastEditApplicationReceipt: null,
      history: [editDocumentV2],
    });
    const before = useEditorStore.getState();

    useUIStore.getState().setEditorSectionExpanded(Panel.Adjustments, 'effects', false);

    const after = useEditorStore.getState();
    expect(after.adjustmentRevision).toBe(7);
    expect(after.adjustments).toBe(before.adjustments);
    expect(after.editDocumentV2).toBe(before.editDocumentV2);
    expect(after.history).toBe(before.history);
    expect(after.lastEditApplicationReceipt).toBeNull();
    const persisted = JSON.parse(storage.getItem(EDITOR_WORKSPACE_PREFERENCES_STORAGE_KEY) ?? '{}');
    expect(persisted.rightInspector.expandedSectionsByPanel.adjustments).not.toContain('effects');
  });

  test('tolerates unavailable storage without blocking preference updates', () => {
    const storageDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
    try {
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get: () => {
          throw new Error('storage unavailable');
        },
      });
      expect(() => saveEditorWorkspacePreferences(createDefaultEditorWorkspacePreferences())).not.toThrow();
      expect(() => useUIStore.getState().setDefaultEditorZoomMode('fill')).not.toThrow();
    } finally {
      if (storageDescriptor === undefined) Reflect.deleteProperty(window, 'localStorage');
      else Object.defineProperty(window, 'localStorage', storageDescriptor);
    }
  });
});
