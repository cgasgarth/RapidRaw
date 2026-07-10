import cx from 'clsx';
import { AlertTriangle, Image as ImageIcon, SlidersHorizontal, Star, X } from 'lucide-react';
import type React from 'react';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Grid, useGridCallbackRef } from 'react-window';
import { useProcessStore } from '../../store/useProcessStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { TextColors, TextVariants, TextWeights } from '../../types/typography';
import { COLOR_LABELS, type Color } from '../../utils/adjustments';
import { buildRawQualityBadges, formatRawQualityBadgeTooltip } from '../../utils/rawQualityBadges';
import { type ImageFile, type SelectedImage, ThumbnailAspectRatio } from '../ui/AppProperties';
import UiText from '../ui/primitives/Text';
import {
  FILMSTRIP_THUMBNAIL_DECODE_TIMEOUT_MS,
  FILMSTRIP_THUMBNAIL_HANDOFF_DURATION_MS,
  filmstripThumbnailReadiness,
} from './filmstripThumbnailLifecycle';

const HORIZONTAL_PADDING = 4;
const ITEM_GAP = 8;
const THUMBNAIL_FOCUS_CLASS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editor-focus-ring focus-visible:ring-offset-1 focus-visible:ring-offset-editor-panel-well';
const FILMSTRIP_SUMMARY_HEIGHT = 30;

interface ImageLayer {
  binding: ThumbnailBinding;
  phase: 'pending' | 'ready' | 'handoff' | 'settled';
  url: string;
  opacity: number;
}

interface ThumbnailBinding {
  generation: number;
  path: string;
  url: string | undefined;
}

type ThumbnailFailure = 'decode' | 'error' | 'timeout';

type ImageRatings = Record<string, number> | null | undefined;
type ThumbnailMouseEvent = React.MouseEvent<HTMLDivElement>;
type ThumbnailKeyboardEvent = React.KeyboardEvent<HTMLDivElement>;
type ThumbnailSelectEvent = ThumbnailMouseEvent | ThumbnailKeyboardEvent;

interface ItemData {
  activeIndex: number;
  imageList: ImageFile[];
  imageRatings: ImageRatings;
  selectedPath: string | undefined;
  multiSelectedPaths: string[];
  selectedImageThumbnailUrl?: string | undefined;
  thumbnailAspectRatio: ThumbnailAspectRatio;
  onRequestThumbnails?: ((paths: string[]) => void) | undefined;
  onContextMenu?: ((event: ThumbnailMouseEvent, path: string) => void) | undefined;
  onImageSelect?: ((path: string, event: ThumbnailSelectEvent) => void) | undefined;
  itemHeight: number;
  consumeClickTriggeredScroll: () => boolean;
  onRegisterThumbnail: (path: string, element: HTMLDivElement | null) => void;
  onThumbnailRovingKeyDown: (event: ThumbnailKeyboardEvent, index: number) => void;
}

interface FilmstripThumbnailProps {
  imageFile: ImageFile;
  imageRatings: ImageRatings;
  isActive: boolean;
  isSelected: boolean;
  onContextMenu?: ((event: ThumbnailMouseEvent, path: string) => void) | undefined;
  onImageSelect?: ((path: string, event: ThumbnailSelectEvent) => void) | undefined;
  onRegisterThumbnail: (path: string, element: HTMLDivElement | null) => void;
  onThumbnailRovingKeyDown: (event: ThumbnailKeyboardEvent, index: number) => void;
  selectedImageThumbnailUrl?: string | undefined;
  tabIndex: 0 | -1;
  thumbnailAspectRatio: ThumbnailAspectRatio;
  index: number;
}

type FilmstripCellData = ItemData;

const getFilmstripFilename = (path: string): string => {
  const cleanPath = path.split('?')[0] ?? path;
  return cleanPath.split(/[\\/]/u).pop() || cleanPath;
};

const getFilmstripColorLabel = (tags: ImageFile['tags']) => {
  const colorTag = tags?.find((tag: string) => tag.startsWith('color:'))?.substring(6);
  return COLOR_LABELS.find((color: Color) => color.name === colorTag);
};

const isSameBinding = (left: ThumbnailBinding, right: ThumbnailBinding) =>
  left.generation === right.generation && left.path === right.path && left.url === right.url;

const createImageLayer = (binding: ThumbnailBinding, isSettled: boolean): ImageLayer => {
  if (!binding.url) throw new Error('Filmstrip thumbnail layers require a URL.');

  return {
    binding,
    opacity: isSettled ? 1 : 0,
    phase: isSettled ? 'settled' : 'pending',
    url: binding.url,
  };
};

const useReducedMotion = () => {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mediaQuery) return undefined;

    const updateReducedMotion = () => {
      setReducedMotion(mediaQuery.matches);
    };

    updateReducedMotion();
    mediaQuery.addEventListener('change', updateReducedMotion);
    return () => {
      mediaQuery.removeEventListener('change', updateReducedMotion);
    };
  }, []);

  return reducedMotion;
};

export const resolveFilmstripThumbnailUrl = (
  thumbnailUrl: string | undefined,
  selectedImageThumbnailUrl: string | undefined,
  isActive: boolean,
) => thumbnailUrl ?? (isActive ? selectedImageThumbnailUrl : undefined);

