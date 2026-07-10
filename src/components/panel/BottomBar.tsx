import cx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ClipboardPaste,
  Copy,
  FileInput,
  Palette,
  Settings,
  Star,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { useLibraryActions } from '../../hooks/library/useLibraryActions';
import { useLibraryStore } from '../../store/useLibraryStore';
import { COLOR_LABELS } from '../../utils/adjustments';
import type { EditorZoomCommand } from '../../utils/editorZoom';
import type { ImageFile, SelectedImage, ThumbnailAspectRatio } from '../ui/AppProperties';
import Filmstrip from './Filmstrip';

interface BottomBarProps {
  filmstripHeight?: number;
  isContiguousShell?: boolean;
  imageList?: Array<ImageFile>;
  imageRatings?: Record<string, number> | null | undefined;
  isCopied: boolean;
  isCopyDisabled: boolean;
  isExportDisabled?: boolean;
  isFilmstripVisible?: boolean;
  isLibraryView?: boolean;
  isLoading?: boolean;
  isPasted: boolean;
  isPasteDisabled: boolean;
  isRatingDisabled?: boolean;
  isResetDisabled?: boolean;
  isResizing?: boolean;
  multiSelectedPaths?: Array<string>;
  onClearSelection?: (() => void) | undefined;
  onContextMenu?: ((event: React.MouseEvent<HTMLElement>, path: string) => void) | undefined;
  onCopy: () => void;
  onExportClick?: () => void;
  onImageSelect?:
    | ((path: string, event: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>) => void)
    | undefined;
  onOpenCopyPasteSettings?: () => void;
  onRequestThumbnails?: ((paths: string[]) => void) | undefined;
  onPaste: () => void;
  onRate: (rate: number) => void;
  onReset?: () => void;
  onZoomChange?: (command: EditorZoomCommand) => void;
  rating: number;
  selectedImage?: SelectedImage | undefined;
  setIsFilmstripVisible?: (isVisible: boolean) => void;
  showFilmstrip?: boolean;
  showZoomControls?: boolean;
  thumbnailAspectRatio: ThumbnailAspectRatio;
  totalImages?: number;
}

interface EditorBottomCommandModel {
  activeColor: string | null;
  activeIndex: number;
  activeRating: number;
  hasActiveFilters: boolean;
  isColorMixed: boolean;
  isRatingMixed: boolean;
  nextPath: string | null;
  previousPath: string | null;
  selectedCount: number;
  targetPaths: string[];
  totalCount: number;
}

const getImageColor = (image: ImageFile | undefined) =>
  image?.tags?.find((tag) => tag.startsWith('color:'))?.slice('color:'.length) ?? null;

export const buildEditorBottomCommandModel = ({
  filterColors,
  filterRating,
  imageList,
  imageRatings,
  multiSelectedPaths,
  selectedPath,
}: {
  filterColors: string[];
  filterRating: number;
  imageList: ImageFile[];
  imageRatings: Record<string, number> | null | undefined;
  multiSelectedPaths: string[];
  selectedPath: string | undefined;
}): EditorBottomCommandModel => {
  const activeIndex = selectedPath ? imageList.findIndex((image) => image.path === selectedPath) : -1;
  const targetPaths = multiSelectedPaths.length > 0 ? multiSelectedPaths : selectedPath ? [selectedPath] : [];
  const targetRatings = targetPaths.map((path) => imageRatings?.[path] ?? 0);
  const targetColors = targetPaths.map((path) => getImageColor(imageList.find((image) => image.path === path)));
  const activeRating = selectedPath ? (imageRatings?.[selectedPath] ?? 0) : (targetRatings[0] ?? 0);
  const activeColor = selectedPath
    ? getImageColor(imageList.find((image) => image.path === selectedPath))
    : (targetColors[0] ?? null);

  return {
    activeColor,
    activeIndex,
    activeRating,
    hasActiveFilters: filterRating > 0 || filterColors.length > 0,
    isColorMixed: new Set(targetColors).size > 1,
    isRatingMixed: new Set(targetRatings).size > 1,
    nextPath: activeIndex >= 0 ? (imageList[activeIndex + 1]?.path ?? null) : null,
    previousPath: activeIndex > 0 ? (imageList[activeIndex - 1]?.path ?? null) : null,
    selectedCount: targetPaths.length,
    targetPaths,
    totalCount: imageList.length,
  };
};

const iconButtonClassName =
  'relative flex h-8 w-8 shrink-0 items-center justify-center rounded text-text-secondary transition-colors hover:bg-editor-panel-raised hover:text-text-primary active:bg-editor-selected-quiet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editor-focus-ring disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent';

