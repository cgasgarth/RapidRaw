import { Panel } from '../components/ui/AppProperties';
import {
  type EditorWorkspacePreferences,
  editorWorkspacePreferencesSchema,
} from '../schemas/editorWorkspacePreferencesSchemas';
import {
  DEFAULT_DEVELOP_PANEL_ORDER,
  isValidDevelopPanelHidden,
  isValidDevelopPanelOrder,
} from './developPanelCustomization';
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

const EDITOR_WORKSPACE_PREFERENCE_KEYS = new Set([
  'compact',
  'filmstrip',
  'leftSidebar',
  'rightInspector',
  'version',
  'viewer',
]);
const RIGHT_INSPECTOR_PREFERENCE_KEYS = new Set([
  'activePanel',
  'developPanelHidden',
  'developPanelOrder',
  'expandedSectionsByPanel',
  'pinnedControlIds',
  'recentPanels',
  'visible',
  'width',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Preserve unrelated workspace choices when only this feature's bytes are stale. */
const repairDevelopPanelPreferenceFields = (value: unknown): unknown | null => {
  if (!isRecord(value) || Object.keys(value).some((key) => !EDITOR_WORKSPACE_PREFERENCE_KEYS.has(key))) return null;
  const rightInspector = value['rightInspector'];
  if (!isRecord(rightInspector) || Object.keys(rightInspector).some((key) => !RIGHT_INSPECTOR_PREFERENCE_KEYS.has(key)))
    return null;
  const order = rightInspector['developPanelOrder'];
  const hidden = rightInspector['developPanelHidden'];
  const hasInvalidOrder = order !== undefined && (!Array.isArray(order) || !isValidDevelopPanelOrder(order));
  const hasInvalidHidden = hidden !== undefined && (!Array.isArray(hidden) || !isValidDevelopPanelHidden(hidden));
  if (!hasInvalidOrder && !hasInvalidHidden) return null;
  const repaired = structuredClone(value);
  const repairedRightInspector = repaired['rightInspector'];
  if (!isRecord(repairedRightInspector)) return null;
  if (hasInvalidOrder) repairedRightInspector['developPanelOrder'] = [...DEFAULT_DEVELOP_PANEL_ORDER];
  if (hasInvalidHidden) repairedRightInspector['developPanelHidden'] = [];
  return repaired;
};

export const createDefaultEditorWorkspacePreferences = (): EditorWorkspacePreferences => ({
  compact: { drawerState: 'expanded', toolsExpanded: true, toolsHeight: null },
  filmstrip: { height: DEVELOP_SHELL_DEFAULT_FILMSTRIP_HEIGHT, visible: true },
  leftSidebar: {
    expandedSections: ['navigator', 'presets'],
    soloSectionId: null,
    visible: true,
    width: DEVELOP_SHELL_DEFAULT_LEFT_PANEL_WIDTH,
  },
  rightInspector: {
    activePanel: Panel.Color,
    developPanelHidden: [],
    developPanelOrder: [...DEFAULT_DEVELOP_PANEL_ORDER],
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
        const raw = JSON.parse(serialized) as unknown;
        const parsed = editorWorkspacePreferencesSchema.safeParse(raw);
        if (parsed.success) return parsed.data;
        const repaired = repairDevelopPanelPreferenceFields(raw);
        if (repaired !== null) {
          const repairedParsed = editorWorkspacePreferencesSchema.safeParse(repaired);
          if (repairedParsed.success) return repairedParsed.data;
        }
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
