import cx from 'clsx';
import type { TFunction } from 'i18next';
import {
  AlertTriangle,
  CloudOff,
  Folder,
  FolderOpen,
  Image as ImageIcon,
  Images,
  SlidersHorizontal,
  Star as StarIcon,
} from 'lucide-react';
import {
  type CSSProperties,
  memo,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useLibraryImage } from '../../../hooks/library/useLibraryImage';
import { useProcessStore } from '../../../store/useProcessStore';
import { useSettingsStore } from '../../../store/useSettingsStore';
import { useThumbnail, useThumbnailSmartPreview } from '../../../thumbnails/useThumbnail';
import { TEXT_COLOR_KEYS, TextColors, TextVariants, TextWeights } from '../../../types/typography';
import { COLOR_LABELS, type Color } from '../../../utils/adjustments';
import type { LibraryAutoStackDisplay, LibraryAutoStackItem } from '../../../utils/libraryAutoStacks';
import {
  formatExifApertureFromMetadata,
  formatExifFocalLengthFromMetadata,
} from '../../../utils/metadataPanelContracts';
import { buildRawQualityBadges, formatRawQualityBadgeTooltip } from '../../../utils/rawQualityBadges';
import { ExifOverlay, type ImageFile, ThumbnailAspectRatio } from '../../ui/AppProperties';
import UiText from '../../ui/primitives/Text';
import { IconAperture, IconFocalLength, IconIso, IconShutter } from '../editor/ExifIcons';
import { columnWidthStyle } from './libraryColumnWidths';

interface ImageLayer {
  id: string;
  url: string;
  opacity: number;
}

type LibraryItemMouseEvent = ReactMouseEvent<HTMLElement>;
type LibraryItemKeyboardEvent = ReactKeyboardEvent<HTMLElement>;
type LibraryItemSelectEvent = LibraryItemMouseEvent | LibraryItemKeyboardEvent;
type LibraryImageContextMenuHandler = (event: LibraryItemMouseEvent, path: string) => void;
type LibraryImageClickHandler = (path: string, event: LibraryItemSelectEvent) => void;
type LibraryImageDoubleClickHandler = (path: string) => void;
type LibraryImageLoadHandler = (path: string) => void;

interface LibraryItemBaseProps {
  autoStack?: LibraryAutoStackDisplay | undefined;
  isActive: boolean;
  isSelected: boolean;
  onAutoStackToggle?: ((stackId: string) => void) | undefined;
  onContextMenu: LibraryImageContextMenuHandler;
  onImageClick: LibraryImageClickHandler;
  onImageDoubleClick: LibraryImageDoubleClickHandler;
  onLoad: LibraryImageLoadHandler;
  path: string;
  rating: number;
  tags: ImageFile['tags'];
  aspectRatio: ThumbnailAspectRatio;
  exif: ImageFile['exif'];
}

interface ThumbnailComponentProps extends LibraryItemBaseProps {
  isEdited: boolean;
}

interface ListItemComponentProps extends LibraryItemBaseProps {
  modified: number;
}

export interface LibraryHeaderRow {
  type: 'header';
  path: string;
  count: number;
  isExpanded: boolean;
}

export interface LibraryImagesRow {
  type: 'images';
  images: LibraryAutoStackItem[];
  startIndex: number;
}

export interface LibraryFooterRow {
  type: 'footer';
}

export type LibraryRow = LibraryHeaderRow | LibraryImagesRow | LibraryFooterRow;

export interface LibraryRowProps {
  index: number;
  style: CSSProperties;
  rows: LibraryRow[];
  activePath: string | null;
  multiSelectedSet: Set<string>;
  onContextMenu: LibraryImageContextMenuHandler;
  onImageClick: LibraryImageClickHandler;
  onImageDoubleClick: LibraryImageDoubleClickHandler;
  thumbnailAspectRatio: ThumbnailAspectRatio;
  onImageLoad: LibraryImageLoadHandler;
  baseFolderPath: string | null;
  itemWidth: number;
  itemHeight: number;
  outerPadding: number;
  gap: number;
  isListView: boolean;
  onToggleRecursiveFolder: (path: string) => void;
  onToggleAutoStack: (stackId: string) => void;
}

const getExifOverlayValues = (exif: ImageFile['exif']) => {
  return {
    shutter: exif?.['ExposureTime'] ?? '',
    fNumber: formatExifApertureFromMetadata(exif) ?? '',
    iso: exif?.['PhotographicSensitivity'] ?? exif?.['ISOSpeedRatings'] ?? '',
    focal: formatExifFocalLengthFromMetadata(exif) ?? '',
  };
};