function StarRating({
  disabled,
  mixed,
  onRate,
  rating,
}: {
  disabled: boolean;
  mixed?: boolean;
  onRate: (rate: number) => void;
  rating: number;
}) {
  const { t } = useTranslation();

  return (
    <div
      aria-label={t('contextMenus.editor.rating')}
      className={cx('flex h-8 shrink-0 items-center', disabled && 'cursor-not-allowed opacity-60')}
      data-mixed={mixed ? 'true' : 'false'}
      role="group"
    >
      {Array.from({ length: 5 }, (_, index) => {
        const starValue = index + 1;
        const isActive = !mixed && starValue <= rating;
        return (
          <button
            aria-label={t('ui.bottomBar.tooltips.rateStars', { count: starValue })}
            aria-pressed={isActive}
            className="flex h-7 w-6 items-center justify-center rounded text-text-secondary transition-colors hover:bg-editor-selected-quiet hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editor-focus-ring disabled:cursor-not-allowed disabled:hover:bg-transparent"
            disabled={disabled}
            key={starValue}
            onClick={() => onRate(starValue)}
            type="button"
          >
            <Star
              className={cx(
                'transition-colors',
                isActive ? 'fill-accent text-accent' : mixed ? 'text-text-primary' : 'text-text-secondary',
              )}
              fill={mixed ? 'currentColor' : undefined}
              fillOpacity={mixed ? 0.35 : undefined}
              size={17}
            />
          </button>
        );
      })}
    </div>
  );
}

function FeedbackIcon({ active, idle }: { active: boolean; idle: React.ReactNode }) {
  return (
    <AnimatePresence initial={false} mode="wait">
      <motion.span
        animate={{ opacity: 1, scale: 1 }}
        className="absolute"
        exit={{ opacity: 0, scale: 0.7 }}
        initial={{ opacity: 0, scale: 0.7 }}
        key={active ? 'complete' : 'idle'}
        transition={{ duration: 0.12 }}
      >
        {active ? <Check aria-hidden="true" className="text-green-500" size={18} /> : idle}
      </motion.span>
    </AnimatePresence>
  );
}

function CommandMenu({
  active,
  children,
  icon,
  label,
}: {
  active?: boolean;
  children: React.ReactNode;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <details className="group relative shrink-0">
      <summary
        aria-label={label}
        className={cx(iconButtonClassName, 'list-none [&::-webkit-details-marker]:hidden', active && 'text-accent')}
        data-tooltip={label}
      >
        {icon}
        {active ? <span className="absolute bottom-0.5 h-1 w-1 rounded-full bg-accent" /> : null}
      </summary>
      <div className="absolute bottom-10 left-0 z-30 min-w-48 border border-editor-border bg-editor-panel p-1 shadow-xl">
        {children}
      </div>
    </details>
  );
}