export const getFilmstripColumnWidth = (itemHeight: number) => itemHeight + ITEM_GAP;

interface FilmstripCellProps extends FilmstripCellData {
  columnIndex: number;
  rowIndex: number;
  style: React.CSSProperties;
}

const FilmstripRawQualityBadges = ({ exif }: { exif: ImageFile['exif'] }) => {
  const badges = useMemo(() => buildRawQualityBadges(exif), [exif]);
  if (badges.length === 0) return null;

  return (
    <div
      className="absolute bottom-1 left-1 z-10 flex items-center gap-1"
      data-raw-quality-badge-count={badges.length}
      data-testid="filmstrip-raw-quality-badges"
      data-tooltip={formatRawQualityBadgeTooltip(badges)}
    >
      {badges.map((badge) => (
        <span
          key={badge.code}
          className={cx(
            'inline-flex h-4 items-center gap-0.5 rounded-sm border bg-black/75 px-1 text-[9px] font-semibold leading-none',
            badge.severity === 'warning' ? 'border-amber-300/60 text-amber-100' : 'border-sky-300/50 text-sky-100',
          )}
          data-raw-quality-badge-code={badge.code}
          data-raw-quality-badge-detail={badge.detail}
          data-raw-quality-badge-severity={badge.severity}
        >
          {badge.severity === 'warning' ? <AlertTriangle className="shrink-0" size={11} /> : null}
          <span>{badge.label}</span>
        </span>
      ))}
    </div>
  );
};