const getStackLabel = (stack: LibraryAutoStackDisplay, t: TFunction) =>
  stack.kind === 'bracket' ? t('library.items.autoStackHdr') : t('library.items.autoStackBurst');

const AutoStackBadge = ({
  stack,
  onToggle,
}: {
  stack: LibraryAutoStackDisplay;
  onToggle?: ((stackId: string) => void) | undefined;
}) => {
  const { t } = useTranslation();
  const label = getStackLabel(stack, t);

  return (
    <button
      type="button"
      className={cx(
        'inline-flex h-6 shrink-0 items-center gap-1 rounded-full border border-white/15 bg-black/50 px-2 text-[10px] font-semibold uppercase tracking-normal text-white shadow-md backdrop-blur transition-colors hover:bg-black/70',
        !stack.isCover && 'bg-bg-primary text-text-secondary shadow-none hover:bg-bg-primary',
      )}
      onClick={(event) => {
        event.stopPropagation();
        onToggle?.(stack.id);
      }}
      data-tooltip={t(stack.isExpanded ? 'library.items.autoStackCollapse' : 'library.items.autoStackExpand', {
        count: stack.count,
        kind: label,
      })}
      aria-label={t(stack.isExpanded ? 'library.items.autoStackCollapse' : 'library.items.autoStackExpand', {
        count: stack.count,
        kind: label,
      })}
    >
      <Images size={12} />
      <span>{label}</span>
      <span>{stack.count}</span>
    </button>
  );
};

const RawQualityBadgeCluster = ({ exif, compact = false }: { compact?: boolean; exif: ImageFile['exif'] }) => {
  const badges = useMemo(() => buildRawQualityBadges(exif), [exif]);
  if (badges.length === 0) return null;

  return (
    <div
      className={cx('flex items-center gap-1', compact ? 'justify-start' : 'absolute bottom-1.5 left-1.5 z-20')}
      data-raw-quality-badge-count={badges.length}
      data-testid="raw-quality-thumbnail-badges"
      data-tooltip={formatRawQualityBadgeTooltip(badges)}
    >
      {badges.map((badge) => (
        <span
          key={badge.code}
          className={cx(
            'inline-flex h-5 items-center gap-1 rounded-full border px-1.5 text-[10px] font-semibold shadow-md backdrop-blur',
            badge.severity === 'warning'
              ? 'border-amber-300/35 bg-amber-500/20 text-amber-100'
              : 'border-sky-300/30 bg-sky-500/20 text-sky-100',
          )}
          data-raw-quality-badge-code={badge.code}
          data-raw-quality-badge-detail={badge.detail}
          data-raw-quality-badge-severity={badge.severity}
        >
          {badge.severity === 'warning' ? <AlertTriangle size={11} /> : null}
          <span>{badge.label}</span>
        </span>
      ))}
    </div>
  );
};

