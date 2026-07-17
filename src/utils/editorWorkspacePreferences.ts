import { Panel } from '../components/ui/AppProperties';
import {
  type EditorWorkspacePreferences,
  editorWorkspacePreferencesSchema,
} from '../schemas/editorWorkspacePreferencesSchemas';
import {
  DEVELOP_SHELL_DEFAULT_FILMSTRIP_HEIGHT,
  DEVELOP_SHELL_DEFAULT_LEFT_PANEL_WIDTH,
  DEVELOP_SHELL_DEFAULT_RIGHT_PANEL_WIDTH,
} from './developShellGeometry';

export const EDITOR_WORKSPACE_PREFERENCES_STORAGE_KEY = 'rapidraw.editorWorkspacePreferences.v1';

export interface EditorWorkspaceViewport {
  height: number;
  isCompactPortrait: boolean;
  isPortrait: boolean;
  width: number;
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

export const createDefaultEditorWorkspacePreferences = (): EditorWorkspacePreferences => ({
  compact: { drawerState: 'expanded', toolsExpanded: true, toolsHeight: null },
  filmstrip: { height: DEVELOP_SHELL_DEFAULT_FILMSTRIP_HEIGHT, visible: true },
  leftSidebar: {
    expandedSections: ['collections', 'navigator', 'presets'],
    visible: true,
    width: DEVELOP_SHELL_DEFAULT_LEFT_PANEL_WIDTH,
  },
  rightInspector: {
    activePanel: Panel.Color,
    expandedSectionsByPanel: { [Panel.Adjustments]: ['basic', 'curves'] },
    pinnedControlIds: [],
    recentPanels: [Panel.Color],
    visible: true,
    width: DEVELOP_SHELL_DEFAULT_RIGHT_PANEL_WIDTH,
  },
  version: 1,
  viewer: { compareMode: 'off', defaultZoomMode: 'fit', lightsOutLevel: 'off' },
});

export const readEditorWorkspacePreferences = (): EditorWorkspacePreferences => {
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

  return createDefaultEditorWorkspacePreferences();
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