export const FilmstripThumbnail = memo(
  ({
    imageFile,
    imageRatings,
    isActive,
    isSelected,
    onContextMenu,
    onImageSelect,
    onRegisterThumbnail,
    onThumbnailRovingKeyDown,
    selectedImageThumbnailUrl,
    tabIndex,
    thumbnailAspectRatio,
    index,
  }: FilmstripThumbnailProps) => {
    const { t } = useTranslation();
    const thumbData = useProcessStore((s) => s.thumbnails[imageFile.path]);
    const displayThumbnailUrl = resolveFilmstripThumbnailUrl(thumbData, selectedImageThumbnailUrl, isActive);
    const { path, tags, is_edited: isEdited } = imageFile;

    const bindingRef = useRef<ThumbnailBinding>({ generation: 0, path, url: displayThumbnailUrl });
    const previousBinding = bindingRef.current;
    if (previousBinding.path !== path || previousBinding.url !== displayThumbnailUrl) {
      bindingRef.current = { generation: previousBinding.generation + 1, path, url: displayThumbnailUrl };
    }
    const binding = bindingRef.current;

    const [layers, setLayers] = useState<ImageLayer[]>(() =>
      binding.url ? [createImageLayer(binding, filmstripThumbnailReadiness.has(binding.path, binding.url))] : [],
    );
    const decodingGenerationRef = useRef<number | null>(null);
    const reducedMotion = useReducedMotion();

    const visibleLayers = layers.filter((layer) => layer.binding.path === path);
    const rating = imageRatings?.[path] || 0;
    const colorLabel = getFilmstripColorLabel(tags);
    const isVirtualCopy = path.includes('?vc=');
    const displayEditIcon = useSettingsStore((s) => s.appSettings?.displayEditIcon ?? true);
    const showEditIcon = isEdited && displayEditIcon;

    const hasEditIcon = showEditIcon;
    const hasColorLabel = !!colorLabel;
    const hasRating = rating > 0;
    const hasAnyOverlay = hasEditIcon || hasColorLabel || hasRating;

    const filename = getFilmstripFilename(path);

    const truncatedTitle =
      filename.length > 40 ? `${filename.substring(0, 20)}...${filename.substring(filename.length - 17)}` : filename;
    const accessibleMetadata = [
      hasEditIcon ? t('ui.filmstrip.selectionSummary.badges.edited') : null,
      colorLabel ? `${t('ui.filmstrip.selectionSummary.badges.color')}: ${colorLabel.name}` : null,
      hasRating ? `${t('ui.filmstrip.selectionSummary.badges.rating')}: ${rating}` : null,
      isVirtualCopy ? t('ui.filmstrip.tooltips.virtualCopy') : null,
    ].filter((label): label is string => label !== null);
    const accessibleLabel = [truncatedTitle, ...accessibleMetadata].join(', ');

    const isCurrentBinding = useCallback(
      (candidate: ThumbnailBinding) => isSameBinding(bindingRef.current, candidate),
      [],
    );

    useLayoutEffect(() => {
      setLayers((previousLayers) => {
        const samePathLayers = previousLayers.filter((layer) => layer.binding.path === binding.path);
        if (!binding.url) return samePathLayers.length === 0 ? previousLayers : [];

        const target = samePathLayers.find((layer) => isSameBinding(layer.binding, binding));
        if (target) {
          const predecessor = samePathLayers.find(
            (layer) => !isSameBinding(layer.binding, binding) && layer.opacity === 1,
          );
          const nextLayers = predecessor ? [predecessor, target] : [target];
          return nextLayers.length === previousLayers.length &&
            nextLayers.every((layer, index) => layer === previousLayers[index])
            ? previousLayers
            : nextLayers;
        }

        const predecessor = samePathLayers.find((layer) => layer.opacity === 1);
        const targetStartsSettled =
          predecessor === undefined && filmstripThumbnailReadiness.has(binding.path, binding.url);
        return [...(predecessor ? [predecessor] : []), createImageLayer(binding, targetStartsSettled)];
      });
    }, [binding]);

    const handleLayerFailure = useCallback(
      (candidate: ThumbnailBinding, _failure: ThumbnailFailure) => {
        if (!isCurrentBinding(candidate)) return;

        setLayers((previousLayers) => {
          const target = previousLayers.find((layer) => isSameBinding(layer.binding, candidate));
          if (!target) return previousLayers;
          return previousLayers.filter((layer) => !isSameBinding(layer.binding, candidate));
        });
      },
      [isCurrentBinding],
    );

    const handleLayerDecoded = useCallback(
      (candidate: ThumbnailBinding) => {
        if (!candidate.url || !isCurrentBinding(candidate)) return;

        filmstripThumbnailReadiness.markDecoded(candidate.path, candidate.url);
        setLayers((previousLayers) =>
          previousLayers.map((layer) =>
            isSameBinding(layer.binding, candidate) && layer.phase === 'pending' ? { ...layer, phase: 'ready' } : layer,
          ),
        );
      },
      [isCurrentBinding],
    );

    const handleLayerLoad = useCallback(
      (candidate: ThumbnailBinding, element: HTMLImageElement) => {
        if (!isCurrentBinding(candidate)) return;

        if (decodingGenerationRef.current === candidate.generation) return;
        decodingGenerationRef.current = candidate.generation;

        let decodePromise: Promise<void>;
        try {
          decodePromise = typeof element.decode === 'function' ? element.decode() : Promise.resolve();
        } catch {
          handleLayerFailure(candidate, 'decode');
          return;
        }

        void decodePromise.then(
          () => handleLayerDecoded(candidate),
          () => handleLayerFailure(candidate, 'decode'),
        );
      },
      [handleLayerDecoded, handleLayerFailure, isCurrentBinding],
    );

    useEffect(() => {
      const pendingLayer = visibleLayers.find((layer) => layer.phase === 'pending' && isCurrentBinding(layer.binding));
      if (!pendingLayer) return undefined;

      const timeout = window.setTimeout(() => {
        handleLayerFailure(pendingLayer.binding, 'timeout');
      }, FILMSTRIP_THUMBNAIL_DECODE_TIMEOUT_MS);
      return () => {
        window.clearTimeout(timeout);
      };
    }, [handleLayerFailure, isCurrentBinding, visibleLayers]);

    useEffect(() => {
      const readyLayer = visibleLayers.find((layer) => layer.phase === 'ready' && isCurrentBinding(layer.binding));
      if (!readyLayer) return undefined;

      const frame = requestAnimationFrame(() => {
        if (!isCurrentBinding(readyLayer.binding)) return;

        setLayers((previousLayers) => {
          const target = previousLayers.find((layer) => isSameBinding(layer.binding, readyLayer.binding));
          if (!target || target.phase !== 'ready') return previousLayers;

          const hasPredecessor = previousLayers.some(
            (layer) =>
              layer.binding.path === readyLayer.binding.path && !isSameBinding(layer.binding, readyLayer.binding),
          );
          return previousLayers.map((layer) =>
            isSameBinding(layer.binding, readyLayer.binding)
              ? { ...layer, opacity: 1, phase: hasPredecessor ? 'handoff' : 'settled' }
              : layer,
          );
        });
      });
      return () => {
        cancelAnimationFrame(frame);
      };
    }, [isCurrentBinding, visibleLayers]);

    const retireHandoff = useCallback(
      (candidate: ThumbnailBinding) => {
        if (!isCurrentBinding(candidate)) return;

        setLayers((previousLayers) => {
          const target = previousLayers.find((layer) => isSameBinding(layer.binding, candidate));
          if (!target || target.phase !== 'handoff') return previousLayers;
          return [{ ...target, phase: 'settled' }];
        });
      },
      [isCurrentBinding],
    );

    const handleTransitionEnd = useCallback(
      (event: React.TransitionEvent<HTMLDivElement>, candidate: ThumbnailBinding) => {
        if (event.target !== event.currentTarget || event.propertyName !== 'opacity') return;
        retireHandoff(candidate);
      },
      [retireHandoff],
    );

    useEffect(() => {
      const handoffLayer = visibleLayers.find((layer) => layer.phase === 'handoff' && isCurrentBinding(layer.binding));
      if (!handoffLayer) return undefined;

      if (reducedMotion) {
        const frame = requestAnimationFrame(() => {
          retireHandoff(handoffLayer.binding);
        });
        return () => {
          cancelAnimationFrame(frame);
        };
      }

      const retirementTimeout = window.setTimeout(() => {
        retireHandoff(handoffLayer.binding);
      }, FILMSTRIP_THUMBNAIL_HANDOFF_DURATION_MS + 50);
      return () => {
        window.clearTimeout(retirementTimeout);
      };
    }, [isCurrentBinding, reducedMotion, retireHandoff, visibleLayers]);

    const selectionClass = isActive
      ? 'border-editor-primary-active bg-editor-selected-quiet ring-1 ring-inset ring-editor-primary-active'
      : isSelected
        ? 'border-editor-focus-ring bg-editor-selected-quiet ring-1 ring-inset ring-editor-focus-ring/70'
        : 'border-editor-border hover:border-editor-focus-ring hover:bg-editor-panel-raised';

    const thumbnailState = isActive ? 'current' : isSelected ? 'selected' : 'idle';
    const handleSelect = (event: ThumbnailMouseEvent | ThumbnailKeyboardEvent) => {
      event.stopPropagation();
      onImageSelect?.(path, event);
    };

    const registerThumbnail = useCallback(
      (element: HTMLDivElement | null) => {
        onRegisterThumbnail(path, element);
      },
      [onRegisterThumbnail, path],
    );

    const handleKeyDown = (event: ThumbnailKeyboardEvent) => {
      onThumbnailRovingKeyDown(event, index);
      if (event.defaultPrevented) return;
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      handleSelect(event);
    };

    return (
      <div
        className={cx(
          'group relative h-full w-full shrink-0 cursor-pointer overflow-hidden rounded-sm border bg-editor-panel-well transition-colors duration-100 motion-reduce:transition-none',
          selectionClass,
          THUMBNAIL_FOCUS_CLASS,
        )}
        aria-current={isActive ? 'true' : undefined}
        aria-label={accessibleLabel}
        aria-selected={isSelected}
        onClick={handleSelect}
        onContextMenu={(e: ThumbnailMouseEvent) => onContextMenu?.(e, path)}
        onKeyDown={handleKeyDown}
        ref={registerThumbnail}
        role="option"
        tabIndex={tabIndex}
        style={{
          zIndex: isActive ? 2 : isSelected ? 1 : 'auto',
        }}
        data-image-path={path}
        data-filmstrip-state={thumbnailState}
        data-thumbnail-availability={visibleLayers.some((layer) => layer.opacity === 1) ? 'ready' : 'loading'}
        data-tooltip={truncatedTitle}
        data-testid="filmstrip-thumbnail"
      >
        {isActive ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 z-20 h-0.5 bg-editor-primary-active"
            data-testid="filmstrip-current-marker"
          />
        ) : null}
        {visibleLayers.length > 0 ? (
          <div
            className="absolute inset-[3px] overflow-hidden rounded-[1px] bg-black"
            data-testid="filmstrip-image-well"
          >
            {visibleLayers.map((layer) => (
              <div
                key={layer.binding.generation}
                className="absolute inset-0 w-full h-full"
                style={{
                  opacity: layer.opacity,
                  transition: reducedMotion
                    ? 'none'
                    : `opacity ${FILMSTRIP_THUMBNAIL_HANDOFF_DURATION_MS}ms ease-in-out`,
                  willChange: layer.phase === 'handoff' ? 'opacity' : undefined,
                }}
                onTransitionEnd={(event) => {
                  handleTransitionEnd(event, layer.binding);
                }}
              >
                <img
                  alt={truncatedTitle}
                  className={cx(
                    'relative h-full w-full',
                    thumbnailAspectRatio === ThumbnailAspectRatio.Contain ? 'object-contain' : 'object-cover',
                  )}
                  data-testid="filmstrip-thumbnail-image"
                  decoding="async"
                  loading="eager"
                  onError={() => {
                    handleLayerFailure(layer.binding, 'error');
                  }}
                  onLoad={(event) => {
                    handleLayerLoad(layer.binding, event.currentTarget);
                  }}
                  src={layer.url}
                />
              </div>
            ))}
          </div>
        ) : null}
        {!visibleLayers.some((layer) => layer.opacity === 1) ? (
          <div className="absolute inset-[3px] flex items-center justify-center border border-dashed border-editor-border bg-editor-panel">
            <ImageIcon
              data-testid="filmstrip-thumbnail-placeholder"
              size={24}
              className="animate-pulse text-text-secondary motion-reduce:animate-none"
            />
          </div>
        ) : null}

        <div
          className={cx(
            'absolute right-1 top-1 z-10 grid h-5 grid-cols-[14px_14px_28px] items-center gap-0.5 rounded-sm bg-black/70 px-0.5 transition-opacity duration-100 motion-reduce:transition-none',
            hasAnyOverlay ? 'opacity-100' : 'opacity-0',
          )}
          data-testid="filmstrip-metadata-rail"
        >
          <div className="flex h-4 w-3.5 items-center justify-center">
            <div
              className={cx(
                'flex items-center justify-center text-white transition-opacity duration-100 motion-reduce:transition-none',
                hasEditIcon ? 'opacity-100' : 'opacity-0',
              )}
              aria-hidden={!hasEditIcon}
              data-tooltip={hasEditIcon ? t('ui.filmstrip.selectionSummary.badges.edited') : undefined}
              data-testid={hasEditIcon ? 'filmstrip-edit-badge' : undefined}
            >
              <SlidersHorizontal size={12} />
            </div>
          </div>

          <div className="flex h-4 w-3.5 items-center justify-center">
            <div
              className={cx(
                'h-2.5 w-2.5 rounded-[1px] border border-white/70 transition-opacity duration-100 motion-reduce:transition-none',
                hasColorLabel ? 'opacity-100' : 'opacity-0',
              )}
              aria-hidden={!hasColorLabel}
              data-tooltip={colorLabel?.name}
              style={{ backgroundColor: colorLabel ? colorLabel.color : 'transparent' }}
              data-testid={hasColorLabel ? 'filmstrip-color-tag-badge' : undefined}
            />
          </div>

          <div className="flex h-4 w-7 items-center justify-end">
            <div
              className={cx(
                'flex items-center gap-0.5 text-white transition-opacity duration-100 motion-reduce:transition-none',
                hasRating ? 'opacity-100' : 'opacity-0',
              )}
              aria-hidden={!hasRating}
              data-tooltip={hasRating ? `${t('ui.filmstrip.selectionSummary.badges.rating')}: ${rating}` : undefined}
              data-testid={hasRating ? 'filmstrip-rating-badge' : undefined}
            >
              <span className="text-[10px] font-semibold leading-none">{rating}</span>
              <Star aria-hidden="true" size={10} className="fill-white text-white" />
            </div>
          </div>
        </div>

        {isVirtualCopy && (
          <div className="absolute bottom-1 right-1 z-10">
            <UiText
              as="div"
              variant={TextVariants.small}
              color={TextColors.white}
              weight={TextWeights.bold}
              className="rounded-sm border border-white/30 bg-black/75 px-1 py-0.5 text-[9px] leading-none"
              data-tooltip={t('ui.filmstrip.tooltips.virtualCopy')}
            >
              {t('ui.filmstrip.virtualCopyAbbreviation')}
            </UiText>
          </div>
        )}
        <FilmstripRawQualityBadges exif={imageFile.exif} />
      </div>
    );
  },
);

