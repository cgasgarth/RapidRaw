import cx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, ChevronUp, ClipboardPaste, Copy, FileInput, Filter, Settings, Star } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { useEditorStore } from '../../store/useEditorStore';
import { useLibraryStore } from '../../store/useLibraryStore';
import { COLOR_LABELS } from '../../utils/adjustments';
import { GLOBAL_KEYS, type ImageFile, type SelectedImage, type ThumbnailAspectRatio } from '../ui/AppProperties';
import { editorChromeStatusChipClassName } from '../ui/editorChromeTokens';
import UiText from '../ui/primitives/Text';
import Filmstrip from './Filmstrip';

interface BottomBarProps {
  filmstripHeight?: number;
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
  onZoomChange?: (zoomValue: number, fitToWindow?: boolean) => void;
  rating: number;
  selectedImage?: SelectedImage | undefined;
  setIsFilmstripVisible?: (isVisible: boolean) => void;
  showFilmstrip?: boolean;
  showZoomControls?: boolean;
  thumbnailAspectRatio: ThumbnailAspectRatio;
  totalImages?: number;
}

interface StarRatingProps {
  disabled: boolean;
  onRate: (rate: number) => void;
  rating: number;
}

const StarRating = ({ rating, onRate, disabled }: StarRatingProps) => {
  const { t } = useTranslation();

  return (
    <div
      aria-label={t('ui.bottomBar.tooltips.selectToRate')}
      className={cx(
        'flex h-8 items-center gap-0.5 rounded border border-editor-border bg-editor-panel-well px-1',
        disabled && 'cursor-not-allowed opacity-60',
      )}
      role="group"
    >
      {Array.from({ length: 5 }, (_, index) => {
        const starValue = index + 1;
        const isActive = starValue <= rating;
        return (
          <button
            aria-pressed={isActive}
            className="flex h-6 w-6 items-center justify-center rounded text-text-secondary transition-colors duration-150 hover:bg-editor-selected-quiet hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editor-focus-ring disabled:cursor-not-allowed disabled:hover:bg-transparent"
            disabled={disabled}
            key={starValue}
            onClick={() => {
              if (!disabled) {
                onRate(starValue === rating ? 0 : starValue);
              }
            }}
            data-tooltip={
              disabled
                ? t('ui.bottomBar.tooltips.selectToRate')
                : t('ui.bottomBar.tooltips.rateStars', { count: starValue })
            }
          >
            <Star
              size={18}
              className={cx(
                'transition-colors duration-150',
                disabled
                  ? 'text-text-secondary opacity-40'
                  : isActive
                    ? 'fill-accent text-accent'
                    : 'text-text-secondary hover:text-accent',
              )}
            />
          </button>
        );
      })}
    </div>
  );
};