const ThumbnailComponent = ({
  autoStack,
  isActive,
  isSelected,
  onAutoStackToggle,
  onContextMenu,
  onImageClick,
  onImageDoubleClick,
  onLoad,
  path,
  rating,
  tags,
  aspectRatio: thumbnailAspectRatio,
  isEdited,
  exif,
}: ThumbnailComponentProps) => {
  const { t } = useTranslation();
  const data = useThumbnail(path);
  const smartPreview = useThumbnailSmartPreview(path);
  const exifOverlay = useSettingsStore((s) => s.appSettings?.exifOverlay || ExifOverlay.Off);
  const displayEditIcon = useSettingsStore((s) => s.appSettings?.displayEditIcon ?? true);
  const showEditIcon = isEdited && displayEditIcon;
  const showSmartPreviewBadge = smartPreview?.stale || smartPreview?.source === 'smartPreview';

  const [showPlaceholder, setShowPlaceholder] = useState(false);
  const [layers, setLayers] = useState<ImageLayer[]>([]);

  const pathRef = useRef(path);
  const hadDataOnPathChange = useRef(!!data);

  useLayoutEffect(() => {
    if (pathRef.current !== path) {
      pathRef.current = path;
      hadDataOnPathChange.current = !!data;
      setLayers([]);
    }
  }, [data, path]);

  const { baseName, isVirtualCopy } = useMemo(() => {
    const fullFileName = path.split(/[\\/]/).pop() || '';
    const parts = fullFileName.split('?vc=');
    return {
      baseName: parts[0],
      isVirtualCopy: parts.length > 1,
    };
  }, [path]);

  const { shutter, fNumber, iso, focal } = useMemo(() => getExifOverlayValues(exif), [exif]);

  useEffect(() => {
    const timer = setTimeout(
      () => {
        setShowPlaceholder(!data);
      },
      data ? 0 : 500,
    );

    return () => {
      clearTimeout(timer);
    };
  }, [data]);

  useEffect(() => {
    const layerTimer = setTimeout(() => {
      if (!data) {
        setLayers([]);
        return;
      }

      setLayers((prev) => {
        if (prev.some((l) => l.id === data)) return prev;

        if (prev.length === 0) {
          if (hadDataOnPathChange.current) {
            return [{ id: data, url: data, opacity: 1 }];
          } else {
            return [{ id: data, url: data, opacity: 0 }];
          }
        }

        return [...prev, { id: data, url: data, opacity: 0 }];
      });
    }, 0);

    return () => {
      clearTimeout(layerTimer);
    };
  }, [data, path]);

  useEffect(() => {
    const layerToFadeIn = layers.find((l) => l.opacity === 0);
    if (layerToFadeIn) {
      const frame = requestAnimationFrame(() => {
        setLayers((prev) => prev.map((l) => (l.id === layerToFadeIn.id ? { ...l, opacity: 1 } : l)));
      });
      return () => {
        cancelAnimationFrame(frame);
      };
    }
    return undefined;
  }, [layers]);

  const handleTransitionEnd = useCallback((finishedId: string) => {
    setLayers((prev) => {
      const finishedIndex = prev.findIndex((l) => l.id === finishedId);
      if (finishedIndex < 0 || prev.length <= 1) return prev;
      return prev.slice(finishedIndex);
    });
  }, []);

  const ringClass = isActive
    ? 'ring-2 ring-inset ring-accent'
    : isSelected
      ? 'ring-2 ring-inset ring-gray-400'
      : 'group-hover:ring-2 group-hover:ring-inset group-hover:ring-hover-color';

  const colorTag = tags?.find((tag) => tag.startsWith('color:'))?.substring(6);
  const colorLabel = COLOR_LABELS.find((c: Color) => c.name === colorTag);

  const isAlways = exifOverlay === ExifOverlay.Always;
  const isHover = exifOverlay === ExifOverlay.Hover;

  const hasEditIcon = showEditIcon;
  const hasColorLabel = !!colorLabel;
  const hasRating = rating > 0;
  const hasAnyOverlay = hasEditIcon || hasColorLabel || hasRating;
  const handleSelect = (event: LibraryItemSelectEvent) => {
    event.stopPropagation();
    onImageClick(path, event);
  };

  const handleKeyDown = (event: LibraryItemKeyboardEvent) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    handleSelect(event);
  };

  return (
    <div
      className="aspect-square bg-surface rounded-md overflow-hidden cursor-pointer group relative flex flex-col transition-all duration-150 transform-gpu [-webkit-mask-image:-webkit-radial-gradient(white,black)]"
      onClick={handleSelect}
      onContextMenu={(e) => {
        onContextMenu(e, path);
      }}
      onDoubleClick={() => {
        onImageDoubleClick(path);
      }}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      data-image-path={path}
      data-testid="library-thumbnail"
    >
      <div className="relative w-full flex-1 min-h-0 z-0 bg-surface">
        {layers.length > 0 && (
          <div className="absolute inset-0 w-full h-full">
            {layers.map((layer) => (
              <div
                key={layer.id}
                className="absolute inset-0 w-full h-full"
                style={{
                  opacity: layer.opacity,
                  transition: 'opacity 300ms ease-in-out',
                }}
                onTransitionEnd={() => {
                  handleTransitionEnd(layer.id);
                }}
              >
                <img
                  alt={path.split(/[\\/]/).pop()}
                  className={`w-full h-full group-hover:scale-[1.02] transition-transform duration-300 will-change-transform ${
                    thumbnailAspectRatio === ThumbnailAspectRatio.Contain ? 'object-contain' : 'object-cover'
                  } relative`}
                  decoding="async"
                  loading="lazy"
                  src={layer.url}
                  onLoad={() => {
                    onLoad(path);
                  }}
                />
              </div>
            ))}
          </div>
        )}

        {layers.length === 0 && showPlaceholder && (
          <div className="absolute inset-0 w-full h-full flex items-center justify-center bg-surface">
            <ImageIcon className="text-text-secondary animate-pulse" />
          </div>
        )}

        {showSmartPreviewBadge && (
          <div
            className="absolute left-1.5 top-1.5 z-20 rounded-full bg-black/45 p-1 text-white shadow-md"
            data-tooltip={t('library.items.tooltipSmartPreview')}
          >
            <CloudOff size={12} />
          </div>
        )}
        <RawQualityBadgeCluster exif={exif} />
      </div>

      <div
        className={cx(
          'absolute top-0 right-0 w-1/2 h-1/2 bg-linear-to-bl from-black/20 via-black/0 to-transparent pointer-events-none z-0 transition-opacity duration-200 ease-in-out',
          hasAnyOverlay ? 'opacity-100' : 'opacity-0',
        )}
      />

      <div className="absolute top-1.5 right-1.5 flex items-center justify-end z-10 pointer-events-none">
        {autoStack && (
          <div className="pointer-events-auto mr-1.5">
            <AutoStackBadge stack={autoStack} onToggle={onAutoStackToggle} />
          </div>
        )}
        <div
          className={cx(
            'rounded-full h-5 px-1.5 flex items-center justify-center gap-0 shadow-md bg-black/30 pointer-events-auto transition-all duration-200 ease-out origin-top-right',
            hasAnyOverlay ? 'opacity-100 scale-100' : 'opacity-0 scale-90 pointer-events-none',
          )}
        >
          <div
            className={cx(
              'text-white flex items-center transition-all duration-200 ease-out overflow-hidden',
              hasEditIcon ? 'max-w-3 opacity-100 scale-100' : 'max-w-0 opacity-0 scale-75 pointer-events-none',
            )}
          >
            <SlidersHorizontal size={12} />
          </div>

          <div
            className={cx(
              'flex items-center justify-center shrink-0 transition-all duration-200 ease-out overflow-hidden',
              hasColorLabel ? 'max-w-3 opacity-100 scale-100' : 'max-w-0 opacity-0 scale-75 pointer-events-none',
              hasColorLabel && hasEditIcon ? 'ml-1.5' : 'ml-0',
            )}
          >
            <div
              className="w-3 h-3 rounded-full transition-colors duration-200"
              style={{ backgroundColor: colorLabel ? colorLabel.color : 'transparent' }}
            />
          </div>

          <div
            className={cx(
              'flex items-center gap-0.5 shrink-0 transition-all duration-200 ease-out overflow-hidden',
              hasRating ? 'max-w-7 opacity-100 scale-100' : 'max-w-0 opacity-0 scale-75 pointer-events-none',
              hasRating && (hasEditIcon || hasColorLabel) ? 'ml-1.5' : 'ml-0',
            )}
          >
            <UiText variant={TextVariants.small} color={TextColors.white}>
              {rating}
            </UiText>
            <StarIcon size={12} className="text-white fill-white" />
          </div>
        </div>
      </div>

      <div
        className={cx(
          'absolute bottom-0 left-0 right-0 h-16 transition-opacity duration-300 pointer-events-none z-10',
          'bg-linear-to-t from-black/70 to-transparent',
          isAlways ? 'opacity-0' : isHover ? 'opacity-100 group-hover:opacity-0' : 'opacity-100',
        )}
      />

      <div
        className={cx(
          'w-full transition-[grid-template-rows] duration-300 ease-in-out grid shrink-0 z-0',
          isAlways ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
        aria-hidden="true"
      >
        <div className="min-h-0 overflow-hidden pointer-events-none invisible">
          <div className="flex flex-col p-2 pb-1.5">
            <div className="flex items-end justify-between shrink-0">
              <UiText variant={TextVariants.small} className="truncate pr-2">
                {baseName}
              </UiText>
              {isVirtualCopy && (
                <UiText variant={TextVariants.small} className="px-1.5 py-0.5 font-bold">
                  VC
                </UiText>
              )}
            </div>
            <div className="pt-1.5 pb-0.5 flex flex-wrap items-center gap-x-2.5 shrink-0">
              <div className="flex items-center gap-1">
                <IconShutter className="w-2.5 h-2.5" />
                <UiText variant={TextVariants.small} className="text-[9px] font-medium tracking-wide">
                  {shutter || '-'}
                </UiText>
              </div>
              <div className="flex items-center gap-1">
                <IconAperture className="w-2.5 h-2.5" />
                <UiText variant={TextVariants.small} className="text-[9px] font-medium tracking-wide">
                  {fNumber || '-'}
                </UiText>
              </div>
              <div className="flex items-center gap-1">
                <IconIso className="w-2.5 h-2.5" />
                <UiText variant={TextVariants.small} className="text-[9px] font-medium tracking-wide">
                  {iso || '-'}
                </UiText>
              </div>
              <div className="flex items-center gap-1">
                <IconFocalLength className="w-2.5 h-2.5" />
                <UiText variant={TextVariants.small} className="text-[9px] font-medium tracking-wide">
                  {focal || '-'}
                </UiText>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        className={cx(
          'absolute bottom-0 left-0 right-0 flex flex-col p-2 pb-1.5 transition-all duration-300 ease-in-out z-20',
          isAlways
            ? 'bg-surface border-t border-border-color/50 pointer-events-auto'
            : isHover
              ? 'bg-transparent group-hover:bg-surface/60 backdrop-blur-none group-hover:backdrop-blur-md border-t border-transparent group-hover:border-border-color/50 pointer-events-none group-hover:pointer-events-auto'
              : 'bg-transparent border-t border-transparent pointer-events-none',
        )}
      >
        <div className="flex items-end justify-between shrink-0">
          <UiText
            variant={TextVariants.small}
            className={cx(
              'truncate pr-2 transition-colors duration-300',
              isAlways ? 'text-white' : isHover ? 'text-white group-hover:text-white' : 'text-white',
            )}
          >
            {baseName}
          </UiText>
          {isVirtualCopy && (
            <UiText
              as="div"
              variant={TextVariants.small}
              weight={TextWeights.bold}
              className={cx(
                'shrink-0 px-1.5 py-0.5 rounded-full transition-colors duration-300 font-bold pointer-events-auto',
                isAlways
                  ? 'bg-border-color/30 text-text-primary shadow-none'
                  : isHover
                    ? 'bg-black/30 text-white backdrop-blur-xs shadow-md group-hover:bg-border-color/30 group-hover:text-text-primary group-hover:shadow-none group-hover:backdrop-blur-none'
                    : 'bg-black/30 text-white backdrop-blur-xs shadow-md',
              )}
              data-tooltip={t('library.items.tooltipVirtualCopy')}
            >
              VC
            </UiText>
          )}
        </div>

        <div
          className={cx(
            'grid transition-[grid-template-rows,opacity] duration-300 ease-in-out shrink-0',
            isAlways
              ? 'grid-rows-[1fr] opacity-100'
              : isHover
                ? 'grid-rows-[0fr] opacity-0 group-hover:grid-rows-[1fr] group-hover:opacity-100'
                : 'grid-rows-[0fr] opacity-0',
          )}
        >
          <div className="overflow-hidden min-h-0">
            <div
              className={cx(
                'pt-1.5 pb-0.5 flex flex-wrap items-center gap-x-2.5 shrink-0 transition-transform duration-300 ease-in-out',
                isAlways ? 'translate-y-0' : isHover ? 'translate-y-3 group-hover:translate-y-0' : 'translate-y-3',
              )}
            >
              <div
                className="flex items-center gap-1 text-text-secondary"
                data-tooltip={t('library.items.tooltipShutterSpeed')}
              >
                <IconShutter className="w-2.5 h-2.5" />
                <UiText variant={TextVariants.small} className="text-[9px] font-medium tracking-wide">
                  {shutter || '-'}
                </UiText>
              </div>
              <div
                className="flex items-center gap-1 text-text-secondary"
                data-tooltip={t('library.items.tooltipAperture')}
              >
                <IconAperture className="w-2.5 h-2.5" />
                <UiText variant={TextVariants.small} className="text-[9px] font-medium tracking-wide">
                  {fNumber || '-'}
                </UiText>
              </div>
              <div className="flex items-center gap-1 text-text-secondary" data-tooltip={t('library.items.tooltipIso')}>
                <IconIso className="w-2.5 h-2.5" />
                <UiText variant={TextVariants.small} className="text-[9px] font-medium tracking-wide">
                  {iso || '-'}
                </UiText>
              </div>
              <div
                className="flex items-center gap-1 text-text-secondary"
                data-tooltip={t('library.items.tooltipFocalLength')}
              >
                <IconFocalLength className="w-2.5 h-2.5" />
                <UiText variant={TextVariants.small} className="text-[9px] font-medium tracking-wide">
                  {focal || '-'}
                </UiText>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        className={cx('absolute inset-0 rounded-md pointer-events-none z-30 transition-all duration-150', ringClass)}
      />
    </div>
  );
};

const ListItemComponent = ({
  autoStack,
  isActive,
  isSelected,
  onAutoStackToggle,
  onContextMenu,
  onImageClick,
  onImageDoubleClick,
  onLoad,
  path,
  rating,
  tags,
  modified,
  aspectRatio: thumbnailAspectRatio,
  exif,
}: ListItemComponentProps) => {
  const { t } = useTranslation();
  const data = useThumbnail(path);
  const smartPreview = useThumbnailSmartPreview(path);
  const exifOverlay = useSettingsStore((s) => s.appSettings?.exifOverlay || ExifOverlay.Off);
  const showSmartPreviewBadge = smartPreview?.stale || smartPreview?.source === 'smartPreview';

  const [showPlaceholder, setShowPlaceholder] = useState(false);
  const [layers, setLayers] = useState<ImageLayer[]>([]);

  const pathRef = useRef(path);
  const hadDataOnPathChange = useRef(!!data);

  useLayoutEffect(() => {
    if (pathRef.current !== path) {
      pathRef.current = path;
      hadDataOnPathChange.current = !!data;
      setLayers([]);
    }
  }, [data, path]);

  const { baseName, isVirtualCopy } = useMemo(() => {
    const fullFileName = path.split(/[\\/]/).pop() || '';
    const parts = fullFileName.split('?vc=');
    return {
      baseName: parts[0],
      isVirtualCopy: parts.length > 1,
    };
  }, [path]);

  const { shutter, fNumber, iso, focal } = useMemo(() => getExifOverlayValues(exif), [exif]);

  const showExifCols = exifOverlay !== ExifOverlay.Off;
  useEffect(() => {
    const timer = setTimeout(
      () => {
        setShowPlaceholder(!data);
      },
      data ? 0 : 500,
    );

    return () => {
      clearTimeout(timer);
    };
  }, [data]);

  useEffect(() => {
    const layerTimer = setTimeout(() => {
      if (!data) {
        setLayers([]);
        return;
      }

      setLayers((prev) => {
        if (prev.some((l) => l.id === data)) return prev;

        if (prev.length === 0) {
          if (hadDataOnPathChange.current) {
            return [{ id: data, url: data, opacity: 1 }];
          } else {
            return [{ id: data, url: data, opacity: 0 }];
          }
        }

        return [...prev, { id: data, url: data, opacity: 0 }];
      });
    }, 0);

    return () => {
      clearTimeout(layerTimer);
    };
  }, [data, path]);

  useEffect(() => {
    const layerToFadeIn = layers.find((l) => l.opacity === 0);
    if (layerToFadeIn) {
      const frame = requestAnimationFrame(() => {
        setLayers((prev) => prev.map((l) => (l.id === layerToFadeIn.id ? { ...l, opacity: 1 } : l)));
      });
      return () => {
        cancelAnimationFrame(frame);
      };
    }
    return undefined;
  }, [layers]);

  const handleTransitionEnd = useCallback((finishedId: string) => {
    setLayers((prev) => {
      const finishedIndex = prev.findIndex((l) => l.id === finishedId);
      if (finishedIndex < 0 || prev.length <= 1) return prev;
      return prev.slice(finishedIndex);
    });
  }, []);

  const colorTag = tags?.find((tag) => tag.startsWith('color:'))?.substring(6);
  const colorLabel = COLOR_LABELS.find((c: Color) => c.name === colorTag);

  const dateObj = new Date(modified > 1e11 ? modified : modified * 1000);
  const dateStr =
    dateObj.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) +
    ' ' +
    dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const stateClass = isActive
    ? 'ring-1 ring-inset ring-accent bg-accent/10'
    : isSelected
      ? 'ring-1 ring-inset ring-accent/50 bg-accent/5'
      : 'hover:bg-surface/80';
  const handleSelect = (event: LibraryItemSelectEvent) => {
    event.stopPropagation();
    onImageClick(path, event);
  };

  const handleKeyDown = (event: LibraryItemKeyboardEvent) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    handleSelect(event);
  };

  return (
    <div
      className={`flex items-center w-full h-full border-b border-border-color/30 cursor-pointer transition-colors duration-150 ${stateClass}`}
      onClick={handleSelect}
      onContextMenu={(e) => {
        onContextMenu(e, path);
      }}
      onDoubleClick={() => {
        onImageDoubleClick(path);
      }}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
    >
      <div
        style={columnWidthStyle('thumbnail')}
        className="flex items-center justify-center p-1.5 h-full overflow-hidden"
      >
        <div className="w-full h-full relative overflow-hidden rounded-sm bg-surface flex items-center justify-center">
          {layers.length > 0 && (
            <div className="absolute inset-0 w-full h-full flex items-center justify-center">
              {layers.map((layer) => (
                <div
                  key={layer.id}
                  className="absolute inset-0 w-full h-full"
                  style={{ opacity: layer.opacity, transition: 'opacity 300ms ease-in-out' }}
                  onTransitionEnd={() => {
                    handleTransitionEnd(layer.id);
                  }}
                >
                  <img
                    alt={baseName}
                    className={`w-full h-full relative ${
                      thumbnailAspectRatio === ThumbnailAspectRatio.Contain ? 'object-contain' : 'object-cover'
                    }`}
                    decoding="async"
                    loading="lazy"
                    src={layer.url}
                    onLoad={() => {
                      onLoad(path);
                    }}
                  />
                </div>
              ))}
            </div>
          )}

          {layers.length === 0 && showPlaceholder && (
            <div className="absolute inset-0 w-full h-full flex items-center justify-center">
              <ImageIcon size={14} className="text-text-secondary animate-pulse" />
            </div>
          )}
        </div>
      </div>

      <div style={columnWidthStyle('name')} className="flex items-center gap-2 px-3 h-full overflow-hidden">
        <UiText
          variant={TextVariants.small}
          className="truncate"
          weight={TextWeights.medium}
          color={TextColors.primary}
        >
          {baseName}
        </UiText>
        {isVirtualCopy && (
          <UiText
            as="div"
            variant={TextVariants.small}
            color={TextColors.secondary}
            weight={TextWeights.bold}
            className="shrink-0 bg-bg-primary px-1.5 py-0.5 rounded-full leading-none border border-border-color"
            data-tooltip={t('library.items.tooltipVirtualCopy')}
          >
            VC
          </UiText>
        )}
        {autoStack && <AutoStackBadge stack={autoStack} onToggle={onAutoStackToggle} />}
        {showSmartPreviewBadge && (
          <CloudOff
            aria-hidden="true"
            className="shrink-0 text-text-secondary"
            data-tooltip={t('library.items.tooltipSmartPreview')}
            size={13}
          />
        )}
        <RawQualityBadgeCluster compact exif={exif} />
      </div>

      <div style={columnWidthStyle('date')} className="flex items-center px-3 h-full overflow-hidden">
        <UiText variant={TextVariants.small} color={TextColors.secondary} className="truncate">
          {dateStr}
        </UiText>
      </div>

      <div style={columnWidthStyle('rating')} className="flex items-center px-3 h-full overflow-hidden">
        {rating > 0 && (
          <div className="flex items-center gap-1">
            <StarIcon size={12} className="text-accent fill-accent" />
            <UiText variant={TextVariants.small} color={TextColors.primary} weight={TextWeights.medium}>
              {rating}
            </UiText>
          </div>
        )}
      </div>

      <div style={columnWidthStyle('color')} className="flex items-center px-3 h-full overflow-hidden">
        {colorLabel && (
          <div className="flex items-center gap-1.5">
            <div
              className="w-2.5 h-2.5 rounded-full shrink-0 ring-1 ring-black/20"
              style={{ backgroundColor: colorLabel.color }}
            />
            <UiText variant={TextVariants.small} color={TextColors.secondary} className="truncate">
              {t(`contextMenus.colors.${colorLabel.name}`, {
                defaultValue: colorLabel.name.charAt(0).toUpperCase() + colorLabel.name.slice(1),
              })}
            </UiText>
          </div>
        )}
      </div>

      {showExifCols && (
        <>
          <div style={columnWidthStyle('shutter')} className="flex items-center px-3 h-full overflow-hidden">
            <UiText variant={TextVariants.small} color={TextColors.secondary} className="truncate">
              {shutter}
            </UiText>
          </div>
          <div style={columnWidthStyle('aperture')} className="flex items-center px-3 h-full overflow-hidden">
            <UiText variant={TextVariants.small} color={TextColors.secondary} className="truncate">
              {fNumber}
            </UiText>
          </div>
          <div style={columnWidthStyle('iso')} className="flex items-center px-3 h-full overflow-hidden">
            <UiText variant={TextVariants.small} color={TextColors.secondary} className="truncate">
              {iso}
            </UiText>
          </div>
          <div style={columnWidthStyle('focal')} className="flex items-center px-3 h-full overflow-hidden">
            <UiText variant={TextVariants.small} color={TextColors.secondary} className="truncate">
              {focal}
            </UiText>
          </div>
        </>
      )}
    </div>
  );
};

