export const PRESET_BROWSER_MEMORY_KEY = 'rapidraw.editor.presets.browser.v1';

export interface PresetBrowserMemory {
  favorites: string[];
  recent: Record<string, number>;
}

export const readPresetBrowserMemory = (): PresetBrowserMemory => {
  if (typeof localStorage === 'undefined') return { favorites: [], recent: {} };
  try {
    const value: unknown = JSON.parse(localStorage.getItem(PRESET_BROWSER_MEMORY_KEY) ?? 'null');
    if (typeof value !== 'object' || value === null) return { favorites: [], recent: {} };
    const candidate = value as Partial<PresetBrowserMemory>;
    return {
      favorites: Array.isArray(candidate.favorites)
        ? candidate.favorites.filter((id): id is string => typeof id === 'string').slice(0, 256)
        : [],
      recent:
        typeof candidate.recent === 'object' && candidate.recent !== null
          ? Object.fromEntries(
              Object.entries(candidate.recent)
                .filter(
                  (entry): entry is [string, number] =>
                    typeof entry[0] === 'string' && typeof entry[1] === 'number' && Number.isFinite(entry[1]),
                )
                .slice(0, 256),
            )
          : {},
    };
  } catch {
    return { favorites: [], recent: {} };
  }
};

export const writePresetBrowserMemory = (memory: PresetBrowserMemory): void => {
  if (typeof localStorage !== 'undefined') localStorage.setItem(PRESET_BROWSER_MEMORY_KEY, JSON.stringify(memory));
};

export const recordPresetUse = (memory: PresetBrowserMemory, id: string, usedAt = Date.now()): PresetBrowserMemory => ({
  ...memory,
  recent: Object.fromEntries(
    [...Object.entries(memory.recent), [id, usedAt] as [string, number]]
      .sort((first, second) => first[1] - second[1])
      .slice(-256),
  ),
});