export default function BottomBar({
  filmstripHeight,
  imageList = [],
  imageRatings,
  isCopied,
  isCopyDisabled,
  isExportDisabled,
  isFilmstripVisible,
  isLibraryView = false,
  isLoading = false,
  isPasted,
  isPasteDisabled,
  isRatingDisabled = false,
  isResizing,
  multiSelectedPaths = [],
  onClearSelection,
  onContextMenu,
  onCopy,
  onExportClick,
  onImageSelect,
  onOpenCopyPasteSettings,
  onRequestThumbnails,
  onPaste,
  onRate,
  onZoomChange = () => {},
  rating,
  selectedImage,
  setIsFilmstripVisible,
  showFilmstrip = true,
  showZoomControls = true,
  thumbnailAspectRatio,
  totalImages,
}: BottomBarProps) {
  const { t } = useTranslation();
  const { displaySize, originalSize } = useEditorStore(
    useShallow((state) => ({
      displaySize: state.displaySize,
      originalSize: state.originalSize,
    })),
  );

  const [isEditingPercent, setIsEditingPercent] = useState(false);
  const [percentInputValue, setPercentInputValue] = useState('');
  const isDraggingSlider = useRef(false);
  const [isZoomActive, setIsZoomActive] = useState(false);

  const percentInputRef = useRef<HTMLInputElement>(null);
  const [isZoomLabelHovered, setIsZoomLabelHovered] = useState(false);
  const isZoomReady = !isLoading && originalSize.width > 0 && displaySize.width > 0;

  const currentOriginalPercent = isZoomReady
    ? (displaySize.width * (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1)) / originalSize.width
    : 1.0;

  const [latchedSliderValue, setLatchedSliderValue] = useState(1.0);
  const [latchedDisplayPercent, setLatchedDisplayPercent] = useState(100);

  const numSelected = multiSelectedPaths.length;
  const total = totalImages ?? 0;
  const showSelectionCounter = numSelected > 1;
  const visibleFilmstripHeight = filmstripHeight ?? 0;
  const isCompactEditorBar = !isLibraryView && !showFilmstrip;
  const zoomFillPercent = `${Math.max(0, Math.min(100, ((latchedSliderValue - 0.1) / 1.9) * 100))}%`;
  const commandButtonClassName =
    'relative flex h-8 w-8 items-center justify-center rounded text-text-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editor-focus-ring disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent';
  const commandButtonIdleClassName =
    'hover:bg-editor-panel-raised hover:text-text-primary active:bg-editor-selected-quiet';
  const [isFilterExpanded, setIsFilterExpanded] = useState(false);
  const { filterCriteria, setFilterCriteria } = useLibraryStore(
    useShallow((state) => ({
      filterCriteria: state.filterCriteria,
      setFilterCriteria: state.setFilterCriteria,
    })),
  );
  const allColors = [...COLOR_LABELS, { name: 'none' as const, color: '#9ca3af' }];

  useEffect(() => {
    if (isZoomReady && !isDraggingSlider.current) {
      setLatchedSliderValue(currentOriginalPercent);
      setLatchedDisplayPercent(Math.round(currentOriginalPercent * 100));
    }
  }, [currentOriginalPercent, isZoomReady]);

  useEffect(() => {
    const handleDragEndGlobal = () => {
      if (isZoomActive) {
        setIsZoomActive(false);
        isDraggingSlider.current = false;
        if (isZoomReady) {
          setLatchedDisplayPercent(Math.round(currentOriginalPercent * 100));
        }
      }
    };

    if (isZoomActive) {
      window.addEventListener('mouseup', handleDragEndGlobal);
      window.addEventListener('touchend', handleDragEndGlobal);
    }

    return () => {
      window.removeEventListener('mouseup', handleDragEndGlobal);
      window.removeEventListener('touchend', handleDragEndGlobal);
    };
  }, [isZoomActive, isZoomReady, currentOriginalPercent]);

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newZoom = parseFloat(e.target.value);
    setLatchedSliderValue(newZoom);
    setLatchedDisplayPercent(Math.round(newZoom * 100));
    onZoomChange(newZoom);
  };

  const handleMouseDown = () => {
    isDraggingSlider.current = true;
    setIsZoomActive(true);
  };

  const handleMouseUp = () => {
    isDraggingSlider.current = false;
    setIsZoomActive(false);
    if (isZoomReady) {
      setLatchedDisplayPercent(Math.round(currentOriginalPercent * 100));
    }
  };

  const handleZoomKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && ['z', 'y'].includes(e.key.toLowerCase())) {
      (e.target as HTMLElement).blur();
      return;
    }
    if (GLOBAL_KEYS.includes(e.key)) {
      (e.target as HTMLElement).blur();
    }
  };

  const handleResetZoom = () => {
    onZoomChange(0, true);
  };

  const handlePercentClick = () => {
    if (!isZoomReady) return;
    setIsEditingPercent(true);
    setPercentInputValue(latchedDisplayPercent.toString());
    setTimeout(() => {
      percentInputRef.current?.focus();
      percentInputRef.current?.select();
    }, 0);
  };

  const handlePercentSubmit = () => {
    const value = parseFloat(percentInputValue);
    if (!Number.isNaN(value)) {
      const originalPercent = value / 100;
      const clampedPercent = Math.max(0.1, Math.min(2.0, originalPercent));
      onZoomChange(clampedPercent);
    }
    setIsEditingPercent(false);
    setPercentInputValue('');
  };

  const handlePercentKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handlePercentSubmit();
    else if (e.key === 'Escape') {
      setIsEditingPercent(false);
      setPercentInputValue('');
    }
    e.stopPropagation();
  };

  return (
    <div
      className={cx(
        'shrink-0 flex flex-col overflow-hidden rounded-lg border border-editor-border bg-editor-panel',
        isCompactEditorBar && 'rounded-none border-0',
      )}
      data-testid="editor-bottom-bar"
    >
      {!isLibraryView && showFilmstrip && (
        <div
          className={cx(
            'overflow-hidden bg-editor-panel-well',
            !isResizing && 'transition-all duration-300 ease-in-out',
          )}
          style={{ height: isFilmstripVisible ? `${visibleFilmstripHeight}px` : '0px' }}
        >
          <div className="w-full p-2" style={{ height: `${visibleFilmstripHeight}px` }}>
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
      )}

      <div
        className={cx(
          'shrink-0 flex items-center justify-between gap-2 px-2.5',
          isCompactEditorBar ? 'min-h-12 py-1.5' : 'h-10',
          !isLibraryView && 'border-t',
          !isLibraryView && showFilmstrip && isFilmstripVisible ? 'border-editor-border' : 'border-transparent',
        )}
      >
        <div className={cx('flex min-w-0 items-center', isCompactEditorBar ? 'gap-2 overflow-x-auto' : 'gap-2')}>
          <StarRating rating={rating} onRate={onRate} disabled={isRatingDisabled} />
          <div className={cx('h-5 w-px bg-editor-border', isCompactEditorBar && 'hidden')}></div>
          <div className="flex h-8 items-center gap-1 rounded border border-editor-border bg-editor-panel-well p-1">
            <button
              className={cx(commandButtonClassName, commandButtonIdleClassName)}
              disabled={isCopyDisabled}
              onClick={onCopy}
              data-tooltip={t('ui.bottomBar.tooltips.copySettings')}
            >
              <AnimatePresence mode="wait" initial={false}>
                {isCopied ? (
                  <motion.div
                    key="copied"
                    initial={{ opacity: 0, scale: 0.5 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.5 }}
                    transition={{ duration: 0.15 }}
                    className="absolute"
                  >
                    <Check size={18} className="text-green-500" />
                  </motion.div>
                ) : (
                  <motion.div
                    key="copy"
                    initial={{ opacity: 0, scale: 0.5 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.5 }}
                    transition={{ duration: 0.15 }}
                    className="absolute"
                  >
                    <Copy size={18} />
                  </motion.div>
                )}
              </AnimatePresence>
            </button>

            <button
              className={cx(commandButtonClassName, commandButtonIdleClassName)}
              disabled={isPasteDisabled}
              onClick={onPaste}
              data-tooltip={t('ui.bottomBar.tooltips.pasteSettings')}
            >
              <AnimatePresence mode="wait" initial={false}>
                {isPasted ? (
                  <motion.div
                    key="pasted"
                    initial={{ opacity: 0, scale: 0.5 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.5 }}
                    transition={{ duration: 0.15 }}
                    className="absolute"
                  >
                    <Check size={18} className="text-green-500" />
                  </motion.div>
                ) : (
                  <motion.div
                    key="paste"
                    initial={{ opacity: 0, scale: 0.5 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.5 }}
                    transition={{ duration: 0.15 }}
                    className="absolute"
                  >
                    <ClipboardPaste size={18} />
                  </motion.div>
                )}
              </AnimatePresence>
            </button>

            <button
              className={cx(commandButtonClassName, commandButtonIdleClassName)}
              onClick={onOpenCopyPasteSettings}
              data-tooltip={t('ui.bottomBar.tooltips.copyPasteSettings')}
            >
              <Settings size={18} />
            </button>
          </div>
          {!isCompactEditorBar && (
            <>
              <div className="h-5 w-px bg-editor-border"></div>
              <div
                className={cx(
                  'flex h-8 items-center rounded border border-transparent transition-all duration-300',
                  isFilterExpanded ? 'border-editor-border bg-editor-panel-well' : 'bg-transparent',
                )}
              >
                <button
                  className={cx(
                    'relative w-8 h-8 flex items-center justify-center rounded transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editor-focus-ring',
                    isFilterExpanded
                      ? 'text-text-primary'
                      : 'text-text-secondary hover:bg-editor-selected-quiet hover:text-text-primary',
                  )}
                  onClick={() => {
                    setIsFilterExpanded((value) => !value);
                  }}
                  data-tooltip={t('ui.bottomBar.tooltips.quickFilter')}
                >
                  <Filter size={18} />
                </button>
                <div
                  className={cx(
                    'flex items-center transition-all duration-300 ease-in-out overflow-hidden',
                    isFilterExpanded ? 'max-w-100 opacity-100 pr-2 ml-1' : 'max-w-0 opacity-0 pr-0 ml-0',
                  )}
                >
                  <div className="flex items-center gap-3 whitespace-nowrap">
                    <div className="flex items-center gap-0.5">
                      {[1, 2, 3, 4, 5].map((starValue) => {
                        const isFilled = filterCriteria.rating > 0 && starValue <= filterCriteria.rating;
                        return (
                          <button
                            key={`qf-star-${starValue}`}
                            aria-label={t('library.header.viewOptions.filterByRating', { rating: starValue })}
                            onClick={() => {
                              setFilterCriteria((prev) => ({
                                ...prev,
                                rating: prev.rating === starValue ? 0 : starValue,
                              }));
                            }}
                            className="p-0.5 focus:outline-none"
                          >
                            <Star
                              size={16}
                              className={cx(
                                'transition-colors duration-150',
                                isFilled ? 'text-accent fill-accent' : 'text-text-secondary hover:text-accent',
                              )}
                            />
                          </button>
                        );
                      })}
                    </div>
                    <div className="h-4 w-px bg-editor-border"></div>
                    <div className="flex items-center gap-1.5">
                      {allColors.map((color) => {
                        const isSelected = filterCriteria.colors.includes(color.name);
                        const tooltipTitle =
                          color.name === 'none'
                            ? t('library.header.viewOptions.noLabel')
                            : t(`contextMenus.colors.${color.name}`, {
                                defaultValue: color.name.charAt(0).toUpperCase() + color.name.slice(1),
                              });

                        return (
                          <button
                            key={`qf-color-${color.name}`}
                            aria-label={t('library.header.viewOptions.filterByColorLabel', {
                              color: tooltipTitle,
                            })}
                            onClick={() => {
                              const currentColors = filterCriteria.colors;
                              const nextColors = currentColors.includes(color.name)
                                ? currentColors.filter((name) => name !== color.name)
                                : [...currentColors, color.name];
                              setFilterCriteria((prev) => ({ ...prev, colors: nextColors }));
                            }}
                            className={cx(
                              'w-4 h-4 rounded-full transition-transform hover:scale-105 flex items-center justify-center focus:outline-none',
                              isSelected ? 'ring-2 ring-accent ring-offset-1 ring-offset-editor-panel' : '',
                            )}
                            style={{ backgroundColor: color.color }}
                            data-tooltip={tooltipTitle}
                          >
                            {isSelected && <Check size={10} className="text-white drop-shadow-md" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
          <div
            className={cx(
              'flex items-center transition-all duration-300 ease-out overflow-hidden',
              showSelectionCounter ? 'max-w-xs opacity-100' : 'max-w-0 opacity-0',
            )}
          >
            <div className="h-5 w-px bg-editor-border mr-2"></div>
            <UiText as="span" className={cx(editorChromeStatusChipClassName('info'), 'whitespace-nowrap')}>
              {t('ui.bottomBar.imagesSelected', { current: numSelected, total })}
            </UiText>
          </div>
        </div>
        <div className="grow" />
        {isLibraryView ? (
          <div className="flex items-center gap-2">
            <button
              className="w-8 h-8 flex items-center justify-center rounded-md text-text-secondary hover:bg-editor-selected-quiet hover:text-text-primary transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed"
              disabled={isExportDisabled}
              onClick={onExportClick}
              data-tooltip={t('ui.bottomBar.tooltips.export')}
            >
              <FileInput size={18} />
            </button>
          </div>
        ) : showZoomControls ? (
          <div className={cx('flex shrink-0 items-center gap-2')}>
            <div
              className={cx(
                'flex h-8 items-center gap-2 rounded border border-editor-border bg-editor-panel-well px-2',
                !isZoomReady && 'opacity-50',
              )}
              data-testid="editor-bottom-bar-zoom"
              style={{ width: isCompactEditorBar ? '9rem' : '14rem' }}
            >
              <button
                type="button"
                className="relative flex h-6 w-12 cursor-pointer items-center justify-end rounded bg-transparent p-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editor-focus-ring disabled:cursor-not-allowed disabled:text-editor-disabled"
                disabled={!isZoomReady}
                onClick={handleResetZoom}
                onMouseEnter={() => {
                  setIsZoomLabelHovered(true);
                }}
                onMouseLeave={() => {
                  setIsZoomLabelHovered(false);
                }}
                data-tooltip={t('ui.bottomBar.tooltips.resetZoom')}
              >
                <span className="absolute right-0 w-max select-none text-right text-[11px] font-medium leading-4 text-text-secondary transition-colors hover:text-text-primary">
                  {isZoomLabelHovered ? t('ui.bottomBar.zoomLabelReset') : t('ui.bottomBar.zoomLabel')}
                </span>
              </button>

              <div className="relative flex-1 h-5">
                <div className="absolute top-1/2 left-0 w-full h-1.5 -translate-y-1/2 bg-editor-panel-raised rounded-full pointer-events-none" />
                <div
                  className="absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full pointer-events-none"
                  style={{ background: 'var(--editor-primary-active)', width: zoomFillPercent }}
                />
                <input
                  type="range"
                  min={0.1}
                  max={2.0}
                  step="0.05"
                  aria-label={t('ui.bottomBar.tooltips.customZoom')}
                  data-testid="editor-bottom-bar-zoom-slider"
                  disabled={!isZoomReady}
                  value={latchedSliderValue}
                  onChange={handleSliderChange}
                  onKeyDown={handleZoomKeyDown}
                  onMouseDown={handleMouseDown}
                  onMouseUp={handleMouseUp}
                  onTouchStart={handleMouseDown}
                  onTouchEnd={handleMouseUp}
                  onDoubleClick={handleResetZoom}
                  className={`absolute top-1/2 left-0 w-full h-1.5 mt-[-1.5px] appearance-none bg-transparent cursor-pointer p-0 slider-input z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editor-focus-ring disabled:cursor-not-allowed ${
                    isZoomActive ? 'slider-thumb-active' : ''
                  }`}
                />
              </div>

              <div
                className="relative text-xs text-text-secondary text-right flex items-center justify-end h-5 gap-1"
                style={{ width: 44 }}
              >
                {isEditingPercent ? (
                  <input
                    ref={percentInputRef}
                    type="text"
                    value={percentInputValue}
                    onChange={(e) => {
                      setPercentInputValue(e.target.value);
                    }}
                    onKeyDown={handlePercentKeyDown}
                    onBlur={handlePercentSubmit}
                    className="w-full rounded-sm border border-editor-border bg-editor-panel-raised px-1 text-right font-mono text-xs tabular-nums text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-editor-focus-ring"
                    style={{ fontSize: '12px', height: '18px' }}
                  />
                ) : (
                  <button
                    type="button"
                    disabled={!isZoomReady}
                    onClick={handlePercentClick}
                    className="cursor-pointer select-none rounded bg-transparent p-0 text-right font-mono text-xs tabular-nums text-text-secondary transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-editor-focus-ring disabled:cursor-not-allowed disabled:text-editor-disabled"
                    style={{ width: 44 }}
                    data-tooltip={t('ui.bottomBar.tooltips.customZoom')}
                  >
                    {latchedDisplayPercent}%
                  </button>
                )}
              </div>
            </div>
            {showFilmstrip && (
              <>
                <div className="h-5 w-px bg-editor-border"></div>
                <button
                  className={cx(
                    'p-1.5 rounded border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editor-focus-ring',
                    isFilmstripVisible
                      ? 'border-editor-border bg-editor-panel-well text-text-primary'
                      : 'border-transparent text-text-secondary hover:bg-editor-selected-quiet hover:text-text-primary',
                  )}
                  onClick={() => setIsFilmstripVisible?.(!isFilmstripVisible)}
                  data-tooltip={
                    isFilmstripVisible
                      ? t('ui.bottomBar.tooltips.collapseFilmstrip')
                      : t('ui.bottomBar.tooltips.expandFilmstrip')
                  }
                >
                  {isFilmstripVisible ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                </button>
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
