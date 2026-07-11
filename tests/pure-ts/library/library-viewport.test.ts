import { describe, expect, test } from 'bun:test';
import {
  captureLibraryViewportAnchor,
  classifyLibraryLayoutChange,
  type LibraryLayoutSnapshot,
  resolveLibraryViewportAnchor,
} from '../../../src/components/panel/library/libraryViewport';
import { type ImageFile, LibraryViewMode } from '../../../src/components/ui/AppProperties';
import { buildLibraryLayoutIndex } from '../../../src/library/buildLibraryLayoutIndex';
import {
  buildLibrarySemanticIndex,
  buildLibraryVisibleSemanticIndex,
} from '../../../src/library/buildLibrarySemanticIndex';

const image = (path: string, index: number): ImageFile => ({
  path,
  rating: 0,
  modified: index * 10,
  is_edited: false,
  is_virtual_copy: false,
  tags: null,
  exif: null,
});

interface LayoutOptions {
  contentRevision?: unknown;
  headerHeight?: number;
  rowHeight?: number;
  sessionId?: string | null;
  viewMode?: LibraryViewMode;
}

const layout = (paths: string[], options: LayoutOptions = {}): LibraryLayoutSnapshot => {
  const rowHeight = options.rowHeight ?? 100;
  const headerHeight = options.headerHeight ?? 40;
  const viewMode = options.viewMode ?? LibraryViewMode.Flat;
  const semantic = buildLibrarySemanticIndex(paths.map(image), '/folder');
  const visible = buildLibraryVisibleSemanticIndex(semantic, new Set(), viewMode);
  const layoutIndex = buildLibraryLayoutIndex(visible, {
    collapsedFolderPaths: new Set(),
    columnCount: 1,
    footerHeight: 12,
    headerHeight,
    rowHeight,
    viewMode,
  });
  return {
    layoutIndex,
    rowHeight,
    headerHeight,
    footerHeight: 12,
    contentRevision: options.contentRevision ?? paths,
    sessionId: options.sessionId ?? null,
  };
};

describe('library viewport transitions', () => {
  test('classifies dimensions, measurement, ordering, and session changes independently', () => {
    const revision = {};
    const initial = layout(['/a.raw'], { contentRevision: revision });
    expect(classifyLibraryLayoutChange(initial, { ...initial })).toBe('dimensions-only');
    expect(
      classifyLibraryLayoutChange(initial, layout(['/a.raw'], { contentRevision: revision, rowHeight: 120 })),
    ).toBe('row-heights');
    expect(classifyLibraryLayoutChange(initial, layout(['/a.raw']))).toBe('order-or-membership');
    expect(classifyLibraryLayoutChange(initial, { ...initial, sessionId: 'other' })).toBe('session-replaced');
  });

  test('keeps the first visible path and relative offset when row heights change', () => {
    const before = layout(['/a.raw', '/b.raw', '/c.raw']);
    const anchor = captureLibraryViewportAnchor(before, 135);
    const after = layout(['/a.raw', '/b.raw', '/c.raw'], { rowHeight: 160 });
    expect(anchor).toMatchObject({ path: '/b.raw', rowIndex: 1, offsetWithinRowPx: 35, fallbackScrollTop: 135 });
    expect(resolveLibraryViewportAnchor(after, anchor)).toBe(195);
  });

  test('anchors surviving active content across sort and uses pixel fallback after filtering', () => {
    const before = layout(['/a.raw', '/b.raw', '/c.raw']);
    const activeAnchor = captureLibraryViewportAnchor(before, 0, '/b.raw');
    const sorted = layout(['/c.raw', '/a.raw', '/b.raw']);
    expect(resolveLibraryViewportAnchor(sorted, activeAnchor)).toBe(200);

    const filtered = layout(['/a.raw']);
    expect(resolveLibraryViewportAnchor(filtered, { ...activeAnchor, fallbackScrollTop: 72 }, 40)).toBe(40);
  });

  test('accounts for recursive headers and clamps restoration to scroll bounds', () => {
    const paths = ['/folder/a.raw', '/folder/b.raw'];
    const before = layout(paths, { viewMode: LibraryViewMode.Recursive });
    const anchor = captureLibraryViewportAnchor(before, 155);
    expect(anchor).toMatchObject({ path: '/folder/b.raw', rowIndex: 2, offsetWithinRowPx: 15 });
    const after = layout(paths, { rowHeight: 200, viewMode: LibraryViewMode.Recursive });
    expect(resolveLibraryViewportAnchor(after, anchor, 230)).toBe(230);
  });
});
