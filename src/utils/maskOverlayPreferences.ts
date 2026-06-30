import {
  type MaskOverlayMode,
  type MaskOverlaySettings,
  maskOverlaySettingsSchema,
} from '../schemas/maskOverlaySchemas';
import { normalizeMaskOverlaySettings } from './maskOverlayModes';

const MASK_OVERLAY_SETTINGS_STORAGE_KEY = 'rawengine.maskOverlaySettings.v1';

export const MASK_OVERLAY_HOTKEY_MODES: readonly MaskOverlayMode[] = [
  'rubylith',
  'inverse',
  'edges',
  'grayscale',
  'hidden',
];

function readLocalStorage(): Storage | null {
  if (typeof globalThis.localStorage === 'undefined') return null;
  return globalThis.localStorage;
}

export function loadMaskOverlaySettingsPreference(): MaskOverlaySettings {
  const storage = readLocalStorage();
  if (storage === null) return normalizeMaskOverlaySettings();

  try {
    const raw = storage.getItem(MASK_OVERLAY_SETTINGS_STORAGE_KEY);
    if (raw === null) return normalizeMaskOverlaySettings();
    const parsedJson: unknown = JSON.parse(raw);
    const parsedSettings = maskOverlaySettingsSchema.safeParse(parsedJson);
    if (!parsedSettings.success) return normalizeMaskOverlaySettings();
    return normalizeMaskOverlaySettings(parsedSettings.data);
  } catch {
    return normalizeMaskOverlaySettings();
  }
}

export function saveMaskOverlaySettingsPreference(settings: MaskOverlaySettings): MaskOverlaySettings {
  const normalized = normalizeMaskOverlaySettings(settings);
  const storage = readLocalStorage();
  if (storage === null) return normalized;

  try {
    storage.setItem(MASK_OVERLAY_SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Preferences are non-critical; keep the editor state update even if storage is unavailable.
  }

  return normalized;
}

export function nextMaskOverlayHotkeySettings(settings: MaskOverlaySettings): MaskOverlaySettings {
  const normalized = normalizeMaskOverlaySettings(settings);
  const currentIndex = MASK_OVERLAY_HOTKEY_MODES.indexOf(normalized.mode);
  const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % MASK_OVERLAY_HOTKEY_MODES.length;
  const nextMode = MASK_OVERLAY_HOTKEY_MODES[nextIndex] ?? 'rubylith';
  return normalizeMaskOverlaySettings({ ...normalized, mode: nextMode });
}
