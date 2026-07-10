import { invoke } from '@tauri-apps/api/core';
import type { i18n as I18n } from 'i18next';
import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import type { FolderTree } from '../../components/panel/FolderTree';
import {
  type AppSettings,
  EditedStatus,
  type FilterCriteria,
  LibraryViewMode,
  type SupportedTypes,
  type Theme,
  type ThumbnailAspectRatio,
  ThumbnailSize,
} from '../../components/ui/AppProperties';
import { type PanelScopesLayout, useEditorStore } from '../../store/useEditorStore';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useUIStore } from '../../store/useUIStore';
import { Invokes } from '../../tauri/commands';
import { COPYABLE_ADJUSTMENT_KEYS, DisplayMode, PasteMode } from '../../utils/adjustments';
import { DEFAULT_THEME_ID, THEMES, type ThemeProps } from '../../utils/themes';
import { clampPanelScopesHeight } from '../../utils/waveformSizing';

interface PersistedFolderState {
  activeAlbumId?: string | null;
  currentFolderPath?: string | null;
  expandedAlbumGroups?: string[];
  expandedFolders?: string[];
}

const DISPLAY_MODES = new Set<string>(Object.values(DisplayMode));
const isDisplayMode = (value: string): value is DisplayMode => DISPLAY_MODES.has(value);
const PANEL_SCOPES_LAYOUTS = new Set<string>(['overlay', 'stacked']);
const isPanelScopesLayout = (value: string): value is PanelScopesLayout => PANEL_SCOPES_LAYOUTS.has(value);

interface InitializationSettings extends AppSettings {
  lastFolderState?: PersistedFolderState | null;
  pinnedFolders?: string[];
}

interface NavigatorWithUserLanguage extends Navigator {
  userLanguage?: string;
}

interface UseAppInitializationProps {
  thumbnailSize: ThumbnailSize;
  setThumbnailSize: (size: ThumbnailSize) => void;
  thumbnailAspectRatio: ThumbnailAspectRatio;
  setThumbnailAspectRatio: (ratio: ThumbnailAspectRatio) => void;
  libraryViewMode: LibraryViewMode;
  setLibraryViewMode: (mode: LibraryViewMode) => void;
}

const getDefaultLanguage = (i18nInstance: I18n): string => {
  const browserLang = navigator.language || (navigator as NavigatorWithUserLanguage).userLanguage || 'en';
  const shortLang = (browserLang.split('-')[0] ?? browserLang).toLowerCase();
  const supportedLanguages = Object.keys(i18nInstance.options.resources || {});
  const fallbackLng = i18nInstance.options.fallbackLng;
  const fallbackLang =
    typeof fallbackLng === 'string'
      ? fallbackLng
      : Array.isArray(fallbackLng) && typeof fallbackLng[0] === 'string'
        ? fallbackLng[0]
        : 'en';

  // Check full locale first (e.g., 'zh-CN'), then short code (e.g., 'zh')
  return supportedLanguages.includes(browserLang)
    ? browserLang
    : supportedLanguages.includes(shortLang)
      ? shortLang
      : fallbackLang;
};