FilmstripThumbnail.displayName = 'FilmstripThumbnail';

const FilmstripCell = ({
  activeIndex,
  columnIndex,
  style,
  imageList,
  imageRatings,
  selectedPath,
  multiSelectedPaths,
  selectedImageThumbnailUrl,
  thumbnailAspectRatio,
  onContextMenu,
  onImageSelect,
  onRegisterThumbnail,
  onThumbnailRovingKeyDown,
  itemHeight,
}: FilmstripCellProps) => {
  const imageFile = imageList[columnIndex];
  if (!imageFile) {
    return null;
  }

  const fullWidth = style.width as number;
  const contentWidth = fullWidth - ITEM_GAP;

  return (
    <div
      style={{
        ...style,
        height: '100%',
        left: (style.left as number) + HORIZONTAL_PADDING,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-start',
      }}
    >
      <div style={{ width: contentWidth, height: itemHeight }}>
        <FilmstripThumbnail
          key={imageFile.path}
          imageFile={imageFile}
          imageRatings={imageRatings}
          isActive={selectedPath === imageFile.path}
          isSelected={multiSelectedPaths.includes(imageFile.path)}
          onContextMenu={onContextMenu}
          onImageSelect={onImageSelect}
          onRegisterThumbnail={onRegisterThumbnail}
          onThumbnailRovingKeyDown={onThumbnailRovingKeyDown}
          selectedImageThumbnailUrl={selectedImageThumbnailUrl}
          tabIndex={activeIndex === columnIndex ? 0 : -1}
          thumbnailAspectRatio={thumbnailAspectRatio}
          index={columnIndex}
        />
      </div>
    </div>
  );
};

