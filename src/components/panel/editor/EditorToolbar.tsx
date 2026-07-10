import cx from 'clsx';
import {
  ArrowLeft,
  Check,
  Columns2,
  Eye,
  EyeOff,
  Film,
  Loader2,
  type LucideIcon,
  Maximize,
  Minimize2,
  MoonStar,
  MoreHorizontal,
  Palette,
  Redo,
  SquareSplitHorizontal,
  SquareSplitVertical,
  Undo,
} from 'lucide-react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { EditorWorkspaceLightsOutLevel } from '../../../schemas/editorWorkspacePreferencesSchemas';
import { type EditorCompareMode, useEditorStore } from '../../../store/useEditorStore';
import { useSettingsStore } from '../../../store/useSettingsStore';
import { useUIStore } from '../../../store/useUIStore';
import type { EditorCompareOrientation } from '../../../utils/editorCompare';
import { formatShortcutLabel } from '../../../utils/keyboardUtils';
import { parseVirtualImagePath } from '../../../utils/virtualImagePath';
import type { SelectedImage } from '../../ui/AppProperties';
import { editorChromeStatusChipClassName, editorChromeTokens } from '../../ui/editorChromeTokens';
import {
  buildEditorToolbarCommands,
  type EditorToolbarCommand,
  type EditorToolbarCommandId,
  partitionEditorToolbarCommands,
} from './editorToolbarCommands';
import { getViewerLightsOutLabel } from './viewerPresentationContracts';

interface EditorToolbarProps {
  canRedo: boolean;
  canUndo: boolean;
  isAndroid: boolean;
  isFullScreen?: boolean;
  isLoading: boolean;
  negativeLabDisabledReason?: string | null;
  onBackToLibrary: () => void;
  onCompareModeChange?: (mode: EditorCompareMode) => void;
  onCompareOrientationChange?: (orientation: EditorCompareOrientation) => void;
  onCycleLightsOut?: () => void;
  onOpenNegativeLab: () => void;
  onRedo: () => void;
  onShowOriginalChange?: (showOriginal: boolean) => void;
  onToggleFullScreen: () => void;
  onToggleShowOriginal: () => void;
  onUndo: () => void;
  selectedImage: SelectedImage;
  compareMode?: EditorCompareMode;
  compareOrientation?: EditorCompareOrientation;
  lightsOutLevel?: EditorWorkspaceLightsOutLevel;
  osPlatform?: string;
  showOriginal: boolean;
}

const commandIcons: Record<EditorToolbarCommandId, LucideIcon> = {
  'back-to-library': ArrowLeft,
  'compare-orientation': SquareSplitHorizontal,
  'compare-side-by-side': Columns2,
  'compare-split-wipe': SquareSplitVertical,
  fullscreen: Maximize,
  'lights-out': MoonStar,
  'negative-lab': Film,
  redo: Redo,
  'show-original': Eye,
  'soft-proof': Palette,
  undo: Undo,
};

