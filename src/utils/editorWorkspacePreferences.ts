import { EDITING_RIGHT_PANELS } from '../components/panel/right/rightPanelRegistry';
import { Panel } from '../components/ui/AppProperties';
import {
  type EditorWorkspacePreferences,
  editorWorkspacePreferencesSchema,
} from '../schemas/editorWorkspacePreferencesSchemas';

export const EDITOR_WORKSPACE_PREFERENCES_STORAGE_KEY = 'rapidraw.editorWorkspacePreferences.v1';
export const LEGACY_LAST_EDITING_RIGHT_PANEL_STORAGE_KEY = 'rapidraw.lastEditingRightPanel.v1';
export const LEGACY_DEVELOP_PANEL_PINNED_CONTROL_IDS_STORAGE_KEY = 'rapidraw.developPanelPinnedControlIds.v1';

export interface EditorWorkspaceViewport {
  height: number;
  isCompactPortrait: boolean;
  width: number;
}

export interface LegacyEditorWorkspacePreferences {
  bottomPanelHeight?: unknown;
  compactEditorPanelHeightOverride?: unknown;
  leftPanelWidth?: unknown;
  rightPanelWidth?: unknown;
  uiVisibility?: { filmstrip?: unknown; folderTree?: unknown };
}

export interface EffectiveEditorWorkspaceLayout {
  bottomPanelHeight: number;
  compactEditorPanelHeightOverride: number | null;
  leftPanelWidth: number;
  rightPanelWidth: number;
}

const MINIMUM_VIEWER_HEIGHT = 240;
const MINIMUM_VIEWER_WIDTH = 480;
const HIDDEN_LEFT_RAIL_WIDTH = 32;
const HIDDEN_RIGHT_RAIL_WIDTH = 42;

const getStorage = (): Storage | null => {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
  } catch {
    return null;
  }
};

const isEditingPanel = (value: unknown): value is (typeof EDITING_RIGHT_PANELS)[number] =>
  EDITING_RIGHT_PANELS.includes(value as (typeof EDITING_RIGHT_PANELS)[number]);

const isFiniteIntegerWithin = (value: unknown, minimum: number, maximum: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum;

const uniqueNonEmptyStrings = (values: unknown, maximum = 32): string[] => {
  if (!Array.isArray(values)) return [];
  return [
    ...new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)),
  ].slice(0, maximum);
};

export const createDefaultEditorWorkspacePreferences = (): EditorWorkspacePreferences => ({
  compact: { toolsExpanded: true, toolsHeight: null },
  filmstrip: { height: 144, visible: true },
  leftSidebar: { expandedSections: [], visible: true, width: 256 },
  rightInspector: {
    activePanel: Panel.Color,
    expandedSectionsByPanel: { [Panel.Adjustments]: ['basic', 'curves'] },
    pinnedControlIds: [],
    recentPanels: [Panel.Color],
    visible: true,
    width: 360,
  },
  version: 1,
  viewer: { compareMode: 'off', defaultZoomMode: 'fit', lightsOutLevel: 'off' },
});

const readLegacyStorage = () => {
  const storage = getStorage();
  if (!storage) return { activePanel: null, pinnedControlIds: [] as string[] };

  try {
    const activePanel = storage.getItem(LEGACY_LAST_EDITING_RIGHT_PANEL_STORAGE_KEY);
    const pinnedControlIds = JSON.parse(storage.getItem(LEGACY_DEVELOP_PANEL_PINNED_CONTROL_IDS_STORAGE_KEY) ?? '[]');
    return {
      activePanel: isEditingPanel(activePanel) ? activePanel : null,
      pinnedControlIds: uniqueNonEmptyStrings(pinnedControlIds),
    };
  } catch {
    return { activePanel: null, pinnedControlIds: [] as string[] };
  }
};

const hasLegacyValues = (
  legacy: LegacyEditorWorkspacePreferences,
  legacyStorage: ReturnType<typeof readLegacyStorage>,
) =>
  legacy.uiVisibility !== undefined ||
  legacy.leftPanelWidth !== undefined ||
  legacy.rightPanelWidth !== undefined ||
  legacy.bottomPanelHeight !== undefined ||
  legacy.compactEditorPanelHeightOverride !== undefined ||
  legacyStorage.activePanel !== null ||
  legacyStorage.pinnedControlIds.length > 0;

