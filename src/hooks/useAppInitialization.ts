import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useShallow } from 'zustand/react/shallow';
import { useSettingsStore } from '../store/useSettingsStore';
import { useUIStore } from '../store/useUIStore';
import { useLibraryStore } from '../store/useLibraryStore';
import { useEditorStore } from '../store/useEditorStore';
import { useProcessStore } from '../store/useProcessStore';
import { THEMES, DEFAULT_THEME_ID, ThemeProps } from '../utils/themes';
import { COPYABLE_ADJUSTMENT_KEYS, PasteMode } from '../utils/adjustments';
import {
  AppSettings,
  FilterCriteria,
  ImageFile,
  Invokes,
  LastFolderState,
  LibraryViewMode,
  EditedStatus,
  RawStatus,
  SupportedTypes,
  Theme,
  ThumbnailSize,
  ThumbnailAspectRatio,
} from '../components/ui/AppProperties';
import { useTranslation } from 'react-i18next';
import type { i18n as I18n } from 'i18next';
import type { FolderTree } from '../components/ui/AppProperties';
import { ExternalEditSession } from '../store/useProcessStore';

export interface PreloadedData {
  trees?: Promise<FolderTree[]>;
  images?: Promise<ImageFile[]>;
  rootPaths?: string[];
  currentPath?: string;
}

interface PersistedFolderState extends LastFolderState {
  activeAlbumId?: string | null;
}

interface FrontendLaunch {
  editSession?: ExternalEditSession;
  openWithFile?: string;
}

interface UseAppInitializationProps {
  preloadedDataRef: React.RefObject<PreloadedData>;
  thumbnailSize: ThumbnailSize;
  setThumbnailSize: (size: ThumbnailSize) => void;
  thumbnailAspectRatio: ThumbnailAspectRatio;
  setThumbnailAspectRatio: (ratio: ThumbnailAspectRatio) => void;
  libraryViewMode: LibraryViewMode;
  setLibraryViewMode: (mode: LibraryViewMode) => void;
}

const getDefaultLanguage = (i18nInstance: I18n): string => {
  const nav = navigator as Navigator & { userLanguage?: string };
  const browserLang = nav.language || nav.userLanguage || 'en';
  const shortLang = browserLang.split('-')[0].toLowerCase();
  const supportedLanguages = Object.keys(i18nInstance.options.resources || {});
  const fallbackLngOption = i18nInstance.options.fallbackLng;
  const firstFallback = Array.isArray(fallbackLngOption) ? fallbackLngOption[0] : undefined;
  const fallbackLang =
    typeof fallbackLngOption === 'string'
      ? fallbackLngOption
      : typeof firstFallback === 'string'
        ? firstFallback
        : 'en';

  return supportedLanguages.includes(browserLang)
    ? browserLang
    : supportedLanguages.includes(shortLang)
      ? shortLang
      : fallbackLang;
};

