import cx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  Bookmark,
  BookmarkPlus,
  Check,
  Columns2,
  Eye,
  EyeOff,
  Film,
  Loader2,
  Maximize,
  Minimize2,
  Palette,
  Pencil,
  Redo,
  SquareSplitHorizontal,
  Undo,
  X,
} from 'lucide-react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type EditorCompareMode, useEditorStore } from '../../../store/useEditorStore';
import { useSettingsStore } from '../../../store/useSettingsStore';
import { useUIStore } from '../../../store/useUIStore';
import { TextColors, TextVariants, TextWeights } from '../../../types/typography';
import type { Adjustments } from '../../../utils/adjustments';
import { buildEditHistoryItems, type EditHistoryCheckpoint } from '../../../utils/editHistory';
import { formatShortcutLabel } from '../../../utils/keyboardUtils';
import {
  formatExifApertureFromMetadata,
  formatExifFocalLengthFromMetadata,
} from '../../../utils/metadataPanelContracts';
import { parseVirtualImagePath } from '../../../utils/virtualImagePath';
import type { SelectedImage } from '../../ui/AppProperties';
import { editorChromeStatusChipClassName, editorChromeTokens } from '../../ui/editorChromeTokens';
import Dropdown from '../../ui/primitives/Dropdown';
import UiText from '../../ui/primitives/Text';
import { IconAperture, IconCalendar, IconClock, IconFocalLength, IconIso, IconShutter } from './ExifIcons';

interface EditorToolbarProps {
  canRedo: boolean;
  canUndo: boolean;
  isAndroid: boolean;
  isFullScreen?: boolean;
  isLoading: boolean;
  negativeLabDisabledReason?: string | null;
  onBackToLibrary: () => void;
  onOpenNegativeLab: () => void;
  onRedo: () => void;
  onCompareModeChange?: (mode: EditorCompareMode) => void;
  onShowOriginalChange?: (showOriginal: boolean) => void;
  onToggleFullScreen: () => void;
  onToggleShowOriginal: () => void;
  onUndo: () => void;
  selectedImage: SelectedImage;
  compareMode?: EditorCompareMode;
  showOriginal: boolean;
  showDateView: boolean;
  onToggleDateView: () => void;
  adjustmentsHistory: Array<Adjustments>;
  adjustmentsHistoryCheckpoints?: Array<EditHistoryCheckpoint>;
  adjustmentsHistoryIndex: number;
  onCreateAdjustmentsHistoryCheckpoint?: (label: string) => void;
  goToAdjustmentsHistoryIndex: (index: number) => void;
  onRenameAdjustmentsHistoryCheckpoint?: (checkpointId: string, label: string) => void;
  osPlatform?: string;
}

