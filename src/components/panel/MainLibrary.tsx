import { getVersion } from '@tauri-apps/api/app';
import { open } from '@tauri-apps/plugin-shell';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  Check,
  Folder,
  FolderInput,
  GitCompareArrows,
  Home,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Search,
  Settings,
  SlidersHorizontal,
  Star,
  Users,
} from 'lucide-react';
import type React from 'react';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ThumbnailViewportUpdate } from '../../hooks/library/useThumbnails';
import { EXPORT_LAST_USED_PRESET_ID } from '../../schemas/export/exportRecipeIds';
import { buildLibrarySessionUiCard } from '../../schemas/library/librarySessionUiSchemas';
import { useLibraryStore } from '../../store/useLibraryStore';
import { thumbnailCache } from '../../thumbnails/thumbnailCacheInstance';
import { TextColors, TextVariants, TextWeights } from '../../types/typography';
import { DEFAULT_THEME_ID, THEMES, type ThemeProps } from '../../utils/themes';
import { parseVirtualImagePath } from '../../utils/virtualImagePath';
import {
  type AppSettings,
  EditedStatus,
  type ImageFile,
  type LibraryViewMode,
  type Progress,
  RawStatus,
  type Theme,
  ThumbnailAspectRatio,
  ThumbnailSize,
} from '../ui/AppProperties';
import { type ImportState, Status } from '../ui/ExportImportProperties';
import Button from '../ui/primitives/Button';
import UiText from '../ui/primitives/Text';
import { ImportCancellationButton, ImportResumeButton } from './library/ImportJobControls';
import LibraryGrid from './library/LibraryGrid';
import { SearchInput, ViewOptionsDropdown } from './library/LibraryHeader';
import LibraryHeaderStatusStrip from './library/LibraryHeaderStatusStrip';
import { LibraryRawOnlyEmptyState, shouldShowRawOnlyEmptyState } from './library/libraryEmptyState';
import { buildLibraryHeaderStatusItems } from './library/libraryHeaderStatus';

const SettingsPanel = lazy(() => import('./SettingsPanel.js').then((module) => ({ default: module.SettingsPanel })));

interface MainLibraryProps {
  activePath: string | null;
  aiModelDownloadStatus: string | null;
  appSettings: AppSettings | null;
  currentFolderPath: string | null;
  imageList: Array<ImageFile>;
  imageRatings: Record<string, number>;
  importState: ImportState;
  indexingProgress: Progress;
  isLoading: boolean;
  isIndexing: boolean;
  isAndroid: boolean;
  isTreeLoading: boolean;
  libraryViewMode: LibraryViewMode;
  multiSelectedPaths: Array<string>;
  onClearSelection: () => void;
  onContextMenu: (event: React.MouseEvent<HTMLElement>, path: string) => void;
  onContinueSession: () => void;
  onEmptyAreaContextMenu: (event: React.MouseEvent<HTMLElement>) => void;
  onGoHome: () => void;
  onImageClick: (path: string, event: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>) => void;
  onImageDoubleClick: (path: string) => void;
  onImportClick: () => void;
  onLibraryRefresh: () => void;
  onOpenFolder: () => void;
  onSettingsChange: (settings: AppSettings) => Promise<void>;
  onThumbnailAspectRatioChange: (aspectRatio: ThumbnailAspectRatio) => void;
  onThumbnailSizeChange: (size: ThumbnailSize) => void;
  onRequestThumbnails?: (paths: string[]) => void;
  onThumbnailViewportChange?: (demand: ThumbnailViewportUpdate) => void;
  rootPaths: string[];
  setLibraryViewMode: (mode: LibraryViewMode) => void;
  theme: Theme;
  thumbnailAspectRatio: ThumbnailAspectRatio;
  thumbnailProgress: Progress;
  thumbnailSize: ThumbnailSize;
  onNavigateToCommunity: () => void;
}

export interface ColumnWidths {
  thumbnail: number;
  name: number;
  date: number;
  rating: number;
  color: number;
  shutter: number;
  aperture: number;
  iso: number;
  focal: number;
}

const getPhysicalImagePath = (path: string): string => parseVirtualImagePath(path).path;

const getVirtualCopyLabel = (path: string): string => {
  const copyId = parseVirtualImagePath(path).virtualCopyId;
  return copyId ? copyId.slice(0, 6).toUpperCase() : '';
};

