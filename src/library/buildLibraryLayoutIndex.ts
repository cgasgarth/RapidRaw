import { LibraryViewMode } from '../components/ui/AppProperties';
import type { LibraryVisibleItem, LibraryVisibleSemanticIndex } from './buildLibrarySemanticIndex';

export type LibraryLayoutRow =
  | { type: 'folder-header'; key: string; folderPath: string; itemCount: number; expanded: boolean; height: number }
  | { type: 'item-range'; key: string; start: number; count: number; height: number; folderPath: string | null }
  | { type: 'footer'; key: 'footer'; height: number };

export interface LibraryPathLayoutEntry {
  path: string;
  rowIndex: number | null;
  slotIndex: number | null;
  folderPath: string | null;
  folderCollapsed: boolean;
  stackId: string | null;
  stackCollapsed: boolean;
  stackCoverPath: string | null;
  visibleRepresentativePath: string | null;
}

export type LibraryPathRevealResolution =
  | { status: 'visible'; path: string; rowIndex: number; slotIndex: number; top: number; bottom: number }
  | {
      status: 'representative';
      requestedPath: string;
      path: string;
      rowIndex: number;
      slotIndex: number;
      top: number;
      bottom: number;
    }
  | {
      status: 'collapsed-folder';
      path: string;
      folderPath: string;
      headerRowIndex: number;
      top: number;
      bottom: number;
    }
  | { status: 'not-visible'; path: string };

export interface LibraryLayoutIndex {
  columnCount: number;
  getItem(row: LibraryLayoutRow, slot: number): LibraryVisibleItem | undefined;
  getRow(index: number): LibraryLayoutRow | undefined;
  getRowHeight(index: number): number;
  getRowOffset(index: number): number;
  getRowIndexForPath(path: string): number | undefined;
  items: readonly LibraryVisibleItem[];
  offsets: Float64Array;
  pathToLayout: ReadonlyMap<string, LibraryPathLayoutEntry>;
  revision: number;
  rows: readonly LibraryLayoutRow[];
  semantic: LibraryVisibleSemanticIndex;
  totalHeight: number;
}

let nextLayoutRevision = 1;

export interface BuildLibraryLayoutIndexOptions {
  collapsedFolderPaths: ReadonlySet<string>;
  columnCount: number;
  footerHeight: number;
  headerHeight: number;
  rowHeight: number;
  viewMode: LibraryViewMode;
}