function EditorOrganizationMenu({
  disabled,
  model,
  onSetColor,
}: {
  disabled: boolean;
  model: EditorBottomCommandModel;
  onSetColor: (color: string | null) => void;
}) {
  const { t } = useTranslation();
  const { filterCriteria, setFilterCriteria } = useLibraryStore(
    useShallow((state) => ({ filterCriteria: state.filterCriteria, setFilterCriteria: state.setFilterCriteria })),
  );

  return (
    <div className="flex items-center">
      <CommandMenu
        active={model.isColorMixed || model.activeColor !== null || model.hasActiveFilters}
        icon={<Palette aria-hidden="true" size={18} />}
        label={`${t('contextMenus.editor.colorLabel')}; ${t('ui.bottomBar.tooltips.quickFilter')}`}
      >
        <button
          aria-pressed={!model.isColorMixed && model.activeColor === null}
          className="flex h-8 w-full items-center gap-2 px-2 text-left text-xs text-text-secondary hover:bg-editor-selected-quiet hover:text-text-primary disabled:opacity-40"
          disabled={disabled}
          onClick={() => onSetColor(null)}
          type="button"
        >
          <X aria-hidden="true" size={14} />
          {t('contextMenus.editor.noLabel')}
        </button>
        {COLOR_LABELS.map((color) => (
          <button
            aria-pressed={!model.isColorMixed && model.activeColor === color.name}
            className="flex h-8 w-full items-center gap-2 px-2 text-left text-xs text-text-secondary hover:bg-editor-selected-quiet hover:text-text-primary disabled:opacity-40"
            disabled={disabled}
            key={color.name}
            onClick={() => onSetColor(color.name)}
            type="button"
          >
            <span className="h-3 w-3 rounded-full" style={{ backgroundColor: color.color }} />
            {t(`contextMenus.colors.${color.name}`, { defaultValue: color.name })}
            {!model.isColorMixed && model.activeColor === color.name ? (
              <Check aria-hidden="true" className="ml-auto" size={14} />
            ) : null}
          </button>
        ))}
        <div className="my-1 h-px bg-editor-border" />
        <div className="flex items-center gap-0.5 px-1 py-1" role="group">
          {[1, 2, 3, 4, 5].map((rating) => (
            <button
              aria-label={t('library.header.viewOptions.filterByRating', { rating })}
              aria-pressed={filterCriteria.rating === rating}
              className="flex h-7 w-7 items-center justify-center rounded hover:bg-editor-selected-quiet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editor-focus-ring"
              key={rating}
              onClick={() =>
                setFilterCriteria((current) => ({ ...current, rating: current.rating === rating ? 0 : rating }))
              }
              type="button"
            >
              <Star
                aria-hidden="true"
                className={cx(filterCriteria.rating >= rating ? 'fill-accent text-accent' : 'text-text-secondary')}
                size={16}
              />
            </button>
          ))}
        </div>
        <div className="my-1 h-px bg-editor-border" />
        <div className="flex items-center gap-2 px-2 py-2" role="group">
          {[...COLOR_LABELS, { color: '#9ca3af', name: 'none' as const }].map((color) => {
            const selected = filterCriteria.colors.includes(color.name);
            return (
              <button
                aria-label={
                  color.name === 'none'
                    ? t('library.header.viewOptions.noLabel')
                    : t('library.header.viewOptions.filterByColorLabel', {
                        color: t(`contextMenus.colors.${color.name}`, { defaultValue: color.name }),
                      })
                }
                aria-pressed={selected}
                className={cx(
                  'flex h-5 w-5 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editor-focus-ring',
                  selected && 'ring-2 ring-accent ring-offset-1 ring-offset-editor-panel',
                )}
                key={color.name}
                onClick={() =>
                  setFilterCriteria((current) => ({
                    ...current,
                    colors: current.colors.includes(color.name)
                      ? current.colors.filter((name) => name !== color.name)
                      : [...current.colors, color.name],
                  }))
                }
                style={{ backgroundColor: color.color }}
                type="button"
              >
                {selected ? <Check aria-hidden="true" className="text-white" size={11} /> : null}
              </button>
            );
          })}
        </div>
      </CommandMenu>
    </div>
  );
}

function EditorFilmstripLane({
  filmstripHeight,
  imageList = [],
  imageRatings,
  isFilmstripVisible,
  isLoading = false,
  isResizing,
  laneRef,
  multiSelectedPaths = [],
  onClearSelection,
  onContextMenu,
  onImageSelect,
  onRequestThumbnails,
  selectedImage,
  thumbnailAspectRatio,
}: Pick<
  BottomBarProps,
  | 'filmstripHeight'
  | 'imageList'
  | 'imageRatings'
  | 'isFilmstripVisible'
  | 'isLoading'
  | 'isResizing'
  | 'multiSelectedPaths'
  | 'onClearSelection'
  | 'onContextMenu'
  | 'onImageSelect'
  | 'onRequestThumbnails'
  | 'selectedImage'
  | 'thumbnailAspectRatio'
> & { laneRef: React.RefObject<HTMLDivElement | null> }) {
  const height = filmstripHeight ?? 0;
  return (
    <div
      className={cx(
        'overflow-hidden bg-editor-panel-well',
        !isResizing && 'transition-[height] duration-300 ease-in-out',
      )}
      data-testid="editor-filmstrip-lane"
      ref={laneRef}
      style={{ height: isFilmstripVisible ? `${height}px` : '0px' }}
    >
      <div className="w-full p-2" style={{ height: `${height}px` }}>
        <Filmstrip
          imageList={imageList}
          imageRatings={imageRatings}
          isLoading={isLoading}
          multiSelectedPaths={multiSelectedPaths}
          onClearSelection={onClearSelection}
          onContextMenu={onContextMenu}
          onImageSelect={onImageSelect}
          onRequestThumbnails={onRequestThumbnails}
          selectedImage={selectedImage}
          selectedImageThumbnailUrl={selectedImage?.thumbnailUrl}
          thumbnailAspectRatio={thumbnailAspectRatio}
        />
      </div>
    </div>
  );
}

