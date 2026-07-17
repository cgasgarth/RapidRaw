import { z } from 'zod';

export const PRESET_BROWSER_MEMORY_KEY = 'rapidraw.editor.presets.browser.v1';

const presetBrowserMemoryEnvelopeSchema = z
  .object({
    favorites: z.array(z.unknown()).optional(),
    recent: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();

export interface PresetBrowserMemory {
  favorites: string[];
  recent: Record<string, number>;
}

export const readPresetBrowserMemory = (): PresetBrowserMemory => {
  if (typeof localStorage === 'undefined') return { favorites: [], recent: {} };
  try {
    const parsed = presetBrowserMemoryEnvelopeSchema.safeParse(
      JSON.parse(localStorage.getItem(PRESET_BROWSER_MEMORY_KEY) ?? 'null'),
    );
    if (!parsed.success) return { favorites: [], recent: {} };
    const favorites = [
      ...new Set(
        (parsed.data.favorites ?? []).filter((id): id is string => typeof id === 'string' && id.trim().length > 0),
      ),
    ].slice(0, 256);
    const recent = Object.entries(parsed.data.recent ?? {}).reduce<Record<string, number>>((entries, [id, usedAt]) => {
      if (id.trim().length > 0 && typeof usedAt === 'number' && Number.isFinite(usedAt)) entries[id] = usedAt;
      return entries;
    }, {});
    return {
      favorites,
      recent: Object.fromEntries(Object.entries(recent).slice(-256)),
    };
  } catch {
    return { favorites: [], recent: {} };
  }
};

export const writePresetBrowserMemory = (memory: PresetBrowserMemory): void => {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(PRESET_BROWSER_MEMORY_KEY, JSON.stringify(memory));
  } catch {
    // Browser memory is opportunistic; storage failures must not block edits.
  }
};

export const recordPresetUse = (memory: PresetBrowserMemory, id: string, usedAt = Date.now()): PresetBrowserMemory => {
  if (id.trim().length === 0) return memory;
  const timestamp = Number.isFinite(usedAt) ? usedAt : Date.now();
  return {
    ...memory,
    recent: Object.fromEntries(
      [...Object.entries(memory.recent), [id, timestamp] as [string, number]]
        .sort((first, second) => first[1] - second[1])
        .slice(-256),
    ),
  };
};
