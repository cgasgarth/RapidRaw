import { ChevronDown, ChevronUp } from 'lucide-react';
import type React from 'react';
import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { List, useListCallbackRef } from 'react-window';
import { useLibraryStore } from '../../../store/useLibraryStore';
import { useSettingsStore } from '../../../store/useSettingsStore';
import { thumbnailCache } from '../../../thumbnails/thumbnailCacheInstance';
import { TEXT_COLOR_KEYS, TextColors, TextVariants, TextWeights } from '../../../types/typography';
import { buildLibraryAutoStackItems } from '../../../utils/libraryAutoStacks';
import { debounce } from '../../../utils/timing';
import {
  ExifOverlay,
  type ImageFile,
  LibraryViewMode,
  type SortCriteria,
  SortDirection,
  type ThumbnailAspectRatio,
  ThumbnailSize,
} from '../../ui/AppProperties';
import UiText from '../../ui/primitives/Text';

import type { ColumnWidths } from '../MainLibrary';
import { type LibraryRow, type LibraryRowProps, Row } from './LibraryItems';
import {
  CORE_LIBRARY_COLUMN_KEYS,
  type ColumnWidthKey,
  columnWidthStyle,
  LIBRARY_COLUMN_KEYS,
  normalizedColumnPercentages,
} from './libraryColumnWidths';
import {
  captureLibraryViewportAnchor,
  classifyLibraryLayoutChange,
  findLibraryPathRow,
  getLibraryRowHeight,
  type LibraryLayoutSnapshot,
  resolveLibraryViewportAnchor,
} from './libraryViewport';
import { useLibraryColumnResize } from './useLibraryColumnResize';

type HeaderSortKey = SortCriteria['key'];
type RowRendererProps = Omit<LibraryRowProps, 'index' | 'style'>;
type VirtualizedRowProps = RowRendererProps & {
  ariaAttributes: {
    'aria-posinset': number;
    'aria-setsize': number;
    role: 'listitem';
  };
  index: number;
  style: CSSProperties;
};

interface ThumbnailSizeOption {
  id: ThumbnailSize;
  label: string;
  size: number;
}

interface ImageFolderGroup {
  path: string;
  images: ImageFile[];
}

interface ListHeaderProps {
  widths: ColumnWidths;
  resize: ReturnType<typeof useLibraryColumnResize>;
  sortCriteria: SortCriteria;
  onSortChange: (key: HeaderSortKey) => void;
}

interface HeaderColumnProps {
  resize: ReturnType<typeof useLibraryColumnResize>;
  onSortChange: (key: HeaderSortKey) => void;
  sortCriteria: SortCriteria;
  title: string;
  normalizedWidth: number;
  widthKey: ColumnWidthKey;
  nextKey?: ColumnWidthKey;
  sortKey?: HeaderSortKey;
}

interface GridData {
  rows: LibraryRow[];
  itemWidth: number;
  rowHeight: number;
  listRowHeight: number;
  OUTER_PADDING: number;
  ITEM_GAP: number;
  columnCount: number;
  isListView: boolean;
  headerHeight: number;
}

interface LibraryGridProps {
  imageList: ImageFile[];
  libraryViewMode: LibraryViewMode;
  thumbnailSize: ThumbnailSize;
  currentFolderPath: string | null;
  activePath: string | null;
  multiSelectedPaths: string[];
  onContextMenu: (event: ReactMouseEvent<HTMLElement>, path: string) => void;
  onImageClick: (path: string, event: ReactMouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>) => void;
  onImageDoubleClick: (path: string) => void;
  thumbnailAspectRatio: ThumbnailAspectRatio;
  onRequestThumbnails?: (paths: string[]) => void;
  thumbnailSizeOptions: ThumbnailSizeOption[];
  onThumbnailSizeChange: (size: ThumbnailSize) => void;
  onClearSelection: () => void;
  onEmptyAreaContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
}