function EditorBottomCommandBar(props: BottomBarProps) {
  const { t } = useTranslation();
  const { handleSetColorLabel } = useLibraryActions();
  const { filterCriteria } = useLibraryStore(useShallow((state) => ({ filterCriteria: state.filterCriteria })));
  const laneRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const previousVisibility = useRef(props.isFilmstripVisible);
  const imageList = props.imageList ?? [];
  const multiSelectedPaths = props.multiSelectedPaths ?? [];
  const model = useMemo(
    () =>
      buildEditorBottomCommandModel({
        filterColors: filterCriteria.colors,
        filterRating: filterCriteria.rating,
        imageList,
        imageRatings: props.imageRatings,
        multiSelectedPaths,
        selectedPath: props.selectedImage?.path,
      }),
    [
      filterCriteria.colors,
      filterCriteria.rating,
      imageList,
      multiSelectedPaths,
      props.imageRatings,
      props.selectedImage,
    ],
  );

  useEffect(() => {
    const didCollapse = previousVisibility.current === true && props.isFilmstripVisible === false;
    previousVisibility.current = props.isFilmstripVisible;
    if (
      didCollapse &&
      document.activeElement instanceof HTMLElement &&
      laneRef.current?.contains(document.activeElement)
    ) {
      toggleRef.current?.focus({ preventScroll: true });
    }
  }, [props.isFilmstripVisible]);

  const navigate = (path: string | null, event: React.MouseEvent<HTMLButtonElement>) => {
    if (path) props.onImageSelect?.(path, event);
  };
  const toggleFilmstrip = () => props.setIsFilmstripVisible?.(!props.isFilmstripVisible);
  const countLabel =
    model.activeIndex >= 0 ? `${model.activeIndex + 1} / ${model.totalCount}` : `0 / ${model.totalCount}`;

  return (
    <div
      className={cx(
        'shrink-0 overflow-hidden border border-editor-border bg-editor-panel',
        props.isContiguousShell ? 'rounded-none border-x-0 border-b-0' : 'rounded-lg',
        !props.showFilmstrip && 'rounded-none border-0',
      )}
      data-active-filename={props.selectedImage?.path.split(/[\\/]/u).pop() ?? ''}
      data-selected-count={model.selectedCount}
      data-testid="editor-bottom-bar"
    >
      {props.showFilmstrip ? (
        <EditorFilmstripLane
          {...props}
          imageList={imageList}
          laneRef={laneRef}
          multiSelectedPaths={multiSelectedPaths}
        />
      ) : null}
      <div
        aria-label={t('ui.bottomBar.tooltips.quickFilter')}
        className="flex h-11 min-w-0 items-center gap-1 border-t border-editor-border px-2"
        data-active-filters={model.hasActiveFilters ? 'true' : 'false'}
        data-testid={props.showFilmstrip ? 'editor-bottom-bar-controls' : 'editor-bottom-bar-compact-controls'}
        role="toolbar"
      >
        <div className="flex min-w-0 shrink items-center gap-0.5" data-testid="editor-bottom-navigation-zone">
          {props.showFilmstrip ? (
            <button
              aria-label={
                props.isFilmstripVisible
                  ? t('ui.bottomBar.tooltips.collapseFilmstrip')
                  : t('ui.bottomBar.tooltips.expandFilmstrip')
              }
              aria-pressed={props.isFilmstripVisible}
              className={cx(iconButtonClassName, props.isFilmstripVisible && 'text-text-primary')}
              data-testid="editor-filmstrip-toggle"
              onClick={toggleFilmstrip}
              ref={toggleRef}
              type="button"
            >
              {props.isFilmstripVisible ? (
                <ChevronDown aria-hidden="true" size={18} />
              ) : (
                <ChevronUp aria-hidden="true" size={18} />
              )}
            </button>
          ) : null}
          <button
            aria-label={t('settings.keybinds.actions.preview_prev')}
            className={iconButtonClassName}
            disabled={model.previousPath === null}
            onClick={(event) => navigate(model.previousPath, event)}
            type="button"
          >
            <ChevronLeft aria-hidden="true" size={18} />
          </button>
          <button
            aria-label={t('settings.keybinds.actions.preview_next')}
            className={iconButtonClassName}
            disabled={model.nextPath === null}
            onClick={(event) => navigate(model.nextPath, event)}
            type="button"
          >
            <ChevronRight aria-hidden="true" size={18} />
          </button>
          <span className="hidden min-w-14 px-1 text-center text-[11px] tabular-nums text-text-secondary sm:block">
            {countLabel}
          </span>
          {model.selectedCount > 1 ? (
            <button
              className="hidden h-7 items-center gap-1 px-1.5 text-[11px] text-text-secondary hover:text-text-primary lg:flex"
              data-testid="editor-bottom-selection-count"
              onClick={props.onClearSelection}
              type="button"
            >
              {t('ui.filmstrip.selectionSummary.selectedCount', { count: model.selectedCount })}
              <X aria-hidden="true" size={13} />
            </button>
          ) : null}
        </div>

        <div className="mx-1 h-5 w-px shrink-0 bg-editor-border" />
        <div className="flex min-w-0 items-center" data-testid="editor-bottom-organization-zone">
          <StarRating
            disabled={props.isRatingDisabled ?? false}
            mixed={model.isRatingMixed}
            onRate={props.onRate}
            rating={model.activeRating || props.rating}
          />
          <EditorOrganizationMenu
            disabled={props.isRatingDisabled ?? false}
            model={model}
            onSetColor={(color) => void handleSetColorLabel(color, model.targetPaths)}
          />
        </div>

        <div className="ml-auto h-5 w-px shrink-0 bg-editor-border" />
        <div className="flex shrink-0 items-center" data-testid="editor-bottom-transfer-zone">
          <button
            aria-label={t('ui.bottomBar.tooltips.copySettings')}
            className={iconButtonClassName}
            disabled={props.isCopyDisabled}
            onClick={props.onCopy}
            type="button"
          >
            <FeedbackIcon active={props.isCopied} idle={<Copy aria-hidden="true" size={18} />} />
          </button>
          <button
            aria-label={t('ui.bottomBar.tooltips.pasteSettings')}
            className={iconButtonClassName}
            disabled={props.isPasteDisabled}
            onClick={props.onPaste}
            type="button"
          >
            <FeedbackIcon active={props.isPasted} idle={<ClipboardPaste aria-hidden="true" size={18} />} />
          </button>
          <button
            aria-label={t('ui.bottomBar.tooltips.copyPasteSettings')}
            className={cx(iconButtonClassName, 'hidden min-[440px]:flex')}
            onClick={props.onOpenCopyPasteSettings}
            type="button"
          >
            <Settings aria-hidden="true" size={18} />
          </button>
        </div>
        <span aria-live="polite" className="sr-only">
          {props.isCopied
            ? t('ui.bottomBar.tooltips.copySettings')
            : props.isPasted
              ? t('ui.bottomBar.tooltips.pasteSettings')
              : ''}
        </span>
      </div>
    </div>
  );
}

