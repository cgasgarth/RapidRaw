import { LibraryViewMode } from '../components/ui/AppProperties';
import type { LibraryVisibleItem, LibraryVisibleSemanticIndex } from './buildLibrarySemanticIndex';

export type LibraryLayoutRow =
  | { type: 'folder-header'; key: string; folderPath: string; itemCount: number; expanded: boolean; height: number }
  | { type: 'item-range'; key: string; start: number; count: number; height: number; folderPath: string | null }
  | { type: 'footer'; key: 'footer'; height: number };

export interface LibraryLayoutIndex {
  columnCount: number;
  getItem(row: LibraryLayoutRow, slot: number): LibraryVisibleItem | undefined;
  getRow(index: number): LibraryLayoutRow | undefined;
  getRowHeight(index: number): number;
  getRowOffset(index: number): number;
  getRowIndexForPath(path: string): number | undefined;
  items: readonly LibraryVisibleItem[];
  offsets: Float64Array;
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
        if (path) rowIndexByPath.set(path, rowIndex);
      }
    }
  };

  if (options.viewMode === LibraryViewMode.Recursive) {
    semantic.folders.forEach((folder, folderIndex) => {
      const nextStart = semantic.folders[folderIndex + 1]?.itemStart ?? semantic.items.length;
      const visibleCount = nextStart - folder.itemStart;
      const expanded = !options.collapsedFolderPaths.has(folder.path);
      rows.push({
        type: 'folder-header',
        key: `folder:${folder.path}`,
        folderPath: folder.path,
        itemCount: folder.itemCount,
        expanded,
        height: options.headerHeight,
      });
      if (expanded) appendRanges(folder.itemStart, visibleCount, folder.path);
    });
  } else {
    appendRanges(0, semantic.items.length, null);
  }

  rows.push({ type: 'footer', key: 'footer', height: options.footerHeight });
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
    revision: nextLayoutRevision++,
    rows,
    semantic,
    totalHeight: offsets.at(-1) ?? 0,
  };
};