const VirtualizedRow = ({ ariaAttributes: _ariaAttributes, ...rowProps }: VirtualizedRowProps): React.ReactElement => (
  <Row {...rowProps} />
);

function HeaderColumn({
  resize,
  onSortChange,
  sortCriteria,
  title,
  normalizedWidth,
  widthKey,
  nextKey,
  sortKey,
}: HeaderColumnProps) {
  const isSorted = sortCriteria.key === sortKey;
  const isAsc = sortCriteria.order === SortDirection.Ascending;
  const handleSortKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!sortKey || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    onSortChange(sortKey);
  };

  return (
    <div
      style={columnWidthStyle(widthKey)}
      className={`relative flex items-center px-3 h-full select-none ${
        sortKey ? 'cursor-pointer hover:bg-bg-primary/50 transition-colors' : ''
      }`}
      onClick={() => {
        if (sortKey) {
          onSortChange(sortKey);
        }
      }}
      onKeyDown={handleSortKeyDown}
      role={sortKey ? 'button' : undefined}
      tabIndex={sortKey ? 0 : undefined}
    >
      <UiText
        variant={TextVariants.small}
        weight={TextWeights.semibold}
        color={isSorted ? TextColors.primary : TextColors.secondary}
        className="uppercase tracking-wider text-[11px]"
      >
        {title}
      </UiText>
      {isSorted && (
        <span className={`ml-1 flex items-center ${TEXT_COLOR_KEYS[TextColors.primary]}`}>
          {isAsc ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </span>
      )}
      {nextKey && (
        <div
          className="absolute right-[-3px] top-1.5 bottom-1.5 w-[6px] cursor-col-resize z-10 group flex items-center justify-center"
          role="separator"
          aria-orientation="vertical"
          aria-valuemin={1}
          aria-valuemax={99}
          aria-valuenow={Math.round(normalizedWidth)}
          tabIndex={0}
          onPointerDown={(event) => resize.onPointerDown(event, widthKey, nextKey)}
          onPointerMove={resize.onPointerMove}
          onPointerUp={resize.onPointerUp}
          onPointerCancel={resize.onPointerCancel}
          onLostPointerCapture={resize.onLostPointerCapture}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            event.stopPropagation();
            const direction = event.key === 'ArrowRight' ? 1 : -1;
            resize.resizeWithKeyboard(widthKey, nextKey, direction * (event.shiftKey ? 5 : 0.5));
          }}
        >
          <div className="w-px h-full bg-border-color/40 group-hover:bg-accent transition-colors" />
        </div>
      )}
    </div>
  );
}

