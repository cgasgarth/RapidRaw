import { platform } from '@tauri-apps/plugin-os';
import { create } from 'zustand';

import { emptyTauriResponseSchema } from '../schemas/tauriResponseSchemas';
import { Invokes } from '../tauri/commands';
import { invokeWithSchema } from '../utils/tauriSchemaInvoke';
import { DEFAULT_THEME_ID } from '../utils/themes';

import type { AppSettings, SupportedTypes, Theme } from '../components/ui/AppProperties';

interface SettingsState {
  appSettings: AppSettings | null;
  theme: Theme;
  supportedTypes: SupportedTypes | null;
  osPlatform: string;

  // Actions
  initPlatform: () => void;
  setAppSettings: (settings: AppSettings | null) => void;
  setTheme: (theme: Theme) => void;
  setSupportedTypes: (types: SupportedTypes | null) => void;
  handleSettingsChange: (newSettings: AppSettings) => Promise<void>;
}

type AppSettingsWithTransientSearch = AppSettings & { searchCriteria?: unknown };

export const useSettingsStore = create<SettingsState>((set, get) => ({
  appSettings: null,
  theme: DEFAULT_THEME_ID,
  supportedTypes: null,
  osPlatform: '',

  initPlatform: () => {
    try {
      set({ osPlatform: platform() });
    } catch (_err) {
      set({ osPlatform: '' });
    }
  },

  setAppSettings: (settings) => {
    set({ appSettings: settings });
  },

  setTheme: (theme) => {
    set({ theme });
  },

  setSupportedTypes: (types) => {
    set({ supportedTypes: types });
  },

  handleSettingsChange: async (newSettings: AppSettings) => {
    if (newSettings.theme !== get().theme) {
      set({ theme: newSettings.theme });
    }

    const { searchCriteria: _searchCriteria, ...settingsToSave } = newSettings as AppSettingsWithTransientSearch;
    set({ appSettings: newSettings });

    try {
      await invokeWithSchema(Invokes.SaveSettings, { settings: settingsToSave }, emptyTauriResponseSchema);
    } catch (err) {
      console.error('Failed to save settings:', err);
    }
  },
}));