export const Thumbnail = memo(ThumbnailComponent);
export const ListItem = memo(ListItemComponent);

const RowComponent = ({
  index,
  style,
  rows,
  activePath,
  multiSelectedSet,
  onContextMenu,
  onImageClick,
  onImageDoubleClick,
  thumbnailAspectRatio,
  onImageLoad,
  baseFolderPath,
  itemWidth,
  itemHeight,
  outerPadding,
  gap,
  isListView,
  onToggleRecursiveFolder,
  onToggleAutoStack,
}: LibraryRowProps) => {
  const { t } = useTranslation();
  const row = rows[index];

  if (!row || row.type === 'footer') return null;

  const shiftedTransform =
    typeof style.transform === 'string'
      ? style.transform.replace(
          /translateY\(([^)]+)\)/,
          (_match: string, y: string) => `translateY(${parseFloat(y) + outerPadding}px)`,
        )
      : style.transform;

  const shiftedStyle: CSSProperties = {
    ...style,
    transform: shiftedTransform,
  };

  if (row.type === 'header') {
    let displayPath = row.path;
    if (baseFolderPath && row.path.startsWith(baseFolderPath)) {
      displayPath = row.path.substring(baseFolderPath.length);
      if (displayPath.startsWith('/') || displayPath.startsWith('\\')) {
        displayPath = displayPath.substring(1);
      }
    }
    if (!displayPath) displayPath = t('library.items.currentFolder');

    return (
      <div
        style={{
          ...shiftedStyle,
          left: 0,
          width: '100%',
          paddingLeft: outerPadding === 0 ? 12 : outerPadding,
          paddingRight: outerPadding === 0 ? 12 : outerPadding,
          boxSizing: 'border-box',
        }}
        className="flex items-end pb-2 pt-2"
      >
        <div className="flex items-center gap-2 w-full border-b border-border-color/50 pb-1">
          <button
            type="button"
            className={`${TEXT_COLOR_KEYS[TextColors.secondary]} p-0.5 rounded transition-colors hover:bg-surface-hover cursor-pointer`}
            onClick={(event) => {
              event.stopPropagation();
              onToggleRecursiveFolder(row.path);
            }}
            data-tooltip={row.isExpanded ? t('library.items.collapseFolder') : t('library.items.expandFolder')}
          >
            {row.isExpanded ? <FolderOpen size={16} /> : <Folder size={16} />}
          </button>
          <UiText
            variant={TextVariants.label}
            weight={TextWeights.semibold}
            className="truncate"
            data-tooltip={row.path}
          >
            {displayPath}
          </UiText>
          <UiText variant={TextVariants.small} color={TextColors.secondary} className="ml-auto">
            {t('library.items.imagesCount', { count: row.count })}
          </UiText>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        ...shiftedStyle,
        left: outerPadding,
        right: outerPadding,
        width: isListView ? '100%' : 'auto',
        display: 'flex',
        gap: gap,
      }}
    >
      {row.images.map(({ image: imageFile, stack }: LibraryAutoStackItem) => (
        <div
          key={imageFile.path}
          style={{
            width: isListView ? '100%' : itemWidth,
            height: itemHeight,
          }}
        >
          <LibraryEntityItem
            path={imageFile.path}
            stack={stack}
            isListView={isListView}
            isActive={activePath === imageFile.path}
            isSelected={multiSelectedSet.has(imageFile.path)}
            onAutoStackToggle={onToggleAutoStack}
            onContextMenu={onContextMenu}
            onImageClick={onImageClick}
            onImageDoubleClick={onImageDoubleClick}
            onLoad={onImageLoad}
            aspectRatio={thumbnailAspectRatio}
          />
        </div>
      ))}
    </div>
  );
};