function ListHeader({ widths, resize, sortCriteria, onSortChange }: ListHeaderProps) {
  const { t } = useTranslation();
  const exifOverlay = useSettingsStore((s) => s.appSettings?.exifOverlay || ExifOverlay.Off);
  const showExifCols = exifOverlay !== ExifOverlay.Off;
  const visibleColumns = showExifCols ? LIBRARY_COLUMN_KEYS : CORE_LIBRARY_COLUMN_KEYS;
  const normalizedWidths = normalizedColumnPercentages(widths, visibleColumns);

  const headerColumnProps = {
    resize,
    onSortChange,
    sortCriteria,
  };

  return (
    <div className="flex items-center w-full h-9 bg-bg-secondary/80 backdrop-blur-sm border-b border-border-color/50 shrink-0">
      <HeaderColumn
        {...headerColumnProps}
        title=""
        widthKey="thumbnail"
        nextKey="name"
        normalizedWidth={normalizedWidths.thumbnail}
      />
      <HeaderColumn
        {...headerColumnProps}
        title={t('library.grid.columns.name')}
        widthKey="name"
        nextKey="date"
        normalizedWidth={normalizedWidths.name}
        sortKey="name"
      />
      <HeaderColumn
        {...headerColumnProps}
        title={t('library.grid.columns.modified')}
        widthKey="date"
        nextKey="rating"
        normalizedWidth={normalizedWidths.date}
        sortKey="date"
      />
      <HeaderColumn
        {...headerColumnProps}
        title={t('library.grid.columns.rating')}
        widthKey="rating"
        nextKey="color"
        normalizedWidth={normalizedWidths.rating}
        sortKey="rating"
      />
      {showExifCols ? (
        <>
          <HeaderColumn
            {...headerColumnProps}
            title={t('library.grid.columns.label')}
            widthKey="color"
            nextKey="shutter"
            normalizedWidth={normalizedWidths.color}
          />
          <HeaderColumn
            {...headerColumnProps}
            title={t('library.grid.columns.shutter')}
            widthKey="shutter"
            nextKey="aperture"
            normalizedWidth={normalizedWidths.shutter}
            sortKey="shutter_speed"
          />
          <HeaderColumn
            {...headerColumnProps}
            title={t('library.grid.columns.aperture')}
            widthKey="aperture"
            nextKey="iso"
            normalizedWidth={normalizedWidths.aperture}
            sortKey="aperture"
          />
          <HeaderColumn
            {...headerColumnProps}
            title={t('library.grid.columns.iso')}
            widthKey="iso"
            nextKey="focal"
            normalizedWidth={normalizedWidths.iso}
            sortKey="iso"
          />
          <HeaderColumn
            {...headerColumnProps}
            title={t('library.grid.columns.focal')}
            widthKey="focal"
            normalizedWidth={normalizedWidths.focal}
            sortKey="focal_length"
          />
        </>
      ) : (
        <HeaderColumn
          {...headerColumnProps}
          title={t('library.grid.columns.label')}
          widthKey="color"
          normalizedWidth={normalizedWidths.color}
        />
      )}
    </div>
  );
}

const groupImagesByFolder = (images: ImageFile[], baseFolderPath: string | null): ImageFolderGroup[] => {
  const groups: Record<string, ImageFile[]> = {};

  images.forEach((img) => {
    const physicalPath = img.path.split('?vc=')[0] ?? img.path;
    const separator = physicalPath.includes('/') ? '/' : '\\';
    const lastSep = physicalPath.lastIndexOf(separator);
    const dir = lastSep > -1 ? physicalPath.substring(0, lastSep) : physicalPath;

    if (!groups[dir]) {
      groups[dir] = [];
    }
    groups[dir].push(img);
  });

  const sortedKeys = Object.keys(groups).sort((a, b) => {
    if (a === baseFolderPath) return -1;
    if (b === baseFolderPath) return 1;
    return a.localeCompare(b);
  });

  return sortedKeys.map((dir) => ({
    path: dir,
    images: groups[dir] ?? [],
  }));
};

