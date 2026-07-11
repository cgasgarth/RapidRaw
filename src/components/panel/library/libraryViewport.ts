import type { LibraryLayoutIndex } from '../../../library/buildLibraryLayoutIndex';

export type LibraryLayoutChange = 'dimensions-only' | 'row-heights' | 'order-or-membership' | 'session-replaced';

export interface LibraryViewportAnchor {
  path: string | null;
  rowIndex: number;
  offsetWithinRowPx: number;
  fallbackScrollTop: number;
}

export interface LibraryLayoutSnapshot {
  layoutIndex: LibraryLayoutIndex;
  rowHeight: number;
  headerHeight: number;
  footerHeight: number;
  contentRevision: unknown;
  sessionId: string | null;
}

export const getLibraryRowHeight = (layout: LibraryLayoutSnapshot, index: number): number => {
  return layout.layoutIndex.getRowHeight(index);
};

export const getLibraryRowTop = (layout: LibraryLayoutSnapshot, rowIndex: number): number => {
  return layout.layoutIndex.getRowOffset(rowIndex);
};

export const findLibraryPathRow = (layout: LibraryLayoutSnapshot, path: string): number =>
  layout.layoutIndex.getRowIndexForPath(path) ?? -1;

export const classifyLibraryLayoutChange = (
  previous: LibraryLayoutSnapshot,
  next: LibraryLayoutSnapshot,
): LibraryLayoutChange => {
  if (previous.sessionId !== next.sessionId) return 'session-replaced';
  if (
    previous.rowHeight !== next.rowHeight ||
    previous.headerHeight !== next.headerHeight ||
    previous.footerHeight !== next.footerHeight
  ) {
    return 'row-heights';
  }
  return previous.contentRevision === next.contentRevision ? 'dimensions-only' : 'order-or-membership';
};

export const captureLibraryViewportAnchor = (
  layout: LibraryLayoutSnapshot,
  scrollTop: number,
  preferredPath: string | null = null,
): LibraryViewportAnchor => {
  const preferredRow = preferredPath ? findLibraryPathRow(layout, preferredPath) : -1;
  let rowIndex = preferredRow;
  if (rowIndex < 0) {
    let top = 0;
    rowIndex = Math.max(0, layout.layoutIndex.rows.length - 1);
    for (let index = 0; index < layout.layoutIndex.rows.length; index++) {
      const bottom = top + getLibraryRowHeight(layout, index);
      if (bottom > scrollTop) {
        rowIndex = index;
        break;
      }
      top = bottom;
    }
  }
  const row = layout.layoutIndex.getRow(rowIndex);
  const path =
    preferredRow >= 0
      ? preferredPath
      : row?.type === 'item-range'
        ? (layout.layoutIndex.getItem(row, 0)?.path ?? null)
        : null;
  return {
    path,
    rowIndex,
    offsetWithinRowPx: preferredRow >= 0 ? 0 : scrollTop - getLibraryRowTop(layout, rowIndex),
    fallbackScrollTop: scrollTop,
  };
};

export const resolveLibraryViewportAnchor = (
  layout: LibraryLayoutSnapshot,
  anchor: LibraryViewportAnchor,
  maxScrollTop = Number.POSITIVE_INFINITY,
): number => {
  const pathRow = anchor.path ? findLibraryPathRow(layout, anchor.path) : -1;
  const rowIndex = pathRow >= 0 ? pathRow : Math.min(anchor.rowIndex, Math.max(0, layout.layoutIndex.rows.length - 1));
  const desired =
    pathRow >= 0 ? getLibraryRowTop(layout, rowIndex) + anchor.offsetWithinRowPx : anchor.fallbackScrollTop;
  return Math.max(0, Math.min(desired, maxScrollTop));
};