const FilmstripList = ({
  height,
  width,
  data,
}: {
  height: number;
  width: number;
  data: Omit<ItemData, 'activeIndex' | 'itemHeight' | 'onRegisterThumbnail' | 'onThumbnailRovingKeyDown'>;
}) => {
  const [gridHandle, setGridHandle] = useGridCallbackRef();
  const visibleRange = useRef({ start: 0, stop: 0 });
  const prevSelectedPath = useRef<string | null>(null);
  const isReadyForSmooth = useRef(false);
  const resizeEndTimer = useRef<number | null>(null);
  const currentDataRef = useRef(data);
  currentDataRef.current = data;
  const isAnimatingScroll = useRef(false);
  const scrollAnimationTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingScrollTarget = useRef<number | null>(null);
  const hasCompletedInitialScroll = useRef(false);
  const thumbnailElements = useRef(new Map<string, HTMLDivElement>());
  const pendingFocusPath = useRef<string | null>(null);

  const selectedIndex = useMemo(() => {
    if (!data.selectedPath) return -1;
    return data.imageList.findIndex((image) => image.path === data.selectedPath);
  }, [data.imageList, data.selectedPath]);
  const activeIndex = selectedIndex >= 0 ? selectedIndex : 0;

  const itemHeight = useMemo(() => {
    const baseHeight = Math.max(20, height - 20);
    const expandedHeight = Math.max(20, height - 8);

    const totalWidthExpanded = HORIZONTAL_PADDING * 2 + data.imageList.length * (expandedHeight + ITEM_GAP);

    if (totalWidthExpanded <= width) {
      return expandedHeight;
    }
    return baseHeight;
  }, [data.imageList.length, height, width]);
  const columnWidth = getFilmstripColumnWidth(itemHeight);

  useEffect(() => {
    isReadyForSmooth.current = false;
    const timer = setTimeout(() => {
      isReadyForSmooth.current = true;
    }, 500);
    return () => {
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!isReadyForSmooth.current) {
      return;
    }

    if (resizeEndTimer.current) clearTimeout(resizeEndTimer.current);

    resizeEndTimer.current = window.setTimeout(() => {
      const { selectedPath, imageList, multiSelectedPaths } = currentDataRef.current;

      if (selectedPath && gridHandle && multiSelectedPaths.length <= 1) {
        const index = imageList.findIndex((img) => img.path === selectedPath);
        if (index !== -1) {
          gridHandle.scrollToColumn({ index, align: 'center', behavior: 'smooth' });
        }
      }
    }, 500);

    return () => {
      if (resizeEndTimer.current) clearTimeout(resizeEndTimer.current);
    };
  }, [height, gridHandle]);

  useEffect(() => {
    return () => {
      if (scrollAnimationTimeout.current) {
        clearTimeout(scrollAnimationTimeout.current);
      }
    };
  }, []);

  const onCellsRendered = useCallback(
    (
      visibleCells: { columnStartIndex: number; columnStopIndex: number; rowStartIndex: number; rowStopIndex: number },
      allCells: { columnStartIndex: number; columnStopIndex: number; rowStartIndex: number; rowStopIndex: number },
    ) => {
      visibleRange.current = {
        start: visibleCells.columnStartIndex,
        stop: visibleCells.columnStopIndex,
      };

      const currentData = currentDataRef.current;
      if (!currentData.onRequestThumbnails) return;

      const cached = useProcessStore.getState().thumbnails;
      const pathsToRequest: string[] = [];

      for (let i = allCells.columnStartIndex; i <= allCells.columnStopIndex; i++) {
        const img = currentData.imageList[i];
        if (img && !cached[img.path]) {
          pathsToRequest.push(img.path);
        }
      }

      if (pathsToRequest.length > 0) {
        currentData.onRequestThumbnails(pathsToRequest);
      }
    },
    [],
  );

  const isItemVisible = useCallback((index: number) => {
    const { start, stop } = visibleRange.current;
    return index > start && index < stop;
  }, []);

  const performSafeScroll = useCallback(
    function performSafeScroll(index: number, bypassLock = false) {
      if (!gridHandle) return;

      if (!bypassLock && isAnimatingScroll.current) {
        pendingScrollTarget.current = index;
        return;
      }

      isAnimatingScroll.current = true;
      pendingScrollTarget.current = null;

      gridHandle.scrollToColumn({
        index,
        align: 'center',
        behavior: isReadyForSmooth.current ? 'smooth' : 'instant',
      });

      if (scrollAnimationTimeout.current) clearTimeout(scrollAnimationTimeout.current);

      scrollAnimationTimeout.current = setTimeout(() => {
        isAnimatingScroll.current = false;

        if (pendingScrollTarget.current !== null && pendingScrollTarget.current !== index) {
          const nextTarget = pendingScrollTarget.current;
          if (!isItemVisible(nextTarget)) {
            performSafeScroll(nextTarget);
          } else {
            pendingScrollTarget.current = null;
          }
        }
      }, 250);
    },
    [gridHandle, isItemVisible],
  );

  useEffect(() => {
    const currentPath = data.selectedPath;
    const consumeClickTriggeredScroll = data.consumeClickTriggeredScroll;

    if (currentPath && gridHandle) {
      if (data.multiSelectedPaths.length > 1) {
        prevSelectedPath.current = currentPath;
        consumeClickTriggeredScroll();
        return;
      }

      const index = data.imageList.findIndex((img) => img.path === currentPath);

      if (index !== -1) {
        if (currentPath !== prevSelectedPath.current) {
          const isVisible = isItemVisible(index);

          if (consumeClickTriggeredScroll()) {
            performSafeScroll(index, true);
          } else if (!isVisible) {
            performSafeScroll(index);
          }
          prevSelectedPath.current = currentPath;
        } else {
          if (!hasCompletedInitialScroll.current && !isItemVisible(index)) {
            performSafeScroll(index, true);
          }
          hasCompletedInitialScroll.current = true;
        }
      }
    }
  }, [
    data.selectedPath,
    data.multiSelectedPaths,
    data.imageList,
    isItemVisible,
    data.consumeClickTriggeredScroll,
    performSafeScroll,
    gridHandle,
  ]);

  const focusThumbnail = useCallback((path: string) => {
    const element = thumbnailElements.current.get(path);
    if (!element) {
      pendingFocusPath.current = path;
      return;
    }

    pendingFocusPath.current = null;
    element.focus({ preventScroll: true });
  }, []);

  const onRegisterThumbnail = useCallback(
    (path: string, element: HTMLDivElement | null) => {
      if (element) {
        thumbnailElements.current.set(path, element);
        if (pendingFocusPath.current === path) {
          requestAnimationFrame(() => {
            focusThumbnail(path);
          });
        }
        return;
      }

      thumbnailElements.current.delete(path);
    },
    [focusThumbnail],
  );

  const onThumbnailRovingKeyDown = useCallback(
    (event: ThumbnailKeyboardEvent, index: number) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;

      let nextIndex: number | null = null;
      if (event.key === 'ArrowLeft') {
        nextIndex = Math.max(0, index - 1);
      } else if (event.key === 'ArrowRight') {
        nextIndex = Math.min(data.imageList.length - 1, index + 1);
      } else if (event.key === 'Home') {
        nextIndex = 0;
      } else if (event.key === 'End') {
        nextIndex = data.imageList.length - 1;
      }

      if (nextIndex === null || nextIndex === index) return;

      const nextImage = data.imageList[nextIndex];
      if (!nextImage) return;

      event.preventDefault();
      event.stopPropagation();
      data.onImageSelect?.(nextImage.path, event);
      performSafeScroll(nextIndex, true);
      requestAnimationFrame(() => {
        focusThumbnail(nextImage.path);
      });
    },
    [data, focusThumbnail, performSafeScroll],
  );

  const cellProps = useMemo<FilmstripCellData>(
    () => ({
      ...data,
      activeIndex,
      itemHeight,
      onRegisterThumbnail,
      onThumbnailRovingKeyDown,
    }),
    [activeIndex, data, itemHeight, onRegisterThumbnail, onThumbnailRovingKeyDown],
  );

  return (
    <div
      className="border-b border-editor-border bg-editor-panel-well"
      data-filmstrip-layout="navigator"
      data-testid="filmstrip-navigator-lane"
      style={{ height, width }}
    >
      <Grid<FilmstripCellData>
        aria-label="Filmstrip"
        aria-orientation="horizontal"
        gridRef={setGridHandle}
        defaultWidth={width}
        rowCount={1}
        rowHeight={height}
        columnCount={data.imageList.length}
        columnWidth={columnWidth}
        cellComponent={FilmstripCell}
        cellProps={cellProps}
        className="custom-scrollbar"
        role="listbox"
        style={{ overflowY: 'hidden' }}
        onWheel={(e: React.WheelEvent<HTMLDivElement>) => {
          if (e.deltaY !== 0 && Math.abs(e.deltaX) < Math.abs(e.deltaY)) {
            e.currentTarget.scrollLeft += e.deltaY;
            e.preventDefault();
          }
        }}
        onCellsRendered={onCellsRendered}
        overscanCount={16}
      />
    </div>
  );
};