interface GitHubReleaseResponse {
  tag_name?: unknown;
}

export default function MainLibrary(props: MainLibraryProps) {
  const { t } = useTranslation();
  const [showSettings, setShowSettings] = useState(false);
  const [appVersion, setAppVersion] = useState('');
  const [isUpdateAvailable, setIsUpdateAvailable] = useState(false);
  const [latestVersion, setLatestVersion] = useState('');
  const [isBusyDelayed, setIsBusyDelayed] = useState(false);
  const [isProgressHovered, setIsProgressHovered] = useState(false);

  const searchCriteria = useLibraryStore((state) => state.searchCriteria);
  const filterCriteria = useLibraryStore((state) => state.filterCriteria);
  const libraryImageList = useLibraryStore((state) => state.imageList);
  const setFilterCriteria = useLibraryStore((state) => state.setFilterCriteria);
  const sortCriteria = useLibraryStore((state) => state.sortCriteria);
  const { onRequestThumbnails } = props;

  const translatedRatingFilterOptions = useMemo(
    () => [
      { value: 0, label: t('library.filters.rating.all') },
      { value: -1, label: t('library.filters.rating.unrated') },
      { value: 1, label: t('library.filters.rating.oneAndUp') },
      { value: 2, label: t('library.filters.rating.twoAndUp') },
      { value: 3, label: t('library.filters.rating.threeAndUp') },
      { value: 4, label: t('library.filters.rating.fourAndUp') },
      { value: 5, label: t('library.filters.rating.fiveOnly') },
    ],
    [t],
  );

  const translatedRawStatusOptions = useMemo(
    () => [
      { key: RawStatus.All, label: t('library.filters.raw.all') },
      { key: RawStatus.RawOnly, label: t('library.filters.raw.rawOnly') },
      { key: RawStatus.NonRawOnly, label: t('library.filters.raw.nonRawOnly') },
      { key: RawStatus.RawOverNonRaw, label: t('library.filters.raw.preferRaw') },
    ],
    [t],
  );

  const translatedEditedStatusOptions = useMemo(
    () => [
      { key: EditedStatus.All, label: t('library.filters.edited.all') },
      { key: EditedStatus.EditedOnly, label: t('library.filters.edited.editedOnly') },
      { key: EditedStatus.UneditedOnly, label: t('library.filters.edited.uneditedOnly') },
    ],
    [t],
  );

  const translatedThumbnailSizeOptions = useMemo(
    () => [
      { id: ThumbnailSize.Small, label: t('library.thumbnailSize.small'), size: 160 },
      { id: ThumbnailSize.Medium, label: t('library.thumbnailSize.medium'), size: 240 },
      { id: ThumbnailSize.Large, label: t('library.thumbnailSize.large'), size: 320 },
      { id: ThumbnailSize.List, label: t('library.thumbnailSize.list'), size: 48 },
    ],
    [t],
  );

  const translatedThumbnailAspectRatioOptions = useMemo(
    () => [
      { id: ThumbnailAspectRatio.Cover, label: t('library.thumbnailFit.fillSquare') },
      { id: ThumbnailAspectRatio.Contain, label: t('library.thumbnailFit.originalRatio') },
    ],
    [t],
  );

  const translatedSortOptions = useMemo(
    () => [
      { key: 'name', label: t('library.sort.fileName') },
      { key: 'date', label: t('library.sort.dateModified') },
      { key: 'rating', label: t('library.sort.rating') },
      { key: 'date_taken', label: t('library.sort.dateTaken') },
      { key: 'focal_length', label: t('library.sort.focalLength') },
      { key: 'iso', label: t('library.sort.iso') },
      { key: 'shutter_speed', label: t('library.sort.shutterSpeed') },
      { key: 'aperture', label: t('library.sort.aperture') },
      { key: 'edited', label: t('library.sort.editedStatus') },
    ],
    [t],
  );

  const libraryHeaderStatusItems = useMemo(
    () =>
      buildLibraryHeaderStatusItems({
        filterCriteria,
        libraryViewMode: props.libraryViewMode,
        searchCriteria,
        sortCriteria,
        t,
        translatedSortOptions,
      }),
    [filterCriteria, props.libraryViewMode, searchCriteria, sortCriteria, t, translatedSortOptions],
  );
  const isRawOnlyEmptyState = shouldShowRawOnlyEmptyState({
    filterCriteria,
    searchCriteria,
    sourceImageCount: libraryImageList.length,
    visibleImageCount: props.imageList.length,
  });

  const isBusy =
    props.isLoading ||
    (props.thumbnailProgress.total > 0 && props.thumbnailProgress.current < props.thumbnailProgress.total);
  const importProgress = props.importState.progress;
  const sessionCard = useMemo(
    () =>
      buildLibrarySessionUiCard({
        assetCount: props.imageList.length,
        exportRecipeCount:
          props.appSettings?.exportPresets?.filter((preset) => preset.id !== EXPORT_LAST_USED_PRESET_ID).length ?? 0,
        folderPath: props.currentFolderPath,
        id: 'current-library-session',
        name: props.currentFolderPath?.split('/').pop() || t('library.splash.continueSession'),
        selectedCount: props.multiSelectedPaths.length,
        stage: props.multiSelectedPaths.length > 0 ? 'cull' : 'edit',
      }),
    [
      props.appSettings?.exportPresets,
      props.currentFolderPath,
      props.imageList.length,
      props.multiSelectedPaths.length,
      t,
    ],
  );
  const selectedCompareVariants = useMemo(() => {
    const selectedImages = props.multiSelectedPaths
      .map((path) => props.imageList.find((image) => image.path === path))
      .filter((image): image is ImageFile => image !== undefined);

    if (selectedImages.length < 2) return null;

    const physicalPath = getPhysicalImagePath(selectedImages[0]?.path ?? '');
    if (
      physicalPath.length === 0 ||
      selectedImages.some((image) => getPhysicalImagePath(image.path) !== physicalPath)
    ) {
      return null;
    }

    const ordered = [...selectedImages]
      .sort((left, right) => Number(left.path.includes('?vc=')) - Number(right.path.includes('?vc=')))
      .slice(0, 2);

    if (ordered.length < 2) return null;

    return ordered.map((image, index) => ({
      slot: index === 0 ? 'A' : 'B',
      image,
      label: image.is_virtual_copy
        ? t('library.header.compare.virtualCopy', { id: getVirtualCopyLabel(image.path) })
        : t('library.header.compare.original'),
      thumbnail: thumbnailCache.get(image.path)?.url ?? null,
    }));
  }, [props.imageList, props.multiSelectedPaths, t]);

  useEffect(() => {
    if (!selectedCompareVariants) return;
    onRequestThumbnails?.(selectedCompareVariants.map(({ image }) => image.path));
  }, [onRequestThumbnails, selectedCompareVariants]);

  useEffect(() => {
    let timer: number | undefined;

    if (isBusy) {
      timer = window.setTimeout(() => {
        setIsBusyDelayed(true);
      }, 1000);
    } else {
      timer = window.setTimeout(() => {
        setIsBusyDelayed(false);
      }, 500);
    }

    return () => {
      clearTimeout(timer);
    };
  }, [isBusy]);

  useEffect(() => {
    const compareVersions = (v1: string, v2: string) => {
      const parts1 = v1.split('.').map(Number);
      const parts2 = v2.split('.').map(Number);
      const len = Math.max(parts1.length, parts2.length);
      for (let i = 0; i < len; i++) {
        const p1 = parts1[i] || 0;
        const p2 = parts2[i] || 0;
        if (p1 < p2) return -1;
        if (p1 > p2) return 1;
      }
      return 0;
    };

    const checkVersion = async () => {
      try {
        const currentVersion = await getVersion();
        setAppVersion(currentVersion);

        const response = await fetch('https://api.github.com/repos/CyberTimon/RapidRAW/releases/latest');
        if (!response.ok) {
          console.error('Failed to fetch latest release info from GitHub.');
          return;
        }
        const data = (await response.json()) as GitHubReleaseResponse;
        const latestTag = typeof data.tag_name === 'string' ? data.tag_name : null;
        if (latestTag === null) return;

        const latestVersionStr = latestTag.startsWith('v') ? latestTag.substring(1) : latestTag;
        setLatestVersion(latestVersionStr);

        if (compareVersions(currentVersion, latestVersionStr) < 0) {
          setIsUpdateAvailable(true);
        }
      } catch (error) {
        console.error('Error checking for updates:', error);
      }
    };

    void checkVersion();
  }, []);

  if (props.rootPaths.length === 0) {
    if (!props.appSettings) {
      return null;
    }
    const hasLastPath = !!props.appSettings.lastRootPath || !!props.appSettings.rootFolders?.length;
    const currentThemeId = props.theme;
    const selectedTheme: ThemeProps | undefined =
      THEMES.find((t: ThemeProps) => t.id === currentThemeId) ||
      THEMES.find((t: ThemeProps) => t.id === DEFAULT_THEME_ID);
    const splashImage = selectedTheme?.splashImage;

    return (
      <div className="flex-1 flex h-full p-2 bg-transparent">
        <div className="flex w-full h-full bg-bg-secondary rounded-lg border border-border-color/25 overflow-hidden">
          <div className="w-1/2 hidden md:block relative overflow-hidden bg-black">
            <AnimatePresence>
              <motion.img
                alt={t('library.splash.backgroundAlt')}
                className="absolute inset-0 w-full h-full object-cover"
                key={splashImage}
                src={splashImage}
              />
            </AnimatePresence>
          </div>

          <div className="w-full md:w-1/2 relative overflow-hidden isolate">
            <div className="absolute inset-0 -z-10 pointer-events-none">
              <AnimatePresence>
                {splashImage && (
                  <motion.img
                    key={`${splashImage}-ambient`}
                    src={splashImage}
                    className="absolute inset-0 w-full h-full object-cover blur-2xl opacity-50 pointer-events-none"
                    aria-hidden="true"
                  />
                )}
              </AnimatePresence>
              <div className="absolute inset-0 bg-bg-secondary/90"></div>
            </div>

            <div className="w-full h-full flex flex-col p-8 lg:p-16 overflow-y-auto custom-scrollbar relative z-10">
              {showSettings ? (
                <Suspense fallback={<div className="min-h-0 flex-1" aria-busy="true" />}>
                  <SettingsPanel
                    appSettings={props.appSettings}
                    onBack={() => {
                      setShowSettings(false);
                    }}
                    onLibraryRefresh={props.onLibraryRefresh}
                    onSettingsChange={props.onSettingsChange}
                    rootPaths={props.rootPaths}
                  />
                </Suspense>
              ) : (
                <>
                  <div className="my-auto text-left relative z-10">
                    <UiText variant={TextVariants.displayLarge}>{t('library.splash.brand')}</UiText>
                    <UiText
                      variant={TextVariants.heading}
                      color={TextColors.secondary}
                      weight={TextWeights.normal}
                      className="mb-10 max-w-md drop-shadow-sm"
                    >
                      {hasLastPath ? (
                        <>
                          {t('library.splash.welcomeBack')}
                          <br />
                          {t('library.splash.welcomeBackDesc')}
                        </>
                      ) : props.isAndroid ? (
                        t('library.splash.descriptionAndroid')
                      ) : (
                        t('library.splash.descriptionDesktop')
                      )}
                    </UiText>
                    <div className="flex flex-col w-full max-w-xs gap-4 relative z-10">
                      {hasLastPath && (
                        <Button
                          className="rounded-md h-11 w-full flex justify-center items-center shadow-md"
                          onClick={props.onContinueSession}
                          size="lg"
                        >
                          <RefreshCw size={20} className="mr-2" /> {t('library.splash.continueSession')}
                        </Button>
                      )}
                      <div className="flex items-center gap-2">
                        <Button
                          className={`rounded-md grow flex justify-center items-center shadow-md h-11 ${
                            hasLastPath ? 'bg-surface text-text-primary' : ''
                          }`}
                          onClick={props.onOpenFolder}
                          size="lg"
                        >
                          <Folder size={20} className="mr-2" />
                          {props.isAndroid
                            ? t('library.splash.openLibrary')
                            : hasLastPath
                              ? t('library.splash.addFolder')
                              : t('library.splash.openFolder')}
                        </Button>
                        <Button
                          aria-label={t('settings.title')}
                          className="px-3 bg-surface text-text-primary shadow-md h-11"
                          onClick={() => {
                            setShowSettings(true);
                          }}
                          size="lg"
                          data-tooltip={t('settings.general.title')}
                          variant="ghost"
                        >
                          <Settings size={20} />
                        </Button>
                      </div>
                    </div>
                  </div>

                  <UiText
                    variant={TextVariants.small}
                    as="div"
                    className="absolute bottom-8 left-8 lg:left-16 space-y-1 z-10 drop-shadow-sm"
                  >
                    <p>
                      {t('library.splash.imagesBy')}{' '}
                      <a
                        href="https://instagram.com/timonkaech.photography"
                        className="hover:underline"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {t('library.splash.photographerName')}
                      </a>
                    </p>
                    {appVersion && (
                      <div className="flex items-center space-x-2">
                        <p>
                          <button
                            type="button"
                            className={`group transition-all duration-300 ease-in-out rounded-md py-1 bg-transparent border-0 font-inherit text-inherit ${
                              isUpdateAvailable
                                ? 'cursor-pointer border border-yellow-500 px-2 hover:bg-yellow-500/20'
                                : ''
                            }`}
                            onClick={() => {
                              if (isUpdateAvailable) {
                                void open('https://github.com/CyberTimon/RapidRAW/releases/latest');
                              }
                            }}
                            data-tooltip={
                              isUpdateAvailable
                                ? t('library.splash.downloadVersion', { version: latestVersion })
                                : t('library.splash.latestVersion')
                            }
                          >
                            <span className={isUpdateAvailable ? 'group-hover:hidden' : ''}>
                              {t('library.splash.version', { version: appVersion })}
                            </span>
                            {isUpdateAvailable && (
                              <span className="hidden group-hover:inline text-yellow-400">
                                {t('library.splash.newVersionAvailable')}
                              </span>
                            )}
                          </button>
                        </p>
                        <span>-</span>
                        <p>
                          <a
                            href="https://ko-fi.com/cybertimon"
                            className="hover:underline"
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {t('library.splash.donate')}
                          </a>
                          <span className="mx-1">{t('library.splash.or')}</span>
                          <a
                            href="https://github.com/CyberTimon/RapidRAW"
                            className="hover:underline"
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {t('library.splash.contribute')}
                          </a>
                        </p>
                      </div>
                    )}
                  </UiText>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full min-w-0 bg-bg-secondary rounded-lg overflow-hidden">
      <header
        className="p-4 shrink-0 flex justify-between items-center border-b border-surface gap-4"
        onMouseEnter={() => {
          setIsProgressHovered(true);
        }}
        onMouseLeave={() => {
          setIsProgressHovered(false);
        }}
      >
        <div className="min-w-0">
          <UiText variant={TextVariants.headline}>{t('library.header.title')}</UiText>
          {!props.isAndroid && (
            <div className="flex items-center gap-2">
              {props.currentFolderPath ? (
                <UiText className="truncate">{props.currentFolderPath}</UiText>
              ) : (
                <p className="text-sm invisible select-none pointer-events-none h-5 overflow-hidden"></p>
              )}
              <div
                className={`flex items-center gap-2 overflow-hidden transition-all duration-300 whitespace-nowrap ${
                  isBusyDelayed ? 'max-w-xs opacity-100' : 'max-w-0 opacity-0'
                }`}
              >
                <Loader2 size={14} className="animate-spin text-text-secondary shrink-0" />
                <div
                  className={`flex items-center transition-all duration-300 ease-out overflow-hidden ${
                    isProgressHovered && isBusyDelayed && props.thumbnailProgress.total > 0
                      ? 'max-w-xs opacity-100'
                      : 'max-w-0 opacity-0'
                  }`}
                >
                  <UiText variant={TextVariants.small} color={TextColors.secondary} className="whitespace-nowrap">
                    ({props.thumbnailProgress.current}/{props.thumbnailProgress.total})
                  </UiText>
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {props.importState.status === Status.Importing && (
            <div className="flex items-center gap-2">
              <UiText as="div" color={TextColors.accent} className="flex items-center gap-2" aria-live="polite">
                <FolderInput size={16} className="animate-pulse" />
                <span>
                  {t('library.import.progress', {
                    current: props.importState.progress?.current,
                    total: props.importState.progress?.total,
                  })}
                  {props.importState.stage ? ` · ${props.importState.stage}` : ''}
                </span>
              </UiText>
              <ImportCancellationButton />
            </div>
          )}
          {props.importState.status === Status.Success && (
            <UiText as="div" color={TextColors.success} className="flex items-center gap-2">
              <Check size={16} />
              <span>{t('library.import.complete')}</span>
            </UiText>
          )}
          {props.importState.status === Status.Error && (
            <UiText as="div" color={TextColors.error} className="flex items-center gap-2">
              <AlertTriangle size={16} />
              <span>{t('library.import.failed')}</span>
            </UiText>
          )}
          {(props.importState.status === Status.Cancelled || props.importState.status === Status.Error) &&
            props.importState.jobId && <ImportResumeButton importState={props.importState} />}
          <SearchInput indexingProgress={props.indexingProgress} isIndexing={props.isIndexing} />
          <ViewOptionsDropdown
            libraryViewMode={props.libraryViewMode}
            onSelectSize={props.onThumbnailSizeChange}
            onSelectAspectRatio={props.onThumbnailAspectRatioChange}
            setLibraryViewMode={props.setLibraryViewMode}
            thumbnailSize={props.thumbnailSize}
            thumbnailAspectRatio={props.thumbnailAspectRatio}
            thumbnailSizeOptions={translatedThumbnailSizeOptions}
            thumbnailAspectRatioOptions={translatedThumbnailAspectRatioOptions}
            ratingFilterOptions={translatedRatingFilterOptions}
            rawStatusOptions={translatedRawStatusOptions}
            editedStatusOptions={translatedEditedStatusOptions}
            sortOptions={translatedSortOptions}
          />
          {!props.isAndroid && (
            <Button
              className="h-12 w-12 bg-surface text-text-primary shadow-none p-0 flex items-center justify-center"
              onClick={props.onNavigateToCommunity}
              data-tooltip={t('library.tooltips.communityPresets')}
            >
              <Users className="w-8 h-8" />
            </Button>
          )}
          <Button
            className="h-12 w-12 bg-surface text-text-primary shadow-none p-0 flex items-center justify-center"
            onClick={props.onGoHome}
            data-tooltip={t('library.tooltips.goHome')}
          >
            <Home className="w-8 h-8" />
          </Button>
        </div>
      </header>

      <section className="border-b border-surface bg-bg-primary/45 px-4 py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="flex min-w-0 items-center gap-2 rounded-md border border-surface bg-bg-secondary px-3 py-2">
            <Star className="h-4 w-4 shrink-0 text-accent" />
            <div className="min-w-0">
              <UiText as="div" variant={TextVariants.label} className="truncate">
                {sessionCard.name}
              </UiText>
              <UiText as="div" variant={TextVariants.small} color={TextColors.secondary} className="truncate">
                {sessionCard.folderLabel}
              </UiText>
            </div>
          </div>
          {[sessionCard.assetLabel, sessionCard.selectedLabel, sessionCard.recipeLabel].map((label) => (
            <UiText
              as="span"
              key={label}
              variant={TextVariants.small}
              color={TextColors.secondary}
              className="rounded bg-surface px-2 py-1"
            >
              {label}
            </UiText>
          ))}
          <LibraryHeaderStatusStrip items={libraryHeaderStatusItems} />
          {selectedCompareVariants && (
            <div
              className="flex min-w-0 flex-wrap items-center gap-2 border-l border-surface pl-2"
              data-testid="library-virtual-copy-compare-strip"
              data-compare-source-path={getPhysicalImagePath(selectedCompareVariants[0]?.image.path ?? '')}
              data-compare-variant-count={selectedCompareVariants.length}
            >
              <div className="flex items-center gap-1 rounded border border-accent/35 bg-accent/10 px-2 py-1">
                <GitCompareArrows className="h-3.5 w-3.5 text-accent" />
                <UiText as="span" variant={TextVariants.small} color={TextColors.primary} weight={TextWeights.medium}>
                  {t('library.header.compare.title')}
                </UiText>
              </div>
              {selectedCompareVariants.map(({ slot, image, label, thumbnail }) => (
                <button
                  key={image.path}
                  type="button"
                  className={`grid min-w-40 grid-cols-[44px_minmax(0,1fr)] items-center gap-2 rounded border p-1.5 text-left transition-colors ${
                    props.activePath === image.path
                      ? 'border-accent bg-accent/15'
                      : 'border-surface bg-bg-secondary hover:bg-surface'
                  }`}
                  data-testid={`library-virtual-copy-compare-slot-${slot}`}
                  data-compare-slot={slot}
                  data-compare-path={image.path}
                  data-compare-active={props.activePath === image.path}
                  data-compare-has-thumbnail={thumbnail !== null}
                  onClick={(event) => {
                    props.onImageClick(image.path, event);
                  }}
                >
                  <span className="flex h-10 w-11 items-center justify-center overflow-hidden rounded-sm bg-bg-primary">
                    {thumbnail ? (
                      <img alt="" className="h-full w-full object-cover" src={thumbnail} />
                    ) : (
                      <ImageIcon className="h-4 w-4 text-text-secondary" />
                    )}
                  </span>
                  <span className="min-w-0">
                    <UiText as="span" variant={TextVariants.small} color={TextColors.secondary}>
                      {slot}
                    </UiText>
                    <UiText as="span" variant={TextVariants.small} className="ml-1 truncate">
                      {label}
                    </UiText>
                  </span>
                </button>
              ))}
              <UiText as="span" variant={TextVariants.small} color={TextColors.secondary} className="truncate">
                {t('library.header.compare.ready')}
              </UiText>
            </div>
          )}
        </div>
      </section>

      {props.imageList.length > 0 ? (
        <LibraryGrid {...props} thumbnailSizeOptions={translatedThumbnailSizeOptions} />
      ) : props.isIndexing || props.aiModelDownloadStatus || props.importState.status === Status.Importing ? (
        <div className="flex-1 flex flex-col items-center justify-center" onContextMenu={props.onEmptyAreaContextMenu}>
          <Loader2 className="h-12 w-12 text-secondary animate-spin mb-4" />
          <UiText variant={TextVariants.heading} color={TextColors.secondary}>
            {props.aiModelDownloadStatus
              ? t('library.status.downloading', { status: props.aiModelDownloadStatus })
              : props.isIndexing && props.indexingProgress.total > 0
                ? t('library.status.indexing', {
                    current: props.indexingProgress.current,
                    total: props.indexingProgress.total,
                  })
                : props.importState.status === Status.Importing && importProgress && importProgress.total > 0
                  ? t('library.status.importing', {
                      current: importProgress.current,
                      total: importProgress.total,
                    })
                  : t('library.status.processing')}
          </UiText>
          <UiText className="mt-2">{t('library.status.moment')}</UiText>
        </div>
      ) : isRawOnlyEmptyState ? (
        <div className="flex-1 flex flex-col items-center justify-center" onContextMenu={props.onEmptyAreaContextMenu}>
          <LibraryRawOnlyEmptyState
            onResetRawFilter={() => {
              setFilterCriteria((prev) => ({ ...prev, rawStatus: RawStatus.All }));
            }}
          />
        </div>
      ) : searchCriteria.tags.length > 0 || searchCriteria.text ? (
        <div
          className="flex-1 flex flex-col items-center justify-center text-text-secondary text-center"
          onContextMenu={props.onEmptyAreaContextMenu}
        >
          <Search className="h-12 w-12 text-secondary mb-4" />
          <UiText variant={TextVariants.heading} color={TextColors.secondary}>
            {t('library.search.noResults')}
          </UiText>
          <UiText className="mt-2 max-w-sm">
            {t('library.search.noResultsDesc')}
            {!props.appSettings?.enableAiTagging && t('library.search.noResultsAiHint')}
          </UiText>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center" onContextMenu={props.onEmptyAreaContextMenu}>
          <SlidersHorizontal className="h-12 w-12 mb-4 text-text-secondary" />
          <UiText>{t('library.filters.noMatch')}</UiText>
        </div>
      )}
      {props.isAndroid && (
        <Button
          className="absolute bottom-18 right-8 h-12 w-12 bg-accent text-button-text shadow-lg p-0 flex items-center justify-center z-50 border border-border-color/50"
          onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
            e.stopPropagation();
            props.onImportClick();
          }}
          data-tooltip={t('library.tooltips.importImages')}
        >
          <FolderInput className="w-6 h-6" />
        </Button>
      )}
    </div>
  );
}