export const migrateLegacyEditorWorkspacePreferences = (
  legacy: LegacyEditorWorkspacePreferences = {},
): EditorWorkspacePreferences => {
  const defaults = createDefaultEditorWorkspacePreferences();
  const legacyStorage = readLegacyStorage();

  return {
    ...defaults,
    compact: {
      ...defaults.compact,
      toolsHeight: isFiniteIntegerWithin(legacy.compactEditorPanelHeightOverride, 180, 850)
        ? legacy.compactEditorPanelHeightOverride
        : defaults.compact.toolsHeight,
    },
    filmstrip: {
      ...defaults.filmstrip,
      height: isFiniteIntegerWithin(legacy.bottomPanelHeight, 100, 400)
        ? legacy.bottomPanelHeight
        : defaults.filmstrip.height,
      visible:
        typeof legacy.uiVisibility?.filmstrip === 'boolean'
          ? legacy.uiVisibility.filmstrip
          : defaults.filmstrip.visible,
    },
    leftSidebar: {
      ...defaults.leftSidebar,
      visible:
        typeof legacy.uiVisibility?.folderTree === 'boolean'
          ? legacy.uiVisibility.folderTree
          : defaults.leftSidebar.visible,
      width: isFiniteIntegerWithin(legacy.leftPanelWidth, 200, 500)
        ? legacy.leftPanelWidth
        : defaults.leftSidebar.width,
    },
    rightInspector: {
      ...defaults.rightInspector,
      activePanel: legacyStorage.activePanel ?? defaults.rightInspector.activePanel,
      pinnedControlIds: legacyStorage.pinnedControlIds,
      recentPanels: legacyStorage.activePanel ? [legacyStorage.activePanel] : defaults.rightInspector.recentPanels,
      width: isFiniteIntegerWithin(legacy.rightPanelWidth, 320, 600)
        ? legacy.rightPanelWidth
        : defaults.rightInspector.width,
    },
  };
};

export const readEditorWorkspacePreferences = (
  legacy: LegacyEditorWorkspacePreferences = {},
): EditorWorkspacePreferences => {
  const storage = getStorage();
  if (storage) {
    try {
      const serialized = storage.getItem(EDITOR_WORKSPACE_PREFERENCES_STORAGE_KEY);
      if (serialized !== null) {
        const parsed = editorWorkspacePreferencesSchema.safeParse(JSON.parse(serialized));
        if (parsed.success) return parsed.data;
      }
    } catch {
      // Startup must remain available when browser storage is unavailable or corrupt.
    }
  }

  return migrateLegacyEditorWorkspacePreferences(legacy);
};

export const saveEditorWorkspacePreferences = (preferences: EditorWorkspacePreferences): void => {
  const parsed = editorWorkspacePreferencesSchema.safeParse(preferences);
  if (!parsed.success) return;

  try {
    getStorage()?.setItem(EDITOR_WORKSPACE_PREFERENCES_STORAGE_KEY, JSON.stringify(parsed.data));
  } catch {
    // Quota and privacy-mode failures must not block editor interaction.
  }
};

export const shouldPersistLegacyWorkspaceMigration = (legacy: LegacyEditorWorkspacePreferences = {}): boolean =>
  hasLegacyValues(legacy, readLegacyStorage());

export const getEffectiveEditorWorkspaceLayout = (
  preferences: EditorWorkspacePreferences,
  viewport: EditorWorkspaceViewport,
): EffectiveEditorWorkspaceLayout => {
  const desiredLeftWidth = preferences.leftSidebar.visible ? preferences.leftSidebar.width : HIDDEN_LEFT_RAIL_WIDTH;
  const desiredRightWidth = preferences.rightInspector.visible
    ? preferences.rightInspector.width
    : HIDDEN_RIGHT_RAIL_WIDTH;
  const availableSideWidth = Math.max(0, viewport.width - MINIMUM_VIEWER_WIDTH);
  const sideScale = Math.min(1, availableSideWidth / (desiredLeftWidth + desiredRightWidth));
  const maximumFilmstripHeight = Math.max(0, viewport.height - MINIMUM_VIEWER_HEIGHT);
  const maximumCompactToolsHeight = Math.max(180, Math.min(viewport.height - 300, 850));

  return {
    bottomPanelHeight: Math.min(preferences.filmstrip.height, maximumFilmstripHeight),
    compactEditorPanelHeightOverride:
      preferences.compact.toolsHeight === null
        ? null
        : Math.min(preferences.compact.toolsHeight, maximumCompactToolsHeight),
    leftPanelWidth: Math.round(desiredLeftWidth * sideScale),
    rightPanelWidth: Math.round(desiredRightWidth * sideScale),
  };
};