const EditorToolbar = memo(
  ({
    canRedo,
    canUndo,
    compareMode = 'off',
    compareOrientation = 'vertical',
    isAndroid,
    isFullScreen: isFullScreenProp,
    isLoading,
    lightsOutLevel = 'off',
    negativeLabDisabledReason = null,
    onBackToLibrary,
    onCompareModeChange = () => undefined,
    onCompareOrientationChange = () => undefined,
    onCycleLightsOut = () => undefined,
    onOpenNegativeLab,
    onRedo,
    onShowOriginalChange = () => undefined,
    onToggleFullScreen,
    onToggleShowOriginal,
    onUndo,
    osPlatform,
    selectedImage,
    showOriginal,
  }: EditorToolbarProps) => {
    const { t } = useTranslation();
    const compactViewport = useCompactCommandBar();
    const appSettings = useSettingsStore((state) => state.appSettings);
    const osPlatformFromStore = useSettingsStore((state) => state.osPlatform);
    const isExportSoftProofEnabled = useEditorStore((state) => state.isExportSoftProofEnabled);
    const exportSoftProofRecipeId = useEditorStore((state) => state.exportSoftProofRecipeId);
    const isFullScreenFromStore = useUIStore((state) => state.isFullScreen);
    const setEditor = useEditorStore((state) => state.setEditor);
    const isFullScreen = isFullScreenProp ?? isFullScreenFromStore;
    const exportRecipeIds = useMemo(
      () =>
        (appSettings?.exportPresets ?? []).filter((preset) => preset.fileFormat !== 'cube').map((preset) => preset.id),
      [appSettings?.exportPresets],
    );
    const selectedExportRecipeId = exportRecipeIds.includes(exportSoftProofRecipeId ?? '')
      ? exportSoftProofRecipeId
      : (exportRecipeIds[0] ?? null);
    const { baseName, fileTypeLabel, isVirtualCopy } = useMemo(() => {
      const { path, virtualCopyId } = parseVirtualImagePath(selectedImage.path);
      const fileName = path.split(/[\\/]/).pop() || '';
      return {
        baseName: fileName,
        fileTypeLabel: /\.([a-z0-9]+)$/i.exec(fileName)?.[1]?.toUpperCase() ?? 'FILE',
        isVirtualCopy: virtualCopyId !== null,
      };
    }, [selectedImage.path]);
    const effectiveOsPlatform = osPlatform ?? osPlatformFromStore;
    const undoShortcut = formatShortcutLabel(['ctrl', 'KeyZ'], effectiveOsPlatform);
    const redoShortcut = formatShortcutLabel(['ctrl', 'KeyY'], effectiveOsPlatform);
    const fullscreenLabel = isFullScreen
      ? t('editor.toolbar.tooltips.exitPreview')
      : t('editor.toolbar.tooltips.fullscreen');
    const originalLabel = showOriginal
      ? t('editor.toolbar.tooltips.showEdited')
      : t('editor.toolbar.tooltips.showOriginal');
    const lightsOutLabel = `Lights out: ${getViewerLightsOutLabel(lightsOutLevel)}`;
    const overflowLabel = t('modals.commandPalette.title');

    useEffect(() => {
      if (exportRecipeIds.length === 0 && (isExportSoftProofEnabled || exportSoftProofRecipeId !== null)) {
        setEditor({ exportSoftProofRecipeId: null, isExportSoftProofEnabled: false });
      } else if (selectedExportRecipeId !== exportSoftProofRecipeId) {
        setEditor({ exportSoftProofRecipeId: selectedExportRecipeId });
      }
    }, [exportSoftProofRecipeId, exportRecipeIds, isExportSoftProofEnabled, selectedExportRecipeId, setEditor]);

    const commands = buildEditorToolbarCommands(
      {
        canRedo,
        canSoftProof: exportRecipeIds.length > 0,
        canUndo,
        compareMode,
        compareOrientation,
        isFullScreen,
        isSoftProofEnabled: isExportSoftProofEnabled,
        lightsOutLevel,
        negativeLabDisabledReason,
        showOriginal,
      },
      {
        backToLibrary: t('editor.toolbar.tooltips.backToLibrary'),
        compareOrientation:
          compareOrientation === 'vertical'
            ? t('editor.toolbar.compare.useHorizontal')
            : t('editor.toolbar.compare.useVertical'),
        compareSideBySide: t('editor.toolbar.compare.sideBySide'),
        compareSplitWipe: t('editor.toolbar.compare.splitWipe'),
        fullscreen: fullscreenLabel,
        lightsOut: lightsOutLabel,
        negativeLab: t('contextMenus.editor.convertNegative'),
        redo: t('editor.toolbar.tooltips.redo', { shortcut: redoShortcut }),
        redoShortcut,
        showOriginal: originalLabel,
        softProof: t('editor.toolbar.tooltips.exportSoftProof'),
        undo: t('editor.toolbar.tooltips.undo', { shortcut: undoShortcut }),
        undoShortcut,
      },
      {
        backToLibrary: onBackToLibrary,
        changeCompareOrientation: () => {
          onCompareOrientationChange(compareOrientation === 'vertical' ? 'horizontal' : 'vertical');
        },
        openNegativeLab: onOpenNegativeLab,
        redo: onRedo,
        toggleCompareSideBySide: () => {
          onCompareModeChange(compareMode === 'side-by-side' ? 'off' : 'side-by-side');
        },
        toggleCompareSplitWipe: () => {
          onCompareModeChange(compareMode === 'split-wipe' ? 'off' : 'split-wipe');
        },
        toggleFullScreen: onToggleFullScreen,
        toggleLightsOut: onCycleLightsOut,
        toggleShowOriginal: onToggleShowOriginal,
        toggleSoftProof: () => {
          setEditor({
            exportSoftProofRecipeId: selectedExportRecipeId,
            isExportSoftProofEnabled: !isExportSoftProofEnabled,
          });
        },
        undo: onUndo,
      },
    );
    const commandGroups = partitionEditorToolbarCommands(commands, isAndroid || compactViewport);
    const navigationCommand = commandGroups.navigation[0];

    return (
      <div
        aria-label={t('editor.accessibility.workspace')}
        className="relative z-40 grid h-10 shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b border-editor-divider bg-editor-panel px-2"
        data-tauri-drag-region
        data-testid="editor-command-bar"
        data-toolbar-compare-mode={compareMode}
        data-toolbar-fullscreen={isFullScreen ? 'active' : 'inactive'}
        data-toolbar-loading={isLoading ? 'true' : 'false'}
        data-toolbar-negative-lab={negativeLabDisabledReason ? 'disabled' : 'available'}
        data-toolbar-original={showOriginal ? 'original' : 'edited'}
        data-toolbar-soft-proof={
          isExportSoftProofEnabled ? 'active' : exportRecipeIds.length > 0 ? 'available' : 'unavailable'
        }
        role="toolbar"
      >
        <div className="flex items-center" data-command-zone="navigation">
          {navigationCommand && <CommandButton command={navigationCommand} />}
        </div>

        <div className="flex min-w-0 items-center justify-center px-1" data-tauri-drag-region>
          <div
            aria-busy={isLoading}
            className="flex min-w-0 max-w-full items-center gap-1.5"
            data-testid="editor-toolbar-file-status"
            title={baseName}
          >
            <span className="min-w-0 truncate text-[12px] font-medium leading-4 text-text-primary">{baseName}</span>
            <span
              className={cx('shrink-0', editorChromeStatusChipClassName('neutral'))}
              data-testid="editor-file-type-badge"
              data-tooltip={t('editor.toolbar.tooltips.fileType')}
            >
              {fileTypeLabel}
            </span>
            {isVirtualCopy && <span className={editorChromeStatusChipClassName('info')}>{t('editor.toolbar.vc')}</span>}
            {isLoading && (
              <Loader2
                aria-label={t('editor.adjustments.status.loadingImage')}
                className="shrink-0 animate-spin text-text-secondary"
                size={13}
              />
            )}
          </div>
        </div>

        <div className="flex items-center gap-0.5" data-command-zone="actions">
          {commandGroups.primary.map((command) => (
            <CommandButton
              command={command}
              key={command.id}
              {...(command.id === 'show-original' ? { onMomentaryChange: onShowOriginalChange } : {})}
            />
          ))}
          <CommandOverflow commands={commandGroups.overflow} label={overflowLabel} />
        </div>
      </div>
    );
  },
);