export const useAppInitialization = ({
  preloadedDataRef,
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

  const { uiVisibility, setUI } = useUIStore(
    useShallow((state) => ({
      uiVisibility: state.uiVisibility,
      setUI: state.setUI,
    })),
  );

  const workspaceProps = useUIStore(
    useShallow((state) => ({
      leftPanelWidth: state.leftPanelWidth,
      rightPanelWidth: state.rightPanelWidth,
      leftTopHeight: state.leftTopHeight,
      rightTopHeight: state.rightTopHeight,
      panelLayout: state.panelLayout,
      activePanels: state.activePanels,
      panelSwitcherPlacement: state.panelSwitcherPlacement,
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
  const prevImageCountsNeed = useRef<boolean | undefined>(undefined);

  useEffect(() => {
    initPlatform();
  }, [initPlatform]);

  useEffect(() => {
    invoke<SupportedTypes>(Invokes.GetSupportedFileTypes)
      .then((types) => setSupportedTypes(types))
      .catch((err) => console.error('Failed to load supported file types:', err));
  }, [setSupportedTypes]);

  useEffect(() => {
    invoke<AppSettings>(Invokes.LoadSettings)
      .then(async (settings) => {
        if (!settings.copyPasteSettings || settings.copyPasteSettings.includedAdjustments.length === 0) {
          settings.copyPasteSettings = {
            mode: PasteMode.Merge,
            includedAdjustments: COPYABLE_ADJUSTMENT_KEYS,
            knownAdjustments: COPYABLE_ADJUSTMENT_KEYS,
            autoSync: false,
          };
        }

        if (!settings.language) {
          settings.language = getDefaultLanguage(i18n);
          handleSettingsChange(settings);
        }

        // legacy
        const savedRawStatus = settings.filterCriteria?.rawStatus as string | undefined;
        if (savedRawStatus === 'groupVariants' || savedRawStatus === 'rawOverNonRaw') {
          const legacyPref = settings.groupPreferredType === 'jpeg' ? 'jpeg' : 'raw';
          settings.grouping = legacyPref;
          settings.filterCriteria = {
            colors: settings.filterCriteria?.colors ?? [],
            rating: settings.filterCriteria?.rating ?? 0,
            rawStatus: RawStatus.All,
            editedStatus: settings.filterCriteria?.editedStatus,
          };
          handleSettingsChange(settings);
        }

        setAppSettings(settings);
        i18n.changeLanguage(settings.language);

        if (settings.sortCriteria) setSortCriteria(settings.sortCriteria);

        const loadedFilterCriteria = settings.filterCriteria;
        if (loadedFilterCriteria) {
          setFilterCriteria((prev: FilterCriteria) => ({
            ...prev,
            ...loadedFilterCriteria,
            rawStatus: loadedFilterCriteria.rawStatus,
            editedStatus: loadedFilterCriteria.editedStatus || EditedStatus.All,
            colors: loadedFilterCriteria.colors,
          }));
        }

        setTheme(settings.theme);

        if (settings.uiVisibility) {
          setUI((state) => ({ uiVisibility: { ...state.uiVisibility, ...settings.uiVisibility } }));
        }

        if (settings.workspace) {
          setUI({
            leftPanelWidth: settings.workspace.leftPanelWidth,
            rightPanelWidth: settings.workspace.rightPanelWidth,
            leftTopHeight: settings.workspace.leftTopHeight,
            rightTopHeight: settings.workspace.rightTopHeight,
            panelLayout: settings.workspace.panelLayout,
            activePanels: settings.workspace.activePanels,
            panelSwitcherPlacement: settings.workspace.panelSwitcherPlacement,
          });
        }

        if (settings.isWaveformVisible !== undefined) setEditor({ isWaveformVisible: settings.isWaveformVisible });
        if (settings.activeWaveformChannel) setEditor({ activeWaveformChannel: settings.activeWaveformChannel });
        if (typeof settings.waveformHeight === 'number') setEditor({ waveformHeight: settings.waveformHeight });

        setLibraryViewMode(settings.libraryViewMode ?? defaultLibraryViewMode);
        setThumbnailSize(settings.thumbnailSize ?? defaultThumbnailSize);
        if (settings.thumbnailAspectRatio) setThumbnailAspectRatio(settings.thumbnailAspectRatio);

        if (settings.pinnedFolders && settings.pinnedFolders.length > 0) {
          try {
            const trees = await invoke<FolderTree[]>(Invokes.GetPinnedFolderTrees, {
              paths: settings.pinnedFolders,
              expandedFolders: settings.lastFolderState?.expandedFolders || [],
              showImageCounts: settings.enableFolderImageCounts || settings.folderTreeSort?.key === 'imageCount',
            });
            setLibrary({ pinnedFolderTrees: trees });
          } catch (err) {
            console.error('Failed to load pinned folder trees:', err);
          }
        }

        const rootFolders = settings.rootFolders?.length
          ? settings.rootFolders
          : settings.lastRootPath
            ? [settings.lastRootPath]
            : [];

        if (!isAndroid && rootFolders.length > 0) {
          const currentPath = settings.lastFolderState?.currentFolderPath || rootFolders[0];
          const isAlbum = currentPath.startsWith('Album: ');
          const command =
            settings.libraryViewMode === LibraryViewMode.Recursive
              ? Invokes.ListImagesRecursive
              : Invokes.ListImagesInDir;

          preloadedDataRef.current = {
            rootPaths: rootFolders,
            currentPath: currentPath,
            trees: invoke<FolderTree[]>(Invokes.GetPinnedFolderTrees, {
              paths: rootFolders,
              expandedFolders: settings.lastFolderState?.expandedFolders ?? rootFolders,
              showImageCounts: settings.enableFolderImageCounts || settings.folderTreeSort?.key === 'imageCount',
            }),
            images: isAlbum ? undefined : invoke<ImageFile[]>(command, { path: currentPath }),
          };
        }

        if (settings.lastFolderState) {
          setLibrary({
            expandedFolders: new Set(settings.lastFolderState.expandedFolders || []),
            expandedAlbumGroups: new Set(settings.lastFolderState.expandedAlbumGroups || []),
          });
        }

        invoke<FrontendLaunch>('frontend_ready')
          .then((launch) => {
            if (launch.editSession) {
              useProcessStore.getState().setProcess({ externalEditSession: launch.editSession });
            } else if (launch.openWithFile) {
              useProcessStore.getState().setProcess({ initialFileToOpen: launch.openWithFile });
            }
          })
          .catch((e) => console.error('Failed to notify backend of readiness:', e));
      })
      .catch((err) => {
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
    setUI,
    defaultLibraryViewMode,
    defaultThumbnailSize,
    setSortCriteria,
    setFilterCriteria,
    setEditor,
    setLibrary,
    preloadedDataRef,
    setLibraryViewMode,
    setThumbnailSize,
    setThumbnailAspectRatio,
  ]);

  useEffect(() => {
    if (isInitialMount.current || !appSettings) return;

    const currentWorkspaceStr = JSON.stringify(appSettings.workspace || {});
    const newWorkspaceStr = JSON.stringify(workspaceProps);

    if (currentWorkspaceStr !== newWorkspaceStr) {
      const timeoutId = setTimeout(() => {
        handleSettingsChange({ ...appSettings, workspace: workspaceProps });
      }, 500);

      return () => clearTimeout(timeoutId);
    }
    return;
  }, [workspaceProps, appSettings, handleSettingsChange]);

  useEffect(() => {
    if (isInitialMount.current || !appSettings) return;
    if (JSON.stringify(appSettings.uiVisibility) !== JSON.stringify(uiVisibility)) {
      handleSettingsChange({ ...appSettings, uiVisibility });
    }
  }, [uiVisibility, appSettings, handleSettingsChange]);

  useEffect(() => {
    if (isInitialMount.current || !appSettings) return;
    if (appSettings.thumbnailSize !== thumbnailSize) {
      handleSettingsChange({ ...appSettings, thumbnailSize });
    }
  }, [thumbnailSize, appSettings, handleSettingsChange]);

  useEffect(() => {
    if (isInitialMount.current || !appSettings) return;
    if (appSettings.thumbnailAspectRatio !== thumbnailAspectRatio) {
      handleSettingsChange({ ...appSettings, thumbnailAspectRatio });
    }
  }, [thumbnailAspectRatio, appSettings, handleSettingsChange]);

  useEffect(() => {
    if (isInitialMount.current || !appSettings) return;
    if (appSettings.libraryViewMode !== libraryViewMode) {
      handleSettingsChange({ ...appSettings, libraryViewMode });
    }
  }, [libraryViewMode, appSettings, handleSettingsChange]);

  useEffect(() => {
    if (isInitialMount.current || !appSettings) return;
    if (JSON.stringify(appSettings.sortCriteria) !== JSON.stringify(sortCriteria)) {
      handleSettingsChange({ ...appSettings, sortCriteria });
    }
  }, [sortCriteria, appSettings, handleSettingsChange]);

  useEffect(() => {
    if (isInitialMount.current || !appSettings) return;
    if (JSON.stringify(appSettings.filterCriteria) !== JSON.stringify(filterCriteria)) {
      handleSettingsChange({ ...appSettings, filterCriteria });
    }
  }, [filterCriteria, appSettings, handleSettingsChange]);

  useEffect(() => {
    if (isInitialMount.current || !appSettings) return;
    if (appSettings.language && appSettings.language !== i18n.language) {
      i18n.changeLanguage(appSettings.language);
    }
  }, [appSettings?.language, i18n.language]);

  useEffect(() => {
    if (isInitialMount.current || !appSettings) return;
    if (!currentFolderPath && !activeAlbumId) return;

    const currentExpanded = Array.from(expandedFolders);
    const currentExpandedAlbums = Array.from(expandedAlbumGroups);

    const prevFolderState: PersistedFolderState = appSettings.lastFolderState || {
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
      handleSettingsChange({
        ...appSettings,
        lastFolderState: {
          currentFolderPath,
          expandedFolders: currentExpanded,
          activeAlbumId,
          expandedAlbumGroups: currentExpandedAlbums,
        } as LastFolderState,
      });
    }
  }, [currentFolderPath, expandedFolders, activeAlbumId, expandedAlbumGroups, appSettings, handleSettingsChange]);

  useEffect(() => {
    if (!appSettings) return;

    const needsImageCounts = Boolean(
      appSettings.enableFolderImageCounts || appSettings.folderTreeSort?.key === 'imageCount',
    );

    if (prevImageCountsNeed.current === undefined) {
      prevImageCountsNeed.current = needsImageCounts;
      return;
    }

    if (prevImageCountsNeed.current !== needsImageCounts) {
      prevImageCountsNeed.current = needsImageCounts;

      const rootFolders = appSettings.rootFolders?.length
        ? appSettings.rootFolders
        : appSettings.lastRootPath
          ? [appSettings.lastRootPath]
          : [];
      const pinnedFolders = appSettings.pinnedFolders || [];

      const currentExpanded = Array.from(useLibraryStore.getState().expandedFolders);

      setLibrary({ isTreeLoading: true });

      const promises = [];

      if (pinnedFolders.length > 0) {
        promises.push(
          invoke<FolderTree[]>(Invokes.GetPinnedFolderTrees, {
            paths: pinnedFolders,
            expandedFolders: currentExpanded,
            showImageCounts: needsImageCounts,
          }).then((trees) => ({ type: 'pinned' as const, trees })),
        );
      }

      if (rootFolders.length > 0) {
        promises.push(
          invoke<FolderTree[]>(Invokes.GetPinnedFolderTrees, {
            paths: rootFolders,
            expandedFolders: currentExpanded,
            showImageCounts: needsImageCounts,
          }).then((trees) => ({ type: 'root' as const, trees })),
        );
      }

      Promise.all(promises)
        .then((results) => {
          useLibraryStore.getState().setLibrary((_state) => {
            const updates: {
              isTreeLoading: boolean;
              pinnedFolderTrees?: FolderTree[];
              folderTrees?: FolderTree[];
            } = { isTreeLoading: false };
            results.forEach((res) => {
              if (res.type === 'pinned') updates.pinnedFolderTrees = res.trees;
              if (res.type === 'root') updates.folderTrees = res.trees;
            });
            return updates;
          });
        })
        .catch((err) => {
          console.error('Failed to re-fetch trees for image counts:', err);
          setLibrary({ isTreeLoading: false });
        });
    }
  }, [appSettings?.enableFolderImageCounts, appSettings?.folderTreeSort?.key]);

  useEffect(() => {
    const root = document.documentElement;
    const currentThemeId = theme || DEFAULT_THEME_ID;

    const baseTheme =
      THEMES.find((t: ThemeProps) => t.id === currentThemeId) ||
      THEMES.find((t: ThemeProps) => t.id === DEFAULT_THEME_ID);
    if (!baseTheme) return;

    const finalCssVariables: Record<string, string> = { ...baseTheme.cssVariables };

    Object.entries(finalCssVariables).forEach(([key, value]) => {
      root.style.setProperty(key, value as string);
    });

    const fontFamily = appSettings?.fontFamily || 'poppins';
    const fontStack =
      fontFamily === 'system'
        ? '-apple-system, BlinkMacSystemFont, system-ui, sans-serif'
        : "'Poppins', system-ui, sans-serif";
    root.style.setProperty('--font-family', fontStack);
  }, [theme, appSettings?.fontFamily]);
};