interface FilmstripSelectionSummaryProps {
  imageList: ImageFile[];
  imageRatings: ImageRatings;
  multiSelectedPaths: string[];
  onClearSelection?: (() => void) | undefined;
  selectedImage?: SelectedImage | undefined;
}

const FilmstripSelectionSummary = ({
  imageList,
  imageRatings,
  multiSelectedPaths,
  onClearSelection,
  selectedImage,
}: FilmstripSelectionSummaryProps) => {
  const { t } = useTranslation();

  const summary = useMemo(() => {
    const selectedPathSet = new Set(multiSelectedPaths);
    const selectedImages = imageList.filter((image) => selectedPathSet.has(image.path));
    const activePath = selectedImage?.path ?? multiSelectedPaths[0];
    const activeFilename = activePath ? getFilmstripFilename(activePath) : t('ui.filmstrip.selectionSummary.noActive');

    return selectedImages.reduce(
      (acc, image) => {
        const rating = imageRatings?.[image.path] ?? image.rating ?? 0;
        const rawBadgeCount = buildRawQualityBadges(image.exif).length;

        return {
          activeFilename: acc.activeFilename,
          colorLabelCount: acc.colorLabelCount + (getFilmstripColorLabel(image.tags) ? 1 : 0),
          editedCount: acc.editedCount + (image.is_edited ? 1 : 0),
          ratingCount: acc.ratingCount + (rating > 0 ? 1 : 0),
          rawQualityBadgeCount: acc.rawQualityBadgeCount + rawBadgeCount,
          rawQualityImageCount: acc.rawQualityImageCount + (rawBadgeCount > 0 ? 1 : 0),
          selectedCount: acc.selectedCount + 1,
          virtualCopyCount: acc.virtualCopyCount + (image.is_virtual_copy || image.path.includes('?vc=') ? 1 : 0),
        };
      },
      {
        activeFilename,
        colorLabelCount: 0,
        editedCount: 0,
        ratingCount: 0,
        rawQualityBadgeCount: 0,
        rawQualityImageCount: 0,
        selectedCount: 0,
        virtualCopyCount: 0,
      },
    );
  }, [imageList, imageRatings, multiSelectedPaths, selectedImage?.path, t]);

  const badgeCounters = [
    {
      count: summary.editedCount,
      key: 'edited',
      label: t('ui.filmstrip.selectionSummary.badges.edited'),
      testId: 'filmstrip-selection-summary-edited-count',
    },
    {
      count: summary.rawQualityImageCount,
      key: 'rawQuality',
      label: t('ui.filmstrip.selectionSummary.badges.rawQuality'),
      testId: 'filmstrip-selection-summary-raw-quality-count',
    },
    {
      count: summary.ratingCount,
      key: 'rating',
      label: t('ui.filmstrip.selectionSummary.badges.rating'),
      testId: 'filmstrip-selection-summary-rating-count',
    },
    {
      count: summary.colorLabelCount,
      key: 'color',
      label: t('ui.filmstrip.selectionSummary.badges.color'),
      testId: 'filmstrip-selection-summary-color-count',
    },
    {
      count: summary.virtualCopyCount,
      key: 'virtualCopy',
      label: t('ui.filmstrip.selectionSummary.badges.virtualCopy'),
      testId: 'filmstrip-selection-summary-virtual-copy-count',
    },
  ] as const;

  const handleClearSelection = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onClearSelection?.();
  };

  return (
    <div
      className="mb-1 flex h-[30px] min-w-0 items-center gap-2 overflow-hidden border-y border-editor-border bg-editor-panel px-2"
      data-active-filename={summary.activeFilename}
      data-color-label-count={summary.colorLabelCount}
      data-edited-count={summary.editedCount}
      data-raw-quality-badge-count={summary.rawQualityBadgeCount}
      data-raw-quality-image-count={summary.rawQualityImageCount}
      data-rating-count={summary.ratingCount}
      data-selected-count={summary.selectedCount}
      data-testid="filmstrip-selection-summary"
      data-virtual-copy-count={summary.virtualCopyCount}
      onClick={(event) => {
        event.stopPropagation();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
      }}
    >
      <div className="flex min-w-0 shrink-0 items-center gap-1.5">
        <span
          className="rounded-sm border border-editor-border bg-editor-selected-quiet px-1.5 py-0.5 text-[10px] font-semibold text-text-primary"
          data-testid="filmstrip-selection-summary-selected-count"
        >
          {t('ui.filmstrip.selectionSummary.selectedCount', { count: summary.selectedCount })}
        </span>
        <span className="max-w-[18rem] truncate text-[11px] text-text-secondary">
          {t('ui.filmstrip.selectionSummary.activePrefix')}
          <span
            className="ml-1 font-medium text-text-primary"
            data-testid="filmstrip-selection-summary-active-filename"
          >
            {summary.activeFilename}
          </span>
        </span>
      </div>

      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
        {badgeCounters.map((counter) => (
          <span
            className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-editor-border bg-editor-panel-well px-1.5 py-0.5 text-[10px] font-medium text-text-secondary"
            data-badge-counter={counter.key}
            data-count={counter.count}
            data-testid={counter.testId}
            key={counter.key}
          >
            <span>{counter.label}</span>
            <span className={counter.count > 0 ? 'text-text-primary' : 'text-text-secondary'}>{counter.count}</span>
          </span>
        ))}
      </div>

      <button
        aria-label={t('ui.filmstrip.selectionSummary.clearSelection')}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-text-secondary transition-colors hover:bg-editor-panel-raised hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editor-focus-ring disabled:cursor-not-allowed disabled:opacity-40"
        data-testid="filmstrip-selection-summary-clear"
        disabled={summary.selectedCount === 0 || !onClearSelection}
        onClick={handleClearSelection}
        type="button"
      >
        <X size={14} />
      </button>
    </div>
  );
};