export const buildLibraryLayoutIndex = (
  semantic: LibraryVisibleSemanticIndex,
  options: BuildLibraryLayoutIndexOptions,
): LibraryLayoutIndex => {
  const columnCount = Math.max(1, options.columnCount);
  const rows: LibraryLayoutRow[] = [];
  const rowIndexByPath = new Map<string, number>();
  const pathToLayout = new Map<string, LibraryPathLayoutEntry>();
  const folderByImageIndex = new Map<number, string>();
  const collapsedFolderHeaderRows = new Map<string, number>();
  const visiblePaths = new Set(semantic.items.map((item) => item.path));
  for (const folder of semantic.semantic.folders) {
    for (let offset = 0; offset < folder.memberCount; offset += 1) {
      const imageIndex = semantic.semantic.folderMemberIndices[folder.memberStart + offset];
      if (imageIndex !== undefined) folderByImageIndex.set(imageIndex, folder.path);
    }
  }
  for (const source of semantic.semantic.sourceItems) {
    const stack = options.viewMode === LibraryViewMode.Recursive ? source.recursiveStack : source.flatStack;
    const folderPath =
      options.viewMode === LibraryViewMode.Recursive ? (folderByImageIndex.get(source.imageIndex) ?? null) : null;
    const folderCollapsed = folderPath !== null && options.collapsedFolderPaths.has(folderPath);
    const stackCollapsed = !!stack && !visiblePaths.has(source.path);
    pathToLayout.set(source.path, {
      path: source.path,
      rowIndex: null,
      slotIndex: null,
      folderPath,
      folderCollapsed,
      stackId: stack?.id ?? null,
      stackCollapsed,
      stackCoverPath: stack?.coverPath ?? null,
      visibleRepresentativePath: stackCollapsed ? (stack?.coverPath ?? null) : null,
    });
  }

  const appendRanges = (start: number, count: number, folderPath: string | null) => {
    for (let offset = 0; offset < count; offset += columnCount) {
      const rangeStart = start + offset;
      const rangeCount = Math.min(columnCount, count - offset);
      const firstPath = semantic.items[rangeStart]?.path ?? String(rangeStart);
      const rowIndex = rows.length;
      rows.push({
        type: 'item-range',
        key: `${folderPath ?? 'flat'}:${firstPath}:${columnCount}`,
        start: rangeStart,
        count: rangeCount,
        height: options.rowHeight,
        folderPath,
      });
      for (let slot = 0; slot < rangeCount; slot += 1) {
        const path = semantic.items[rangeStart + slot]?.path;
        if (path) {
          rowIndexByPath.set(path, rowIndex);
          const entry = pathToLayout.get(path);
          if (entry) {
            entry.rowIndex = rowIndex;
            entry.slotIndex = slot;
          }
        }
      }
    }
  };

  if (options.viewMode === LibraryViewMode.Recursive) {
    semantic.folders.forEach((folder, folderIndex) => {
      const nextStart = semantic.folders[folderIndex + 1]?.itemStart ?? semantic.items.length;
      const visibleCount = nextStart - folder.itemStart;
      const expanded = !options.collapsedFolderPaths.has(folder.path);
      const headerRowIndex = rows.length;
      rows.push({
        type: 'folder-header',
        key: `folder:${folder.path}`,
        folderPath: folder.path,
        itemCount: folder.itemCount,
        expanded,
        height: options.headerHeight,
      });
      if (!expanded) {
        collapsedFolderHeaderRows.set(folder.path, headerRowIndex);
      }
      if (expanded) appendRanges(folder.itemStart, visibleCount, folder.path);
    });
  } else {
    appendRanges(0, semantic.items.length, null);
  }

  rows.push({ type: 'footer', key: 'footer', height: options.footerHeight });
  for (const entry of pathToLayout.values()) {
    if (entry.folderPath) entry.rowIndex ??= collapsedFolderHeaderRows.get(entry.folderPath) ?? null;
  }
  const offsets = new Float64Array(rows.length + 1);
  rows.forEach((row, index) => {
    offsets[index + 1] = (offsets[index] ?? 0) + row.height;
  });

  return {
    columnCount,
    getItem: (row, slot) =>
      row.type === 'item-range' && slot >= 0 && slot < row.count ? semantic.items[row.start + slot] : undefined,
    getRow: (index) => rows[index],
    getRowHeight: (index) => rows[index]?.height ?? 0,
    getRowOffset: (index) => offsets[index] ?? offsets.at(-1) ?? 0,
    getRowIndexForPath: (path) => rowIndexByPath.get(path),
    items: semantic.items,
    offsets,
    pathToLayout,
    revision: nextLayoutRevision++,
    rows,
    semantic,
    totalHeight: offsets.at(-1) ?? 0,
  };
};

export const resolveLibraryPathReveal = (layout: LibraryLayoutIndex, path: string): LibraryPathRevealResolution => {
  const entry = layout.pathToLayout.get(path);
  if (!entry) return { status: 'not-visible', path };
  if (entry.folderCollapsed && entry.folderPath && entry.rowIndex !== null) {
    return {
      status: 'collapsed-folder',
      path,
      folderPath: entry.folderPath,
      headerRowIndex: entry.rowIndex,
      top: layout.getRowOffset(entry.rowIndex),
      bottom: layout.getRowOffset(entry.rowIndex) + layout.getRowHeight(entry.rowIndex),
    };
  }
  const representativePath = entry.visibleRepresentativePath;
  const visibleEntry = representativePath ? layout.pathToLayout.get(representativePath) : entry;
  if (!visibleEntry || visibleEntry.rowIndex === null || visibleEntry.slotIndex === null) {
    return { status: 'not-visible', path };
  }
  const top = layout.getRowOffset(visibleEntry.rowIndex);
  const bounds = {
    rowIndex: visibleEntry.rowIndex,
    slotIndex: visibleEntry.slotIndex,
    top,
    bottom: top + layout.getRowHeight(visibleEntry.rowIndex),
  };
  return representativePath
    ? { status: 'representative', requestedPath: path, path: representativePath, ...bounds }
    : { status: 'visible', path, ...bounds };
};