function useCompactCommandBar(): boolean {
  const query = '(max-width: 700px)';
  const [isCompact, setIsCompact] = useState(() =>
    typeof window === 'undefined' || typeof window.matchMedia !== 'function' ? false : window.matchMedia(query).matches,
  );

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mediaQuery = window.matchMedia(query);
    const handleChange = () => setIsCompact(mediaQuery.matches);
    handleChange();
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  return isCompact;
}

function CommandButton({
  command,
  onMomentaryChange,
}: {
  command: EditorToolbarCommand;
  onMomentaryChange?: (active: boolean) => void;
}) {
  const momentaryHandledRef = useRef(false);
  let Icon = commandIcons[command.id];
  if (command.id === 'fullscreen' && command.pressed) Icon = Minimize2;
  if (command.id === 'show-original' && command.pressed) Icon = EyeOff;
  return (
    <button
      aria-label={command.disabledReason ? `${command.label}: ${command.disabledReason}` : command.label}
      aria-pressed={command.pressed}
      className={cx(
        editorChromeTokens.button.base,
        editorChromeTokens.button.icon,
        editorChromeTokens.button.disabled,
        editorChromeTokens.focusRing,
        command.pressed ? editorChromeTokens.button.selectedQuiet : editorChromeTokens.button.quiet,
      )}
      data-command-id={command.id}
      data-testid={commandTestId(command.id)}
      data-tooltip={command.tooltip}
      disabled={!command.enabled}
      onClick={() => {
        if (momentaryHandledRef.current) {
          momentaryHandledRef.current = false;
          return;
        }
        command.action();
      }}
      onKeyDown={(event) => {
        if (!onMomentaryChange || (event.key !== ' ' && event.key !== 'Enter')) return;
        event.preventDefault();
        momentaryHandledRef.current = true;
        onMomentaryChange(true);
      }}
      onKeyUp={(event) => {
        if (onMomentaryChange && (event.key === ' ' || event.key === 'Enter')) onMomentaryChange(false);
      }}
      onPointerCancel={() => {
        if (onMomentaryChange) onMomentaryChange(false);
      }}
      onPointerDown={(event) => {
        if (!onMomentaryChange || event.button !== 0) return;
        momentaryHandledRef.current = true;
        onMomentaryChange(true);
      }}
      onPointerLeave={(event) => {
        if (onMomentaryChange && event.buttons === 1) onMomentaryChange(false);
      }}
      onPointerUp={() => {
        if (onMomentaryChange) onMomentaryChange(false);
      }}
      type="button"
    >
      <Icon aria-hidden="true" size={16} />
    </button>
  );
}