interface FilmStripProps {
  imageList: Array<ImageFile>;
  imageRatings: ImageRatings;
  isLoading: boolean;
  multiSelectedPaths: Array<string>;
  onClearSelection?: (() => void) | undefined;
  onContextMenu?: ((event: ThumbnailMouseEvent, path: string) => void) | undefined;
  onImageSelect?: ((path: string, event: ThumbnailSelectEvent) => void) | undefined;
  onRequestThumbnails?: ((paths: string[]) => void) | undefined;
  selectedImage?: SelectedImage | undefined;
  selectedImageThumbnailUrl?: string | undefined;
  thumbnailAspectRatio: ThumbnailAspectRatio;
  totalImages?: number;
}

export default function Filmstrip({
  imageList,
  imageRatings,
  isLoading: _isLoading,
  multiSelectedPaths,
  onClearSelection,
  onContextMenu,
  onImageSelect,
  onRequestThumbnails,
  selectedImage,
  selectedImageThumbnailUrl,
  thumbnailAspectRatio,
}: FilmStripProps) {
  const clickTriggeredScroll = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ height: 0, width: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        const { height, width } = entry.contentRect;
        setSize((prev) => (prev.height === height && prev.width === width ? prev : { height, width }));
      }
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, []);

  const handleImageSelect = (path: string, event: ThumbnailSelectEvent) => {
    if (path !== selectedImage?.path) {
      clickTriggeredScroll.current = true;
    }
    onImageSelect?.(path, event);
  };

  const consumeClickTriggeredScroll = useCallback(() => {
    const wasClickTriggered = clickTriggeredScroll.current;
    clickTriggeredScroll.current = false;
    return wasClickTriggered;
  }, []);

  return (
    <div ref={containerRef} className="h-full w-full" role="presentation" onClick={onClearSelection}>
      {size.height > 0 && size.width > 0 && (
        <div className="flex h-full min-h-0 w-full flex-col">
          <FilmstripSelectionSummary
            imageList={imageList}
            imageRatings={imageRatings}
            multiSelectedPaths={multiSelectedPaths}
            onClearSelection={onClearSelection}
            selectedImage={selectedImage}
          />
          <FilmstripList
            height={Math.max(20, size.height - FILMSTRIP_SUMMARY_HEIGHT - 4)}
            width={size.width}
            data={{
              imageList,
              imageRatings,
              selectedPath: selectedImage?.path,
              multiSelectedPaths,
              thumbnailAspectRatio,
              onContextMenu,
              onRequestThumbnails,
              onImageSelect: handleImageSelect,
              consumeClickTriggeredScroll,
              selectedImageThumbnailUrl,
            }}
          />
        </div>
      )}
    </div>
  );
}