export const useAppInitialization = ({
  thumbnailSize,
  setThumbnailSize,
  thumbnailAspectRatio,
  setThumbnailAspectRatio,
  libraryViewMode,
  setLibraryViewMode,
}: UseAppInitializationProps) => {
  const isInitialMount = useRef(true);
  const { i18n } = useTranslation();

  const {
    appSettings,
    theme,
    osPlatform,
    setAppSettings,
    setTheme,
    setSupportedTypes,
    initPlatform,
    handleSettingsChange,
  } = useSettingsStore(
    useShallow((state) => ({
      appSettings: state.appSettings,
      theme: state.theme,
      osPlatform: state.osPlatform,
      setAppSettings: state.setAppSettings,
      setTheme: state.setTheme,
      setSupportedTypes: state.setSupportedTypes,
      initPlatform: state.initPlatform,
      handleSettingsChange: state.handleSettingsChange,
    })),
  );

  const { hydrateEditorWorkspacePreferences, hydrateLibraryWorkspacePreferences } = useUIStore(
    useShallow((state) => ({
      hydrateEditorWorkspacePreferences: state.hydrateEditorWorkspacePreferences,
      hydrateLibraryWorkspacePreferences: state.hydrateLibraryWorkspacePreferences,
    })),
  );

  const {
    sortCriteria,
    filterCriteria,
    currentFolderPath,
    expandedFolders,
    activeAlbumId,
    expandedAlbumGroups,
    setSortCriteria,
    setFilterCriteria,
    setLibrary,
  } = useLibraryStore(
    useShallow((state) => ({
      sortCriteria: state.sortCriteria,
      filterCriteria: state.filterCriteria,
      currentFolderPath: state.currentFolderPath,
      expandedFolders: state.expandedFolders,
      activeAlbumId: state.activeAlbumId,
      expandedAlbumGroups: state.expandedAlbumGroups,
      setSortCriteria: state.setSortCriteria,
      setFilterCriteria: state.setFilterCriteria,
      setLibrary: state.setLibrary,
    })),
  );

  const { setEditor } = useEditorStore(
    useShallow((state) => ({
      setEditor: state.setEditor,
    })),
  );

  const isAndroid = osPlatform === 'android';
  const defaultThumbnailSize = isAndroid ? ThumbnailSize.Small : ThumbnailSize.Medium;
  const defaultLibraryViewMode = isAndroid ? LibraryViewMode.Recursive : LibraryViewMode.Flat;
  const persistSettings = useCallback(
    (settings: AppSettings) => {
      void handleSettingsChange(settings).catch((err: unknown) => {
        console.error('Failed to persist settings:', err);
      });
    },
    [handleSettingsChange],
  );

  useEffect(() => {
    initPlatform();
  }, [initPlatform]);

  useEffect(() => {
    invoke<SupportedTypes>(Invokes.GetSupportedFileTypes)
      .then((types) => {
        setSupportedTypes(types);
      })
      .catch((err: unknown) => {
        console.error('Failed to load supported file types:', err);
      });
  }, [setSupportedTypes]);

  useEffect(() => {
    invoke<InitializationSettings>(Invokes.LoadSettings)
      .then(async (settings) => {
        if (!settings.copyPasteSettings || settings.copyPasteSettings.includedAdjustments.length === 0) {
          settings.copyPasteSettings = {
            mode: PasteMode.Merge,
            includedAdjustments: COPYABLE_ADJUSTMENT_KEYS,
            knownAdjustments: COPYABLE_ADJUSTMENT_KEYS,
          };
        }

        if (!settings.language) {
          settings.language = getDefaultLanguage(i18n);
          await handleSettingsChange(settings);
        }

        setAppSettings(settings);
        await i18n.changeLanguage(settings.language);

        if (settings.sortCriteria) setSortCriteria(settings.sortCriteria);

        const savedFilterCriteria = settings.filterCriteria;
        if (savedFilterCriteria) {
          setFilterCriteria((prev: FilterCriteria) => ({
            ...prev,
            ...savedFilterCriteria,
            rawStatus: savedFilterCriteria.rawStatus,
            editedStatus: savedFilterCriteria.editedStatus || EditedStatus.All,
            colors: savedFilterCriteria.colors,
          }));
        }

        setTheme(settings.theme);

        hydrateEditorWorkspacePreferences(
          settings.uiVisibility === undefined ? {} : { uiVisibility: settings.uiVisibility },
        );
        hydrateLibraryWorkspacePreferences(settings.uiVisibility?.folderTree);

        if (settings.isWaveformVisible !== undefined) setEditor({ isWaveformVisible: settings.isWaveformVisible });
        if (settings.activeWaveformChannel && isDisplayMode(settings.activeWaveformChannel)) {
          setEditor({ activeWaveformChannel: settings.activeWaveformChannel });
        }
        if (typeof settings.waveformHeight === 'number') {
          setEditor({ waveformHeight: clampPanelScopesHeight(settings.waveformHeight) });
        }
        if (settings.panelScopesLayout && isPanelScopesLayout(settings.panelScopesLayout)) {
          setEditor({ panelScopesLayout: settings.panelScopesLayout });
        }

        setLibraryViewMode(settings.libraryViewMode ?? defaultLibraryViewMode);
        setThumbnailSize(settings.thumbnailSize ?? defaultThumbnailSize);
        if (settings.thumbnailAspectRatio) setThumbnailAspectRatio(settings.thumbnailAspectRatio);

        if (settings.pinnedFolders && settings.pinnedFolders.length > 0) {
          try {
            const trees = await invoke<FolderTree[]>(Invokes.GetPinnedFolderTrees, {
              paths: settings.pinnedFolders,
              expandedFolders: settings.lastFolderState?.expandedFolders || [],
              showImageCounts: settings.enableFolderImageCounts ?? false,
            });
            setLibrary({ pinnedFolderTrees: trees });
          } catch (err) {
            console.error('Failed to load pinned folder trees:', err);
          }
        }

        if (settings.lastFolderState) {
          setLibrary({
            expandedFolders: new Set(settings.lastFolderState.expandedFolders || []),
            expandedAlbumGroups: new Set(settings.lastFolderState.expandedAlbumGroups || []),
          });
        }

        invoke(Invokes.FrontendReady).catch((e: unknown) => {
          console.error('Failed to notify backend of readiness:', e);
        });
      })
      .catch((err: unknown) => {
        console.error('Failed to load settings:', err);
        setAppSettings({
          lastRootPath: null,
          theme: DEFAULT_THEME_ID as Theme,
          thumbnailSize: defaultThumbnailSize,
          libraryViewMode: defaultLibraryViewMode,
        });
      })
      .finally(() => {
        isInitialMount.current = false;
      });
  }, [
    isAndroid,
    setAppSettings,
    setTheme,
    hydrateEditorWorkspacePreferences,
    hydrateLibraryWorkspacePreferences,
    defaultLibraryViewMode,
    defaultThumbnailSize,
    setSortCriteria,
    setFilterCriteria,
    setEditor,
    setLibrary,
    setLibraryViewMode,
    setThumbnailSize,
    setThumbnailAspectRatio,
    handleSettingsChange,
    i18n,
  ]);

  useEffect(() => {
    if (isInitialMount.current || !appSettings) return;
    if (appSettings.thumbnailSize !== thumbnailSize) {
      persistSettings({ ...appSettings, thumbnailSize });
    }
  }, [thumbnailSize, appSettings, persistSettings]);

  useEffect(() => {
    if (isInitialMount.current || !appSettings) return;
    if (appSettings.thumbnailAspectRatio !== thumbnailAspectRatio) {
      persistSettings({ ...appSettings, thumbnailAspectRatio });
    }
  }, [thumbnailAspectRatio, appSettings, persistSettings]);

  useEffect(() => {
    if (isInitialMount.current || !appSettings) return;
    if (appSettings.libraryViewMode !== libraryViewMode) {
      persistSettings({ ...appSettings, libraryViewMode });
    }
  }, [libraryViewMode, appSettings, persistSettings]);

  useEffect(() => {
    if (isInitialMount.current || !appSettings) return;
    if (JSON.stringify(appSettings.sortCriteria) !== JSON.stringify(sortCriteria)) {
      persistSettings({ ...appSettings, sortCriteria });
    }
  }, [sortCriteria, appSettings, persistSettings]);

  useEffect(() => {
    if (isInitialMount.current || !appSettings) return;
    if (JSON.stringify(appSettings.filterCriteria) !== JSON.stringify(filterCriteria)) {
      persistSettings({ ...appSettings, filterCriteria });
    }
  }, [filterCriteria, appSettings, persistSettings]);

  useEffect(() => {
    if (isInitialMount.current || !appSettings) return;
    if (appSettings.language && appSettings.language !== i18n.language) {
      void i18n.changeLanguage(appSettings.language).catch((err: unknown) => {
        console.error('Failed to change language:', err);
      });
    }
  }, [appSettings, i18n]);

  useEffect(() => {
    if (isInitialMount.current || !appSettings) return;
    if (!currentFolderPath && !activeAlbumId) return;

    const currentExpanded = Array.from(expandedFolders);
    const currentExpandedAlbums = Array.from(expandedAlbumGroups);

    const prevFolderState = appSettings.lastFolderState || {
      currentFolderPath: null,
      expandedFolders: [],
      activeAlbumId: null,
      expandedAlbumGroups: [],
    };

    const pathChanged = prevFolderState.currentFolderPath !== currentFolderPath;
    const expandedChanged = JSON.stringify(prevFolderState.expandedFolders || []) !== JSON.stringify(currentExpanded);
    const albumChanged = prevFolderState.activeAlbumId !== activeAlbumId;
    const albumExpandedChanged =
      JSON.stringify(prevFolderState.expandedAlbumGroups || []) !== JSON.stringify(currentExpandedAlbums);

    if (pathChanged || expandedChanged || albumChanged || albumExpandedChanged) {
      persistSettings({
        ...appSettings,
        lastFolderState: {
          currentFolderPath,
          expandedFolders: currentExpanded,
          activeAlbumId,
          expandedAlbumGroups: currentExpandedAlbums,
        },
      });
    }
  }, [currentFolderPath, expandedFolders, activeAlbumId, expandedAlbumGroups, appSettings, persistSettings]);

  useEffect(() => {
    const root = document.documentElement;
    const currentThemeId = theme;

    const baseTheme =
      THEMES.find((t: ThemeProps) => t.id === currentThemeId) ||
      THEMES.find((t: ThemeProps) => t.id === DEFAULT_THEME_ID);
    if (!baseTheme) return;

    const finalCssVariables = { ...baseTheme.cssVariables };

    Object.entries(finalCssVariables).forEach(([key, value]) => {
      root.style.setProperty(key, value);
    });

    const fontFamily = appSettings?.fontFamily || 'poppins';
    const fontStack =
      fontFamily === 'system'
        ? '-apple-system, BlinkMacSystemFont, system-ui, sans-serif'
        : "'Poppins', system-ui, sans-serif";
    root.style.setProperty('--font-family', fontStack);
  }, [theme, appSettings?.fontFamily]);
};