const EditorToolbar = memo(
  ({
    canRedo,
    canUndo,
    isAndroid,
    isFullScreen: isFullScreenProp,
    isLoading,
    negativeLabDisabledReason = null,
    onBackToLibrary,
    onOpenNegativeLab,
    onRedo,
    onCompareModeChange = () => undefined,
    onShowOriginalChange = () => undefined,
    onToggleFullScreen,
    onToggleShowOriginal,
    onUndo,
    selectedImage,
    compareMode = 'off',
    showOriginal,
    showDateView,
    onToggleDateView,
    adjustmentsHistory,
    adjustmentsHistoryCheckpoints = [],
    adjustmentsHistoryIndex,
    onCreateAdjustmentsHistoryCheckpoint = () => undefined,
    goToAdjustmentsHistoryIndex,
    onRenameAdjustmentsHistoryCheckpoint = () => undefined,
    osPlatform,
  }: EditorToolbarProps) => {
    const { t } = useTranslation();
    const isAnyLoading = isLoading;
    const [isLoaderVisible, setIsLoaderVisible] = useState(false);
    const [disableLoaderTransition, setDisableLoaderTransition] = useState(false);
    const hideTimeoutRef = useRef<number | null>(null);
    const prevIsLoadingRef = useRef(isLoading);
    const [isVcHovered, setIsVcHovered] = useState(false);
    const [isInfoHovered, setIsInfoHovered] = useState(false);
    const [isHistoryVisible, setIsHistoryVisible] = useState(false);
    const [editingCheckpointId, setEditingCheckpointId] = useState<string | null>(null);
    const [editingCheckpointLabel, setEditingCheckpointLabel] = useState('');
    const historyContainerRef = useRef<HTMLDivElement>(null);
    const historyButtonRef = useRef<HTMLDivElement>(null);
    const appSettings = useSettingsStore((state) => state.appSettings);
    const osPlatformFromStore = useSettingsStore((state) => state.osPlatform);
    const isExportSoftProofEnabled = useEditorStore((state) => state.isExportSoftProofEnabled);
    const exportSoftProofRecipeId = useEditorStore((state) => state.exportSoftProofRecipeId);
    const exportSoftProofTransform = useEditorStore((state) => state.exportSoftProofTransform);
    const isFullScreenFromStore = useUIStore((state) => state.isFullScreen);
    const isFullScreen = isFullScreenProp ?? isFullScreenFromStore;
    const setEditor = useEditorStore((state) => state.setEditor);
    const exportProofRecipeOptions = useMemo(
      () =>
        (appSettings?.exportPresets ?? [])
          .filter((preset) => preset.fileFormat !== 'cube')
          .map((preset) => ({ label: preset.name, value: preset.id })),
      [appSettings?.exportPresets],
    );
    const selectedExportProofRecipeId = exportSoftProofRecipeId ?? exportProofRecipeOptions[0]?.value ?? null;
    const selectedExportProofRecipe = useMemo(
      () => (appSettings?.exportPresets ?? []).find((preset) => preset.id === selectedExportProofRecipeId),
      [appSettings?.exportPresets, selectedExportProofRecipeId],
    );
    const canSoftProof = exportProofRecipeOptions.length > 0;
    const selectedExportProofProfile = selectedExportProofRecipe?.colorProfile ?? 'srgb';
    const selectedExportProofIntent = selectedExportProofRecipe?.renderingIntent ?? 'relativeColorimetric';
    const selectedExportProofName = selectedExportProofRecipe?.name ?? '';
    const exportSoftProofSummary = selectedExportProofRecipe
      ? t('editor.toolbar.exportSoftProofDetails', {
          profile: selectedExportProofProfile,
          intent: selectedExportProofIntent,
        })
      : t('editor.toolbar.exportSoftProofUnavailable');
    const fullscreenTooltip = isFullScreen
      ? t('editor.toolbar.tooltips.exitPreview')
      : t('editor.toolbar.tooltips.fullscreen');
    const negativeLabLabel = t('contextMenus.editor.convertNegative');
    const negativeLabTooltip = negativeLabDisabledReason ?? negativeLabLabel;
    const compareNeedsOriginal = compareMode !== 'off';
    const compareUnavailableReason = t('editor.toolbar.compare.unavailable');
    const holdOriginalButtonHandledRef = useRef(false);

    const showResolution = !isAndroid && selectedImage.width > 0 && selectedImage.height > 0;
    const [displayedResolution, setDisplayedResolution] = useState('');

    const { baseName, fileTypeLabel, isVirtualCopy, vcId, exifData, hasExif } = useMemo(() => {
      const path = selectedImage.path;
      const { path: imagePath, virtualCopyId } = parseVirtualImagePath(path);
      const fullFileName = imagePath.split(/[\\/]/).pop() || '';
      const extensionMatch = /\.([a-z0-9]+)$/i.exec(fullFileName);
      const fileType = extensionMatch?.[1]?.toUpperCase() ?? 'FILE';

      const exif = selectedImage.exif || {};

      let captureDate = null;
      let captureTime = null;

      if (exif.DateTimeOriginal) {
        const dateTimeParts = exif.DateTimeOriginal.split(' ');
        captureDate = dateTimeParts[0]?.replace(/:/g, '-') || null;
        if (dateTimeParts[1]) {
          const timeParts = dateTimeParts[1].split(':');
          const hours = timeParts[0] ?? '00';
          const minutes = timeParts[1] ?? '00';
          captureTime = `${hours}:${minutes}`;
        }
      }

      const data = {
        iso: exif.PhotographicSensitivity || exif.ISO,
        fNumber: formatExifApertureFromMetadata(exif),
        shutter: exif.ExposureTime,
        focal: formatExifFocalLengthFromMetadata(exif),
        captureDate: captureDate,
        captureTime: captureTime,
      };

      const hasData = !!(data.iso || data.fNumber || data.shutter || data.focal || data.captureDate);

      return {
        baseName: fullFileName,
        fileTypeLabel: fileType,
        isVirtualCopy: virtualCopyId !== null,
        vcId: virtualCopyId,
        exifData: data,
        hasExif: hasData,
      };
    }, [selectedImage.path, selectedImage.exif]);

    useEffect(() => {
      if (showResolution) {
        setDisplayedResolution(` - ${selectedImage.width} × ${selectedImage.height}`);
      }
    }, [showResolution, selectedImage.width, selectedImage.height]);

    useEffect(() => {
      if (exportProofRecipeOptions.length === 0) {
        if (isExportSoftProofEnabled || exportSoftProofRecipeId !== null) {
          setEditor({ isExportSoftProofEnabled: false, exportSoftProofRecipeId: null });
        }
        return;
      }

      if (
        selectedExportProofRecipeId !== null &&
        !exportProofRecipeOptions.some((option) => option.value === selectedExportProofRecipeId)
      ) {
        setEditor({ exportSoftProofRecipeId: exportProofRecipeOptions[0]?.value ?? null });
      }
    }, [
      exportProofRecipeOptions,
      exportSoftProofRecipeId,
      isExportSoftProofEnabled,
      selectedExportProofRecipeId,
      setEditor,
    ]);

    useEffect(() => {
      const wasLoadingResolution = prevIsLoadingRef.current && !isLoading;

      if (isAnyLoading) {
        if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
        setDisableLoaderTransition(false);
        setIsLoaderVisible(true);
      } else if (isLoaderVisible) {
        if (wasLoadingResolution) {
          setDisableLoaderTransition(true);
          setIsLoaderVisible(false);
        } else {
          setDisableLoaderTransition(false);
          hideTimeoutRef.current = window.setTimeout(() => {
            setIsLoaderVisible(false);
          }, 300);
        }
      }

      prevIsLoadingRef.current = isLoading;

      return () => {
        if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
      };
    }, [isAnyLoading, isLoading, isLoaderVisible]);

    useEffect(() => {
      if (!isHistoryVisible) return;
      const handleClickOutside = (e: MouseEvent) => {
        if (
          historyContainerRef.current &&
          !historyContainerRef.current.contains(e.target as Node) &&
          historyButtonRef.current &&
          !historyButtonRef.current.contains(e.target as Node)
        ) {
          setIsHistoryVisible(false);
        }
      };
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }, [isHistoryVisible]);

    const historyItems = useMemo(
      () => buildEditHistoryItems(adjustmentsHistory, adjustmentsHistoryCheckpoints),
      [adjustmentsHistory, adjustmentsHistoryCheckpoints],
    );

    useEffect(() => {
      if (isHistoryVisible && historyContainerRef.current) {
        const timer = setTimeout(() => {
          const activeEl = historyContainerRef.current?.querySelector('[data-active="true"]');
          if (activeEl) {
            activeEl.scrollIntoView({ block: 'nearest', behavior: 'auto' });
          }
        }, 10);
        return () => {
          clearTimeout(timer);
        };
      }
      return undefined;
    }, [isHistoryVisible, adjustmentsHistoryIndex]);

    const handleButtonKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === 'Escape') {
        setIsHistoryVisible(false);
        e.currentTarget.blur();
        return;
      }
      if (e.key === 'Tab') return;
      e.currentTarget.blur();
    };

    const isExpanded = isInfoHovered && (hasExif || isLoading);
    const historyDepthTotal = Math.max(adjustmentsHistory.length, 1);
    const historyDepthLabel = t('editor.toolbar.historyDepth', {
      current: Math.min(adjustmentsHistoryIndex + 1, historyDepthTotal),
      total: historyDepthTotal,
    });
    const activeHistoryItem = historyItems[adjustmentsHistoryIndex] ?? null;
    const activeCheckpoint = activeHistoryItem?.checkpoint ?? null;
    const canCreateCheckpoint = adjustmentsHistory.length > 0;
    const effectiveOsPlatform = osPlatform ?? osPlatformFromStore;
    const undoShortcutLabel = formatShortcutLabel(['ctrl', 'KeyZ'], effectiveOsPlatform);
    const redoShortcutLabel = formatShortcutLabel(['ctrl', 'KeyY'], effectiveOsPlatform);
    const token = editorChromeTokens;
    const commandGroupClass =
      'flex h-9 items-center gap-1 rounded-md border border-editor-border bg-editor-panel-well p-0.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]';
    const commandDividerClass = 'mx-0.5 h-5 w-px bg-editor-border';
    const iconButtonClass = `${token.button.base} ${token.button.icon} ${token.button.quiet} ${token.button.disabled} ${token.focusRing}`;
    const activeIconButtonClass = `${token.button.base} ${token.button.icon} ${token.button.selectedQuiet} ${token.focusRing}`;
    const statusPillClass =
      'border border-editor-border bg-editor-panel-raised text-text-primary shadow-[0_8px_22px_var(--editor-overlay-shadow)]';
    const commitCheckpointRename = (checkpointId: string) => {
      onRenameAdjustmentsHistoryCheckpoint(checkpointId, editingCheckpointLabel);
      setEditingCheckpointId(null);
      setEditingCheckpointLabel('');
    };

    return (
      <div
        className="relative z-40 flex h-11 shrink-0 items-center justify-between gap-3 px-3"
        data-toolbar-history={isHistoryVisible ? 'open' : 'closed'}
        data-toolbar-loading={isLoaderVisible ? 'true' : 'false'}
        data-toolbar-negative-lab={negativeLabDisabledReason ? 'disabled' : 'available'}
        data-toolbar-compare-mode={compareMode}
        data-toolbar-original={showOriginal ? 'original' : 'edited'}
        data-toolbar-soft-proof={isExportSoftProofEnabled ? 'active' : canSoftProof ? 'available' : 'unavailable'}
        data-toolbar-fullscreen={isFullScreen ? 'active' : 'inactive'}
      >
        <div className="z-40 flex shrink-0 items-center gap-1.5">
          <div className={commandGroupClass} data-testid="editor-toolbar-back-group">
            <button
              aria-label={t('editor.toolbar.tooltips.backToLibrary')}
              className={`${iconButtonClass} shrink-0`}
              onClick={onBackToLibrary}
              onKeyDown={handleButtonKeyDown}
              data-tooltip={t('editor.toolbar.tooltips.backToLibrary')}
              type="button"
            >
              <ArrowLeft size={16} />
            </button>
          </div>

          <div className="hidden items-center gap-1.5 2xl:flex" aria-hidden="true">
            <div className="invisible flex h-8 w-8 items-center justify-center pointer-events-none">
              <Undo size={16} />
            </div>
            <div className="invisible flex h-8 w-8 items-center justify-center pointer-events-none">
              <Undo size={16} />
            </div>
            <div className="invisible flex h-8 w-8 items-center justify-center pointer-events-none">
              <Undo size={16} />
            </div>
            <div className="invisible flex h-8 w-8 items-center justify-center pointer-events-none">
              <Undo size={16} />
            </div>
          </div>
        </div>

        <div className="relative flex h-full min-w-0 flex-1 justify-center">
          <div
            className={cx(
              'flex flex-col items-center overflow-hidden pt-1.5 transition-all duration-200 ease-out',
              statusPillClass,
              isExpanded
                ? 'absolute h-16 min-w-[320px] whitespace-nowrap rounded-lg px-6'
                : 'absolute h-8 min-w-0 w-auto max-w-full rounded-md px-3 shadow-none',
            )}
            aria-busy={isLoaderVisible}
            data-editor-status-expanded={String(isExpanded)}
            data-testid="editor-toolbar-file-status"
            onMouseEnter={() => {
              setIsInfoHovered(true);
            }}
            onMouseLeave={() => {
              setIsInfoHovered(false);
            }}
            style={{
              top: '6px',
              transform: 'translateX(-50%)',
              left: '50%',
              zIndex: isExpanded ? 50 : 0,
            }}
          >
            <div className="flex items-center justify-center max-w-full h-5 shrink-0">
              <UiText
                as="span"
                variant={TextVariants.small}
                color={TextColors.primary}
                weight={TextWeights.medium}
                className="truncate min-w-0 shrink"
              >
                {baseName}
              </UiText>

              <UiText
                as="span"
                className={cx('ml-2 shrink-0', editorChromeStatusChipClassName('neutral'))}
                color={TextColors.secondary}
                data-testid="editor-file-type-badge"
                data-tooltip={t('editor.toolbar.tooltips.fileType')}
                variant={TextVariants.small}
                weight={TextWeights.medium}
              >
                {fileTypeLabel}
              </UiText>

              {isVirtualCopy && (
                <UiText
                  as="div"
                  variant={TextVariants.small}
                  color={TextColors.accent}
                  weight={TextWeights.bold}
                  className="ml-2 flex shrink-0 cursor-default items-center overflow-hidden rounded bg-editor-info-surface px-1.5 py-0.5 text-editor-info"
                  onMouseEnter={() => {
                    setIsVcHovered(true);
                  }}
                  onMouseLeave={() => {
                    setIsVcHovered(false);
                  }}
                >
                  <span>{t('editor.toolbar.vc')}</span>
                  <div
                    className={cx(
                      'transition-all duration-300 ease-out overflow-hidden whitespace-nowrap',
                      isVcHovered ? 'max-w-20 opacity-100' : 'max-w-0 opacity-0',
                    )}
                  >
                    <span>-{vcId}</span>
                  </div>
                </UiText>
              )}

              <div
                className={cx(
                  'transition-all duration-300 ease-out overflow-hidden whitespace-nowrap shrink-0',
                  showResolution ? 'max-w-40 opacity-100 ml-2' : 'max-w-0 opacity-0 ml-0',
                )}
              >
                <UiText
                  as="span"
                  variant={TextVariants.small}
                  className={cx(
                    'block transition-transform duration-200 delay-100',
                    showResolution ? 'scale-100' : 'scale-95',
                  )}
                >
                  {displayedResolution}
                </UiText>
              </div>

              <div
                className={cx(
                  'overflow-hidden shrink-0',
                  isLoaderVisible ? 'max-w-4 opacity-100 ml-2' : 'max-w-0 opacity-0 ml-0',
                  disableLoaderTransition ? 'transition-none' : 'transition-all duration-300',
                )}
              >
                <Loader2 size={12} className="text-text-secondary animate-spin" />
              </div>
            </div>

            <button
              type="button"
              aria-expanded={showDateView}
              className={cx(
                'relative mt-1.5 w-full grow justify-center border-t border-editor-border bg-transparent p-0 pt-1.5 text-left transition-opacity duration-200',
                isExpanded ? 'opacity-100 delay-75' : 'opacity-0 hidden',
                hasExif && 'cursor-pointer',
              )}
              disabled={!hasExif}
              onClick={() => {
                if (hasExif) {
                  onToggleDateView();
                }
              }}
            >
              <div
                className={cx(
                  'absolute inset-0 flex items-center justify-center gap-5 transition-opacity duration-200',
                  showDateView ? 'opacity-0 pointer-events-none' : 'opacity-100',
                )}
              >
                {exifData.shutter && (
                  <div className="flex items-center gap-1.5" data-tooltip={t('editor.toolbar.tooltips.shutterSpeed')}>
                    <UiText as="span">
                      <IconShutter />
                    </UiText>
                    <UiText
                      as="span"
                      variant={TextVariants.small}
                      color={TextColors.primary}
                      weight={TextWeights.medium}
                    >
                      {exifData.shutter}
                    </UiText>
                  </div>
                )}
                {exifData.fNumber && (
                  <div className="flex items-center gap-1.5" data-tooltip={t('editor.toolbar.tooltips.aperture')}>
                    <UiText as="span">
                      <IconAperture />
                    </UiText>
                    <UiText
                      as="span"
                      variant={TextVariants.small}
                      color={TextColors.primary}
                      weight={TextWeights.medium}
                    >
                      {exifData.fNumber}
                    </UiText>
                  </div>
                )}
                {exifData.iso && (
                  <div className="flex items-center gap-1.5" data-tooltip={t('editor.toolbar.tooltips.iso')}>
                    <UiText as="span">
                      <IconIso />
                    </UiText>
                    <UiText
                      as="span"
                      variant={TextVariants.small}
                      color={TextColors.primary}
                      weight={TextWeights.medium}
                    >
                      {exifData.iso}
                    </UiText>
                  </div>
                )}
                {exifData.focal && (
                  <div className="flex items-center gap-1.5" data-tooltip={t('editor.toolbar.tooltips.focalLength')}>
                    <UiText as="span">
                      <IconFocalLength />
                    </UiText>
                    <UiText
                      as="span"
                      variant={TextVariants.small}
                      color={TextColors.primary}
                      weight={TextWeights.medium}
                    >
                      {exifData.focal}
                    </UiText>
                  </div>
                )}
              </div>

              <div
                className={cx(
                  'absolute inset-0 flex items-center justify-center gap-5 transition-opacity duration-200',
                  showDateView ? 'opacity-100' : 'opacity-0 pointer-events-none',
                )}
              >
                {exifData.captureDate && (
                  <div className="flex items-center gap-2">
                    <UiText as="span">
                      <IconCalendar />
                    </UiText>
                    <UiText
                      as="span"
                      variant={TextVariants.small}
                      color={TextColors.primary}
                      weight={TextWeights.medium}
                    >
                      {exifData.captureDate}
                    </UiText>
                  </div>
                )}
                {exifData.captureTime && (
                  <div className="flex items-center gap-2">
                    <UiText as="span">
                      <IconClock />
                    </UiText>
                    <UiText
                      as="span"
                      variant={TextVariants.small}
                      color={TextColors.primary}
                      weight={TextWeights.medium}
                    >
                      {exifData.captureTime}
                    </UiText>
                  </div>
                )}
              </div>
            </button>
          </div>
        </div>

        <div className="z-40 flex shrink-0 items-center gap-1.5">
          <div className={cx(commandGroupClass, 'relative')} ref={historyButtonRef}>
            <button
              className={iconButtonClass}
              disabled={!canUndo}
              onClick={onUndo}
              onKeyDown={handleButtonKeyDown}
              onContextMenu={(e) => {
                e.preventDefault();
                setIsHistoryVisible((prev) => !prev);
              }}
              aria-label={t('editor.toolbar.tooltips.undo')}
              data-tooltip={t('editor.toolbar.tooltips.undo', { shortcut: undoShortcutLabel })}
              type="button"
            >
              <Undo size={16} />
            </button>
            <button
              className={iconButtonClass}
              disabled={!canRedo}
              onClick={onRedo}
              onKeyDown={handleButtonKeyDown}
              onContextMenu={(e) => {
                e.preventDefault();
                setIsHistoryVisible((prev) => !prev);
              }}
              aria-label={t('editor.toolbar.tooltips.redo')}
              data-tooltip={t('editor.toolbar.tooltips.redo', { shortcut: redoShortcutLabel })}
              type="button"
            >
              <Redo size={16} />
            </button>
            <div className={commandDividerClass} aria-hidden="true" />
            <button
              aria-label={historyDepthLabel}
              aria-expanded={isHistoryVisible}
              aria-haspopup="menu"
              className={`${token.button.base} ${token.button.quiet} ${token.button.disabled} ${token.focusRing} h-8 px-2`}
              disabled={adjustmentsHistory.length <= 1}
              onClick={() => {
                setIsHistoryVisible((prev) => !prev);
              }}
              onKeyDown={handleButtonKeyDown}
              data-testid="editor-history-depth-control"
              data-tooltip={t('editor.toolbar.tooltips.history')}
              type="button"
            >
              <UiText as="span" variant={TextVariants.small} weight={TextWeights.medium}>
                {historyDepthLabel}
              </UiText>
            </button>

            <AnimatePresence>
              {isHistoryVisible && adjustmentsHistory.length > 1 && (
                <motion.div
                  ref={historyContainerRef}
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.15, ease: 'easeOut' }}
                  className="absolute right-0 top-full z-50 mt-3 flex max-h-80 w-72 flex-col overflow-y-auto rounded-lg border border-editor-overlay-stroke bg-editor-panel/95 px-0.5 py-1.5 shadow-[0_14px_34px_var(--editor-overlay-shadow)] backdrop-blur-md custom-scrollbar"
                  data-testid="editor-history-popover"
                  role="menu"
                >
                  <div className="border-b border-editor-border px-1 pb-1">
                    <button
                      className={cx(
                        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editor-focus-ring',
                        canCreateCheckpoint ? 'hover:bg-editor-selected-quiet' : 'opacity-50',
                      )}
                      data-testid="editor-history-add-checkpoint"
                      disabled={!canCreateCheckpoint}
                      onClick={() => {
                        if (!activeHistoryItem) return;
                        if (activeCheckpoint) {
                          setEditingCheckpointId(activeCheckpoint.id);
                          setEditingCheckpointLabel(activeCheckpoint.label);
                          return;
                        }
                        onCreateAdjustmentsHistoryCheckpoint(activeHistoryItem.label);
                      }}
                      role="menuitem"
                      type="button"
                    >
                      <BookmarkPlus size={14} className="shrink-0 text-text-secondary" />
                      <span className="min-w-0 flex-1">
                        <UiText as="span" weight={TextWeights.medium}>
                          {activeCheckpoint
                            ? t('editor.toolbar.history.updateCheckpoint')
                            : t('editor.toolbar.history.addCheckpoint')}
                        </UiText>
                        <UiText
                          as="span"
                          variant={TextVariants.small}
                          color={TextColors.secondary}
                          className="block truncate"
                        >
                          {activeHistoryItem?.label ?? t('editor.toolbar.history.noActiveAdjustment')}
                        </UiText>
                      </span>
                    </button>
                  </div>

                  {historyItems.map((item) => {
                    const i = item.historyIndex;
                    const checkpoint = item.checkpoint;
                    const isCurrent = i === adjustmentsHistoryIndex;
                    const isFuture = i > adjustmentsHistoryIndex;
                    const isEditing = checkpoint?.id === editingCheckpointId;

                    const textColor = isCurrent
                      ? TextColors.button
                      : isFuture
                        ? TextColors.secondary
                        : TextColors.primary;
                    const textWeight = isCurrent ? TextWeights.medium : TextWeights.normal;

                    return (
                      <div
                        key={i}
                        data-active={isCurrent}
                        data-history-checkpoint={item.isCheckpoint ? 'true' : 'false'}
                        data-testid={isCurrent && item.isCheckpoint ? 'editor-history-active-checkpoint' : undefined}
                        className={cx(
                          'mx-1 my-0.5 flex items-center gap-1 rounded-md px-2 py-1.5 transition-colors',
                          isCurrent
                            ? 'bg-editor-primary-active'
                            : isFuture
                              ? 'opacity-55 hover:bg-editor-selected-quiet hover:opacity-100'
                              : 'hover:bg-editor-selected-quiet',
                        )}
                        role="none"
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          {item.isCheckpoint && (
                            <Bookmark
                              size={13}
                              className={cx('shrink-0', isCurrent ? 'text-current' : 'text-text-secondary')}
                            />
                          )}
                          {isEditing && checkpoint ? (
                            <input
                              aria-label={t('editor.toolbar.history.editCheckpointLabel')}
                              className="h-7 min-w-0 flex-1 rounded border border-editor-border bg-editor-panel-well px-2 text-sm text-text-primary outline-none focus:ring-2 focus:ring-editor-focus-ring"
                              data-testid="editor-history-checkpoint-label-input"
                              onChange={(event) => {
                                setEditingCheckpointLabel(event.currentTarget.value);
                              }}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  event.preventDefault();
                                  commitCheckpointRename(checkpoint.id);
                                } else if (event.key === 'Escape') {
                                  setEditingCheckpointId(null);
                                  setEditingCheckpointLabel('');
                                }
                              }}
                              value={editingCheckpointLabel}
                            />
                          ) : (
                            <button
                              className="min-w-0 flex-1 text-left focus-visible:outline-none"
                              onClick={() => {
                                goToAdjustmentsHistoryIndex(i);
                                setIsHistoryVisible(false);
                              }}
                              role="menuitem"
                              type="button"
                            >
                              <UiText as="span" color={textColor} weight={textWeight} className="block truncate">
                                {item.label}
                              </UiText>
                            </button>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <UiText
                            as="span"
                            variant={TextVariants.small}
                            color={textColor}
                            weight={textWeight}
                            className="opacity-50 shrink-0"
                          >
                            {i === 0 ? '' : i}
                          </UiText>
                          {checkpoint &&
                            (isEditing ? (
                              <>
                                <button
                                  aria-label={t('editor.toolbar.history.saveCheckpointLabel')}
                                  className={cx(
                                    token.button.base,
                                    token.button.icon,
                                    token.button.quiet,
                                    token.focusRing,
                                  )}
                                  onClick={() => {
                                    commitCheckpointRename(checkpoint.id);
                                  }}
                                  type="button"
                                >
                                  <Check size={13} />
                                </button>
                                <button
                                  aria-label={t('editor.toolbar.history.cancelCheckpointLabel')}
                                  className={cx(
                                    token.button.base,
                                    token.button.icon,
                                    token.button.quiet,
                                    token.focusRing,
                                  )}
                                  onClick={() => {
                                    setEditingCheckpointId(null);
                                    setEditingCheckpointLabel('');
                                  }}
                                  type="button"
                                >
                                  <X size={13} />
                                </button>
                              </>
                            ) : (
                              <button
                                aria-label={t('editor.toolbar.history.renameCheckpoint')}
                                className={cx(
                                  token.button.base,
                                  token.button.icon,
                                  token.button.quiet,
                                  token.focusRing,
                                )}
                                onClick={() => {
                                  setEditingCheckpointId(checkpoint.id);
                                  setEditingCheckpointLabel(checkpoint.label);
                                }}
                                type="button"
                              >
                                <Pencil size={13} />
                              </button>
                            ))}
                        </div>
                      </div>
                    );
                  })}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className={commandGroupClass} data-testid="editor-toolbar-mode-group">
            <button
              aria-label={
                negativeLabDisabledReason ? `${negativeLabLabel}: ${negativeLabDisabledReason}` : negativeLabLabel
              }
              className={cx(iconButtonClass, 'shrink-0', negativeLabDisabledReason && 'opacity-50 cursor-not-allowed')}
              data-testid="editor-toolbar-negative-lab"
              data-tooltip={negativeLabTooltip}
              disabled={negativeLabDisabledReason !== null}
              onClick={onOpenNegativeLab}
              onKeyDown={handleButtonKeyDown}
              type="button"
            >
              <Film size={16} />
            </button>
          </div>

          <div
            className={commandGroupClass}
            data-export-soft-proof-enabled={String(isExportSoftProofEnabled)}
            data-export-soft-proof-fingerprint={exportSoftProofTransform?.transformPolicyFingerprint ?? ''}
            data-export-soft-proof-recipe-id={selectedExportProofRecipeId ?? ''}
            data-export-soft-proof-recipe-name={selectedExportProofName}
            data-export-soft-proof-status={
              isExportSoftProofEnabled ? 'active' : canSoftProof ? 'available' : 'unavailable'
            }
            data-testid="export-soft-proof-toolbar"
          >
            <div className="hidden items-center gap-1 xl:flex">
              <button
                className={cx(isExportSoftProofEnabled ? activeIconButtonClass : iconButtonClass, 'relative')}
                aria-label={t('editor.toolbar.tooltips.exportSoftProof')}
                aria-pressed={isExportSoftProofEnabled}
                aria-busy={isExportSoftProofEnabled && exportSoftProofTransform === null}
                disabled={!canSoftProof}
                onClick={() => {
                  setEditor({
                    isExportSoftProofEnabled: !isExportSoftProofEnabled,
                    exportSoftProofRecipeId: selectedExportProofRecipeId,
                  });
                }}
                onKeyDown={handleButtonKeyDown}
                data-tooltip={t('editor.toolbar.tooltips.exportSoftProof')}
                type="button"
              >
                <Palette size={16} />
                {isExportSoftProofEnabled && (
                  <span
                    className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border border-editor-panel-well bg-editor-warning"
                    data-testid="export-soft-proof-active-dot"
                  />
                )}
              </button>
              {isExportSoftProofEnabled && (
                <div className="flex w-[260px] items-center gap-1.5" data-testid="export-soft-proof-recipe-details">
                  <Dropdown
                    chrome="editor"
                    className="min-w-0 flex-1"
                    disabled={!canSoftProof}
                    options={exportProofRecipeOptions}
                    value={selectedExportProofRecipeId}
                    onChange={(value) => {
                      setEditor({ exportSoftProofRecipeId: value });
                    }}
                    triggerClassName="h-8 rounded-md bg-editor-panel-raised px-2.5 text-xs"
                  />
                  {selectedExportProofRecipe && (
                    <div
                      className="flex h-8 min-w-0 flex-1 items-center justify-center gap-1 rounded-md border border-editor-warning/40 bg-editor-warning-surface px-1.5 py-0.5"
                      data-export-soft-proof-color-profile={selectedExportProofProfile}
                      data-export-soft-proof-black-point-compensation={
                        exportSoftProofTransform?.blackPointCompensation ?? ''
                      }
                      data-export-soft-proof-effective-color-profile={
                        exportSoftProofTransform?.effectiveColorProfile ?? ''
                      }
                      data-export-soft-proof-effective-rendering-intent={
                        exportSoftProofTransform?.effectiveRenderingIntent ?? ''
                      }
                      data-export-soft-proof-source-precision-path={exportSoftProofTransform?.sourcePrecisionPath ?? ''}
                      data-export-soft-proof-transform-applied={String(
                        exportSoftProofTransform?.transformApplied ?? '',
                      )}
                      data-export-soft-proof-rendering-intent={selectedExportProofIntent}
                      data-export-soft-proof-status="export-transform-preview"
                      data-export-soft-proof-transform-policy-fingerprint={
                        exportSoftProofTransform?.transformPolicyFingerprint ?? ''
                      }
                      data-testid="export-soft-proof-active-badge"
                    >
                      <UiText as="span" className="uppercase" color={TextColors.secondary} variant={TextVariants.small}>
                        {t('editor.toolbar.exportSoftProofActive')}
                      </UiText>
                      <UiText as="span" className="truncate" color={TextColors.primary} variant={TextVariants.small}>
                        {exportSoftProofSummary}
                      </UiText>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className={cx(commandDividerClass, 'hidden xl:block')} aria-hidden="true" />
            <button
              aria-label={
                showOriginal ? t('editor.toolbar.tooltips.showEdited') : t('editor.toolbar.tooltips.showOriginal')
              }
              aria-pressed={showOriginal}
              className={cx(showOriginal ? activeIconButtonClass : iconButtonClass)}
              onClick={() => {
                if (holdOriginalButtonHandledRef.current) {
                  holdOriginalButtonHandledRef.current = false;
                  return;
                }
                onToggleShowOriginal();
              }}
              onKeyDown={(event) => {
                if (event.key === ' ' || event.key === 'Enter') {
                  event.preventDefault();
                  holdOriginalButtonHandledRef.current = true;
                  onShowOriginalChange(true);
                  return;
                }
                handleButtonKeyDown(event);
              }}
              onKeyUp={(event) => {
                if (event.key === ' ' || event.key === 'Enter') {
                  onShowOriginalChange(false);
                }
              }}
              onPointerCancel={() => {
                holdOriginalButtonHandledRef.current = true;
                onShowOriginalChange(false);
              }}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                holdOriginalButtonHandledRef.current = true;
                onShowOriginalChange(true);
              }}
              onPointerLeave={(event) => {
                if (event.buttons !== 1) return;
                onShowOriginalChange(false);
              }}
              onPointerUp={() => {
                onShowOriginalChange(false);
              }}
              data-tooltip={
                showOriginal ? t('editor.toolbar.tooltips.showEdited') : t('editor.toolbar.tooltips.showOriginal')
              }
              type="button"
            >
              {showOriginal ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
            <button
              aria-label={t('editor.toolbar.compare.splitWipe')}
              aria-pressed={compareMode === 'split-wipe'}
              className={cx(compareMode === 'split-wipe' ? activeIconButtonClass : iconButtonClass)}
              data-testid="editor-compare-split-wipe"
              data-tooltip={compareUnavailableReason}
              onClick={() => {
                onCompareModeChange(compareMode === 'split-wipe' ? 'off' : 'split-wipe');
              }}
              onKeyDown={handleButtonKeyDown}
              type="button"
            >
              <SquareSplitHorizontal size={16} />
            </button>
            <button
              aria-label={t('editor.toolbar.compare.sideBySide')}
              aria-pressed={compareMode === 'side-by-side'}
              className={cx(compareMode === 'side-by-side' ? activeIconButtonClass : iconButtonClass)}
              data-testid="editor-compare-side-by-side"
              data-tooltip={compareUnavailableReason}
              onClick={() => {
                onCompareModeChange(compareMode === 'side-by-side' ? 'off' : 'side-by-side');
              }}
              onKeyDown={handleButtonKeyDown}
              type="button"
            >
              <Columns2 size={16} />
            </button>
            {compareNeedsOriginal && (
              <span
                className={editorChromeStatusChipClassName(compareMode === 'hold-original' ? 'warning' : 'neutral')}
                data-testid="editor-compare-mode-chip"
              >
                {t(`editor.toolbar.compare.mode.${compareMode}`)}
              </span>
            )}
            <div className={commandDividerClass} aria-hidden="true" />
            <button
              className={cx(isFullScreen ? activeIconButtonClass : iconButtonClass, 'relative')}
              onClick={onToggleFullScreen}
              onKeyDown={handleButtonKeyDown}
              aria-label={fullscreenTooltip}
              aria-pressed={isFullScreen}
              data-testid="editor-fullscreen-toggle"
              data-tooltip={fullscreenTooltip}
              type="button"
            >
              <div className="relative flex h-4 w-4 items-center justify-center">
                {isFullScreen ? <Minimize2 size={16} /> : <Maximize size={16} />}
              </div>
            </button>
          </div>
        </div>
      </div>
    );
  },
);

EditorToolbar.displayName = 'EditorToolbar';

export default EditorToolbar;