const LibraryEntityItem = ({
  path,
  stack,
  isListView,
  isActive,
  isSelected,
  onAutoStackToggle,
  onContextMenu,
  onImageClick,
  onImageDoubleClick,
  onLoad,
  aspectRatio,
}: {
  path: string;
  stack?: LibraryAutoStackDisplay | undefined;
  isListView: boolean;
  isActive: boolean;
  isSelected: boolean;
  onAutoStackToggle: (stackId: string) => void;
  onContextMenu: LibraryImageContextMenuHandler;
  onImageClick: LibraryImageClickHandler;
  onImageDoubleClick: LibraryImageDoubleClickHandler;
  onLoad: LibraryImageLoadHandler;
  aspectRatio: ThumbnailAspectRatio;
}) => {
  const image = useLibraryImage(path);
  if (!image) return null;
  const common = {
    autoStack: stack,
    isActive,
    isSelected,
    onAutoStackToggle,
    onContextMenu,
    onImageClick,
    onImageDoubleClick,
    onLoad,
    path,
    rating: image.rating,
    tags: image.tags ? [...image.tags] : null,
    exif: image.exif ? { ...image.exif } : null,
    aspectRatio,
  };
  return isListView ? (
    <ListItem {...common} modified={image.modified} />
  ) : (
    <Thumbnail {...common} isEdited={image.is_edited} />
  );
};

export const Row = memo(RowComponent);