function LibraryBottomBar(props: BottomBarProps) {
  const { t } = useTranslation();
  const selectedCount = props.multiSelectedPaths?.length ?? 0;
  return (
    <div className="shrink-0 rounded-lg border border-editor-border bg-editor-panel" data-testid="editor-bottom-bar">
      <div className="flex h-10 items-center gap-2 px-2" data-testid="editor-bottom-bar-controls">
        <StarRating disabled={props.isRatingDisabled ?? false} onRate={props.onRate} rating={props.rating} />
        {selectedCount > 1 ? (
          <span className="text-xs text-text-secondary">
            {t('ui.bottomBar.imagesSelected', { current: selectedCount, total: props.totalImages ?? 0 })}
          </span>
        ) : null}
        <div className="ml-auto flex items-center">
          <button
            aria-label={t('ui.bottomBar.tooltips.copySettings')}
            className={iconButtonClassName}
            disabled={props.isCopyDisabled}
            onClick={props.onCopy}
            type="button"
          >
            <Copy aria-hidden="true" size={18} />
          </button>
          <button
            aria-label={t('ui.bottomBar.tooltips.pasteSettings')}
            className={iconButtonClassName}
            disabled={props.isPasteDisabled}
            onClick={props.onPaste}
            type="button"
          >
            <ClipboardPaste aria-hidden="true" size={18} />
          </button>
          <button
            aria-label={t('ui.bottomBar.tooltips.copyPasteSettings')}
            className={iconButtonClassName}
            onClick={props.onOpenCopyPasteSettings}
            type="button"
          >
            <Settings aria-hidden="true" size={18} />
          </button>
          <div className="mx-1 h-5 w-px bg-editor-border" />
          <button
            aria-label={t('ui.bottomBar.tooltips.export')}
            className={iconButtonClassName}
            disabled={props.isExportDisabled}
            onClick={props.onExportClick}
            type="button"
          >
            <FileInput aria-hidden="true" size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function BottomBar(props: BottomBarProps) {
  return props.isLibraryView ? <LibraryBottomBar {...props} /> : <EditorBottomCommandBar {...props} />;
}