function CommandOverflow({ commands, label }: { commands: EditorToolbarCommand[]; label: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isOpen]);

  const focusItem = (startIndex: number, step: 1 | -1) => {
    for (let offset = 0; offset < commands.length; offset += 1) {
      const index = (startIndex + offset * step + commands.length) % commands.length;
      const item = itemRefs.current[index];
      if (item && !item.disabled) {
        item.focus();
        return;
      }
    }
  };

  return (
    <div className="relative ml-0.5 border-l border-editor-divider pl-0.5" ref={containerRef}>
      <button
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label={label}
        className={`${editorChromeTokens.button.base} ${editorChromeTokens.button.icon} ${editorChromeTokens.button.quiet} ${editorChromeTokens.focusRing}`}
        data-testid="editor-command-overflow-trigger"
        data-tooltip={label}
        onClick={() => setIsOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setIsOpen(true);
            requestAnimationFrame(() => focusItem(0, 1));
          }
        }}
        ref={triggerRef}
        type="button"
      >
        <MoreHorizontal aria-hidden="true" size={17} />
      </button>
      {isOpen && (
        <div
          aria-label={label}
          className="absolute right-0 top-full z-50 mt-1 w-64 rounded border border-editor-divider bg-editor-panel-raised p-1 shadow-[0_14px_34px_var(--editor-overlay-shadow)]"
          data-testid="editor-command-overflow-menu"
          onKeyDown={(event) => {
            const currentIndex = itemRefs.current.indexOf(document.activeElement as HTMLButtonElement);
            if (event.key === 'Escape') {
              event.preventDefault();
              setIsOpen(false);
              triggerRef.current?.focus();
            } else if (event.key === 'ArrowDown') {
              event.preventDefault();
              focusItem(currentIndex + 1, 1);
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              focusItem(currentIndex - 1, -1);
            } else if (event.key === 'Home') {
              event.preventDefault();
              focusItem(0, 1);
            } else if (event.key === 'End') {
              event.preventDefault();
              focusItem(commands.length - 1, -1);
            } else if (event.key === 'Tab') {
              setIsOpen(false);
            }
          }}
          role="menu"
        >
          {commands.map((command, index) => {
            const Icon = commandIcons[command.id];
            return (
              <button
                aria-label={command.disabledReason ? `${command.label}: ${command.disabledReason}` : command.label}
                aria-checked={command.pressed}
                className="flex min-h-8 w-full items-center gap-2 rounded px-2 text-left text-[12px] leading-4 text-text-primary hover:bg-editor-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-editor-focus-ring disabled:cursor-not-allowed disabled:opacity-45"
                data-command-id={command.id}
                data-testid={commandTestId(command.id)}
                data-tooltip={command.tooltip}
                disabled={!command.enabled}
                key={command.id}
                onClick={() => {
                  command.action();
                  setIsOpen(false);
                  triggerRef.current?.focus();
                }}
                ref={(element) => {
                  itemRefs.current[index] = element;
                }}
                role={command.pressed === undefined ? 'menuitem' : 'menuitemcheckbox'}
                type="button"
              >
                <Icon aria-hidden="true" className="shrink-0 text-text-secondary" size={15} />
                <span className="min-w-0 flex-1 truncate">{command.label}</span>
                {command.shortcutHint && <span className="text-text-tertiary">{command.shortcutHint}</span>}
                {command.pressed && <Check aria-hidden="true" className="shrink-0" size={14} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function commandTestId(id: EditorToolbarCommandId): string | undefined {
  if (id === 'negative-lab') return 'editor-toolbar-negative-lab';
  if (id === 'fullscreen') return 'editor-fullscreen-toggle';
  if (id === 'lights-out') return 'editor-lights-out-toggle';
  if (id === 'compare-split-wipe') return 'editor-compare-split-wipe';
  if (id === 'compare-side-by-side') return 'editor-compare-side-by-side';
  if (id === 'compare-orientation') return 'editor-compare-orientation';
  return undefined;
}

EditorToolbar.displayName = 'EditorToolbar';

export default EditorToolbar;