export default function LibraryGrid(props: LibraryGridProps) {
  const {
    imageList,
    libraryViewMode,
    thumbnailSize,
    currentFolderPath,
    activePath,
    multiSelectedPaths,
    onContextMenu,
    onImageClick,
    onImageDoubleClick,
    thumbnailAspectRatio,
    onRequestThumbnails,
    thumbnailSizeOptions,
    onThumbnailSizeChange,
  } = props;
  const listColumnWidths = useLibraryStore((state) => state.listColumnWidths);
  const setLibrary = useLibraryStore((state) => state.setLibrary);
  const setListColumnWidths = useLibraryStore((state) => state.setListColumnWidths);
  const sortCriteria = useLibraryStore((state) => state.sortCriteria);
  const setSortCriteria = useLibraryStore((state) => state.setSortCriteria);
  const librarySessionId = useLibraryStore((state) => state.rootPaths.join('\u0000'));
  const [gridSize, setGridSize] = useState({ height: 0, width: 0 });
  const [listHandle, setListHandle] = useListCallbackRef();
  const [collapsedRecursiveFolders, setCollapsedRecursiveFolders] = useState<Set<string>>(new Set());
  const [expandedAutoStackIds, setExpandedAutoStackIds] = useState<Set<string>>(new Set());
  const libraryContainerRef = useRef<HTMLDivElement>(null);
  const gridObserverRef = useRef<ResizeObserver | null>(null);
  const loadedThumbnailsRef = useRef(new Set<string>());
  const requestQueueRef = useRef<Set<string>>(new Set());
  const requestTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusedPathRef = useRef<string | null>(null);
  const exifOverlay = useSettingsStore((s) => s.appSettings?.exifOverlay || ExifOverlay.Off);
  const visibleColumns = exifOverlay === ExifOverlay.Off ? CORE_LIBRARY_COLUMN_KEYS : LIBRARY_COLUMN_KEYS;
  const columnResize = useLibraryColumnResize({
    committedWidths: listColumnWidths,
    rootRef: libraryContainerRef,
    visibleColumns,
    commitWidths: setListColumnWidths,
    enabled: thumbnailSize === ThumbnailSize.List,
  });

  useEffect(() => {
    const el = libraryContainerRef.current;
    if (gridObserverRef.current) {
      gridObserverRef.current.disconnect();
      gridObserverRef.current = null;
    }
    if (el) {
      const ro = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (entry) {
          const { height, width } = entry.contentRect;
          setGridSize((prev) => (prev.height === height && prev.width === width ? prev : { height, width }));
        }
      });
      ro.observe(el);
      gridObserverRef.current = ro;
    }
    return () => gridObserverRef.current?.disconnect();
  }, [libraryContainerRef]);

  useEffect(() => {
    const handleWheel = (event: WheelEvent) => {
      const container = libraryContainerRef.current;
      const target = event.target;
      if (!container || !(target instanceof Node) || !container.contains(target)) {
        return;
      }

      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const currentIndex = thumbnailSizeOptions.findIndex((option) => option.id === thumbnailSize);
        if (currentIndex === -1) {
          return;
        }

        const nextIndex =
          event.deltaY < 0
            ? Math.min(currentIndex + 1, thumbnailSizeOptions.length - 1)
            : Math.max(currentIndex - 1, 0);
        const nextOption = thumbnailSizeOptions[nextIndex];
        if (nextIndex !== currentIndex && nextOption) {
          onThumbnailSizeChange(nextOption.id);
        }
      }
    };

    window.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      window.removeEventListener('wheel', handleWheel);
    };
  }, [thumbnailSize, onThumbnailSizeChange, thumbnailSizeOptions]);

  const handleScroll = useMemo(
    () =>
      debounce((top: number) => {
        setLibrary({ libraryScrollTop: top });
      }, 200),
    [setLibrary],
  );

  useEffect(
    () => () => {
      handleScroll.cancel();
      if (requestTimeoutRef.current) clearTimeout(requestTimeoutRef.current);
      requestQueueRef.current.clear();
    },
    [handleScroll],
  );

  const queueThumbnailRequest = useCallback(
    (path: string) => {
      if (!onRequestThumbnails) return;
      if (thumbnailCache.has(path)) return;
      requestQueueRef.current.add(path);
      if (!requestTimeoutRef.current) {
        requestTimeoutRef.current = setTimeout(() => {
          const paths = Array.from(requestQueueRef.current);
          if (paths.length > 0) {
            onRequestThumbnails(paths);
            requestQueueRef.current.clear();
          }
          requestTimeoutRef.current = null;
        }, 50);
      }
    },
    [onRequestThumbnails],
  );

  const handleToggleRecursiveFolder = useCallback((path: string) => {
    setCollapsedRecursiveFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const handleToggleAutoStack = useCallback((stackId: string) => {
    setExpandedAutoStackIds((prev) => {
      const next = new Set(prev);
      if (next.has(stackId)) {
        next.delete(stackId);
      } else {
        next.add(stackId);
      }
      return next;
    });
  }, []);

  const handleImageLoad = useCallback((path: string) => {
    loadedThumbnailsRef.current.add(path);
  }, []);

  const gridData = useMemo<GridData>(() => {
    const isListView = thumbnailSize === ThumbnailSize.List;
    const OUTER_PADDING = isListView ? 0 : 12;
    const ITEM_GAP = isListView ? 0 : 12;
    const minThumbWidth = thumbnailSizeOptions.find((option) => option.id === thumbnailSize)?.size || 240;

    const availableWidth = Math.max(0, gridSize.width - OUTER_PADDING * 2);
    const columnCount = isListView
      ? 1
      : Math.max(1, Math.floor((availableWidth + ITEM_GAP) / (minThumbWidth + ITEM_GAP)));
    const itemWidth = isListView ? availableWidth : (availableWidth - ITEM_GAP * (columnCount - 1)) / columnCount;

    // Draft resizing changes inherited cell widths only. The virtual row height updates once when the width is committed.
    const listRowHeight = Math.max(36, Math.min(300, (availableWidth * listColumnWidths.thumbnail) / 100));
    const rowHeight = isListView ? listRowHeight : itemWidth + ITEM_GAP;
    const headerHeight = 40;

    const rows: LibraryRow[] = [];

    if (libraryViewMode === LibraryViewMode.Recursive) {
      const groups = groupImagesByFolder(imageList, currentFolderPath);
      groups.forEach((group) => {
        const groupImages = group.images;
        if (groupImages.length === 0) return;

        const isExpanded = !collapsedRecursiveFolders.has(group.path);
        rows.push({ type: 'header', path: group.path, count: groupImages.length, isExpanded });

        if (isExpanded) {
          const stackItems = buildLibraryAutoStackItems(groupImages, expandedAutoStackIds);
          for (let i = 0; i < stackItems.length; i += columnCount) {
            rows.push({
              type: 'images',
              images: stackItems.slice(i, i + columnCount),
              startIndex: i,
            });
          }
        }
      });
    } else {
      const stackItems = buildLibraryAutoStackItems(imageList, expandedAutoStackIds);
      for (let i = 0; i < stackItems.length; i += columnCount) {
        rows.push({
          type: 'images',
          images: stackItems.slice(i, i + columnCount),
          startIndex: i,
        });
      }
    }

    rows.push({ type: 'footer' });

    return {
      rows,
      itemWidth,
      rowHeight,
      listRowHeight,
      OUTER_PADDING,
      ITEM_GAP,
      columnCount,
      isListView,
      headerHeight,
    };
  }, [
    gridSize.width,
    imageList,
    libraryViewMode,
    collapsedRecursiveFolders,
    expandedAutoStackIds,
    thumbnailSize,
    listColumnWidths.thumbnail,
    currentFolderPath,
    thumbnailSizeOptions,
  ]);

  const layoutSnapshot = useMemo<LibraryLayoutSnapshot>(
    () => ({
      rows: gridData.rows,
      rowHeight: gridData.rowHeight,
      headerHeight: gridData.headerHeight,
      footerHeight: gridData.isListView ? 24 : gridData.OUTER_PADDING,
      contentRevision: gridData.rows,
      // Folder navigation changes membership; replacing the configured roots starts a new session.
      sessionId: librarySessionId,
    }),
    [gridData, librarySessionId],
  );
  const layoutSnapshotRef = useRef(layoutSnapshot);
  layoutSnapshotRef.current = layoutSnapshot;
  const rowHeight = useMemo(
    () => (index: number) => getLibraryRowHeight(layoutSnapshotRef.current, index),
    [layoutSnapshot.rowHeight, layoutSnapshot.headerHeight, layoutSnapshot.footerHeight],
  );
  const previousLayoutRef = useRef(layoutSnapshot);
  const didRestoreSessionScrollRef = useRef(false);
  const focusRestoreFrameRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const element = listHandle?.element;
    if (!element) return;
    if (!didRestoreSessionScrollRef.current) {
      didRestoreSessionScrollRef.current = true;
      element.scrollTo({ top: useLibraryStore.getState().libraryScrollTop });
      previousLayoutRef.current = layoutSnapshot;
      return;
    }

    const previous = previousLayoutRef.current;
    previousLayoutRef.current = layoutSnapshot;
    const change = classifyLibraryLayoutChange(previous, layoutSnapshot);
    if (change === 'dimensions-only') return;
    if (change === 'session-replaced') {
      element.scrollTo({ top: useLibraryStore.getState().libraryScrollTop, behavior: 'instant' });
      return;
    }

    const activeElement = document.activeElement;
    const focusedPath =
      activeElement instanceof HTMLElement && element.contains(activeElement)
        ? (activeElement.closest<HTMLElement>('[data-image-path]')?.getAttribute('data-image-path') ?? null)
        : activeElement === document.body
          ? focusedPathRef.current
          : null;
    const preferredPath = change === 'order-or-membership' ? activePath : null;
    const anchor = captureLibraryViewportAnchor(previous, element.scrollTop, preferredPath);
    const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
    element.scrollTo({ top: resolveLibraryViewportAnchor(layoutSnapshot, anchor, maxScrollTop), behavior: 'instant' });

    if (focusedPath) {
      const focusPath =
        findLibraryPathRow(layoutSnapshot, focusedPath) >= 0
          ? focusedPath
          : activePath && findLibraryPathRow(layoutSnapshot, activePath) >= 0
            ? activePath
            : null;
      if (focusRestoreFrameRef.current !== null) cancelAnimationFrame(focusRestoreFrameRef.current);
      focusRestoreFrameRef.current = requestAnimationFrame(() => {
        focusRestoreFrameRef.current = null;
        const candidates = element.querySelectorAll<HTMLElement>('[data-image-path]');
        for (const candidate of candidates) {
          if (candidate.getAttribute('data-image-path') === focusPath) {
            candidate.focus({ preventScroll: true });
            focusedPathRef.current = focusPath;
            break;
          }
        }
        if (!focusPath) element.focus({ preventScroll: true });
      });
    }
  }, [activePath, layoutSnapshot, listHandle]);

  useEffect(
    () => () => {
      if (focusRestoreFrameRef.current !== null) cancelAnimationFrame(focusRestoreFrameRef.current);
    },
    [],
  );

  const prevActivePath = useRef<string | null>(null);

  useEffect(() => {
    if (!listHandle?.element || multiSelectedPaths.length > 1) {
      prevActivePath.current = activePath;
      return;
    }

    if (activePath === prevActivePath.current) return;
    prevActivePath.current = activePath;

    const element = listHandle.element as HTMLElement;
    const { rowHeight, headerHeight, columnCount } = gridData;

    let targetTop = 0;
    let found = false;

    if (libraryViewMode === LibraryViewMode.Recursive) {
      const groups = groupImagesByFolder(imageList, currentFolderPath);
      for (const group of groups) {
        const groupImages = group.images;
        if (groupImages.length === 0) continue;

        targetTop += headerHeight;

        const stackItems = buildLibraryAutoStackItems(groupImages, expandedAutoStackIds);
        const imageIndex = stackItems.findIndex((item) => item.image.path === activePath);
        if (imageIndex !== -1) {
          const rowIndex = Math.floor(imageIndex / columnCount);
          targetTop += rowIndex * rowHeight;
          found = true;
          break;
        }

        const rowsInGroup = Math.ceil(stackItems.length / columnCount);
        targetTop += rowsInGroup * rowHeight;
      }
    } else {
      const stackItems = buildLibraryAutoStackItems(imageList, expandedAutoStackIds);
      const index = stackItems.findIndex((item) => item.image.path === activePath);
      if (index !== -1) {
        const rowIndex = Math.floor(index / columnCount);
        targetTop = rowIndex * rowHeight;
        found = true;
      }
    }

    if (found) {
      const clientHeight = element.clientHeight;
      const scrollTop = element.scrollTop;
      const itemBottom = targetTop + rowHeight;
      const SCROLL_OFFSET = 120;

      if (itemBottom > scrollTop + clientHeight) {
        element.scrollTo({
          top: itemBottom - clientHeight + SCROLL_OFFSET,
          behavior: 'smooth',
        });
      } else if (targetTop < scrollTop) {
        element.scrollTo({
          top: Math.max(0, targetTop - SCROLL_OFFSET),
          behavior: 'smooth',
        });
      }
    }
  }, [
    activePath,
    gridData,
    multiSelectedPaths.length,
    listHandle,
    currentFolderPath,
    imageList,
    libraryViewMode,
    expandedAutoStackIds,
  ]);

  const memoizedRowProps = useMemo<RowRendererProps>(() => {
    return {
      rows: gridData?.rows ?? [],
      activePath,
      multiSelectedSet: new Set(multiSelectedPaths),
      onContextMenu,
      onImageClick,
      onImageDoubleClick,
      thumbnailAspectRatio,
      onImageLoad: handleImageLoad,
      baseFolderPath: currentFolderPath,
      itemWidth: gridData?.itemWidth ?? 0,
      itemHeight: gridData ? (gridData.isListView ? gridData.listRowHeight : gridData.itemWidth) : 0,
      outerPadding: gridData?.OUTER_PADDING ?? 0,
      gap: gridData?.ITEM_GAP ?? 0,
      isListView: gridData?.isListView ?? false,
      queueThumbnailRequest,
      onToggleRecursiveFolder: handleToggleRecursiveFolder,
      onToggleAutoStack: handleToggleAutoStack,
    };
  }, [
    gridData,
    activePath,
    multiSelectedPaths,
    onContextMenu,
    onImageClick,
    onImageDoubleClick,
    thumbnailAspectRatio,
    handleImageLoad,
    currentFolderPath,
    queueThumbnailRequest,
    handleToggleRecursiveFolder,
    handleToggleAutoStack,
  ]);

  const handleHeaderSort = (key: HeaderSortKey) => {
    props.onClearSelection();
    setSortCriteria((prev) => {
      if (prev.key === key) {
        if (prev.order === SortDirection.Ascending) {
          return { ...prev, order: SortDirection.Descending };
        } else {
          return { key: 'name', order: SortDirection.Ascending };
        }
      }
      return { key, order: SortDirection.Ascending };
    });
  };

  return (
    <div
      ref={libraryContainerRef}
      className={`flex-1 w-full h-full ${columnResize.isResizing ? 'cursor-col-resize' : ''}`}
      data-library-column-resizing={columnResize.isResizing || undefined}
      role="presentation"
      onFocusCapture={(event) => {
        if (event.target instanceof HTMLElement) {
          focusedPathRef.current =
            event.target.closest<HTMLElement>('[data-image-path]')?.getAttribute('data-image-path') ?? null;
        }
      }}
      onClick={props.onClearSelection}
      onContextMenu={props.onEmptyAreaContextMenu}
    >
      <div className="flex flex-col w-full h-full">
        {gridData.isListView && (
          <ListHeader
            widths={listColumnWidths}
            resize={columnResize}
            sortCriteria={sortCriteria}
            onSortChange={handleHeaderSort}
          />
        )}
        <div style={{ height: gridData.isListView ? gridSize.height - 36 : gridSize.height, width: gridSize.width }}>
          <List<RowRendererProps>
            listRef={setListHandle}
            rowCount={gridData.rows.length}
            rowHeight={rowHeight}
            onScroll={(e: React.UIEvent<HTMLElement>) => {
              handleScroll(e.currentTarget.scrollTop);
            }}
            className="custom-scrollbar"
            tabIndex={-1}
            rowComponent={VirtualizedRow}
            rowProps={memoizedRowProps}
          />
        </div>
      </div>
    </div>
  );
}
