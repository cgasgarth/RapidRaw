import {
  type LibraryWorkspacePreferences,
  libraryWorkspacePreferencesSchema,
} from '../schemas/libraryWorkspacePreferencesSchemas';

export const LIBRARY_WORKSPACE_PREFERENCES_STORAGE_KEY = 'rapidraw.libraryWorkspacePreferences.v1';

export interface LegacyLibraryWorkspacePreferences {
  folderTreeVisible?: unknown;
}

export const createDefaultLibraryWorkspacePreferences = (): LibraryWorkspacePreferences => ({
  folderTree: { visible: true, width: 256 },
  version: 1,
});

const getStorage = (): Storage | null => {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
  } catch {
    return null;
  }
};

export const readLibraryWorkspacePreferences = (
  legacy: LegacyLibraryWorkspacePreferences = {},
): LibraryWorkspacePreferences => {
  const storage = getStorage();
  if (storage) {
    try {
      const serialized = storage.getItem(LIBRARY_WORKSPACE_PREFERENCES_STORAGE_KEY);
      if (serialized !== null) {
        const parsed = libraryWorkspacePreferencesSchema.safeParse(JSON.parse(serialized));
        if (parsed.success) return parsed.data;
      }
    } catch {
      // Corrupt or unavailable browser storage must not block Library startup.
    }
  }

  const preferences = createDefaultLibraryWorkspacePreferences();
  if (typeof legacy.folderTreeVisible === 'boolean') preferences.folderTree.visible = legacy.folderTreeVisible;
  return preferences;
};

export const saveLibraryWorkspacePreferences = (preferences: LibraryWorkspacePreferences): void => {
  const parsed = libraryWorkspacePreferencesSchema.safeParse(preferences);
  if (!parsed.success) return;

  try {
    getStorage()?.setItem(LIBRARY_WORKSPACE_PREFERENCES_STORAGE_KEY, JSON.stringify(parsed.data));
  } catch {
    // Quota and privacy-mode failures must not block Library interaction.
  }
};
