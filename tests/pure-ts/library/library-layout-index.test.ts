import { expect, test } from 'bun:test';
import type { ImageFile } from '../../../src/components/ui/AppProperties';
import { LibraryViewMode } from '../../../src/components/ui/AppProperties';
import { buildLibraryLayoutIndex } from '../../../src/library/buildLibraryLayoutIndex';
import {
  buildLibrarySemanticIndex,
  buildLibraryVisibleSemanticIndex,
} from '../../../src/library/buildLibrarySemanticIndex';
import { buildLibraryAutoStackItems } from '../../../src/utils/libraryAutoStacks';

const baseExif = {
  DateTimeOriginal: '2026:06:01 12:00:00',
  ExposureTime: '1/500',
  FNumber: '5.6',
  FocalLength: '35',
  ISO: '100',
  LensModel: 'FE 35mm',
  Make: 'Sony',
  Model: 'ILCE-7CR',
};

const image = (path: string, second: number, exposure = '1/500'): ImageFile => ({
  exif: {
    ...baseExif,
    DateTimeOriginal: `2026:06:01 12:00:0${second}`,
    ExposureTime: exposure,
  },
  is_edited: false,
  is_virtual_copy: path.includes('?vc='),
  modified: 1_780_000_000 + second,
  path,
  rating: 0,
  tags: null,
});

const layout = (
  images: ImageFile[],
  viewMode: LibraryViewMode,
  columnCount: number,
  expanded = new Set<string>(),
  collapsed = new Set<string>(),
  baseFolder = '/library',
) => {
  const semantic = buildLibrarySemanticIndex(images, baseFolder);
  const visible = buildLibraryVisibleSemanticIndex(semantic, expanded, viewMode);
  return buildLibraryLayoutIndex(visible, {
    collapsedFolderPaths: collapsed,
    columnCount,
    footerHeight: 12,
    headerHeight: 40,
    rowHeight: viewMode === LibraryViewMode.Recursive ? 120 : 44,
    viewMode,
  });
};

const paths = (index: ReturnType<typeof layout>) =>
  index.rows.flatMap((row) => {
    if (row.type !== 'item-range') return [];
    return Array.from({ length: row.count }, (_, slot) => index.getItem(row, slot)?.path).filter(
      (path): path is string => path !== undefined,
    );
  });

test('builds empty, partial, and one-through-twelve-column layouts without copied row arrays', () => {
  expect(layout([], LibraryViewMode.Flat, 4).rows).toEqual([{ type: 'footer', key: 'footer', height: 12 }]);
  const images = Array.from({ length: 17 }, (_, index) => image(`/library/frame-${index}.arw`, index % 9));
  for (let columns = 1; columns <= 12; columns += 1) {
    const index = layout(images, LibraryViewMode.Flat, columns);
    expect(paths(index)).toEqual(buildLibraryAutoStackItems(images, new Set()).map((item) => item.image.path));
    const itemRows = index.rows.filter((row) => row.type === 'item-range');
    expect(itemRows).toHaveLength(Math.ceil(index.items.length / columns));
    expect(itemRows.at(-1)?.count).toBe(index.items.length % columns || columns);
  }
});

test('preserves recursive folder ordering, collapse behavior, and cross-platform paths', () => {
  const images = [
    image('/library/sub/z.arw', 0),
    image('/library/base.arw', 4),
    image('C:\\photos\\trip\\a.arw', 5),
    image('/library/sub/a.arw', 6),
  ];
  const index = layout(images, LibraryViewMode.Recursive, 2, new Set(), new Set(['/library/sub']));
  const headers = index.rows.filter((row) => row.type === 'folder-header');
  expect(headers.map((row) => row.folderPath)).toEqual(['/library', '/library/sub', 'C:\\photos\\trip']);
  expect(paths(index)).toEqual(['/library/base.arw', 'C:\\photos\\trip\\a.arw']);
  expect(headers[1]).toMatchObject({ expanded: false, itemCount: 2 });
});

test('matches legacy flat and recursive stack visibility including virtual copies', () => {
  const images = [
    image('/library/burst-1.arw', 0),
    image('/library/burst-2.arw', 1),
    image('/library/burst-3.arw', 2),
    image('/library/burst-3.arw?vc=1', 3),
    image('/library/sub/hdr-1.arw', 4, '1/250'),
    image('/library/sub/hdr-2.arw', 5, '1/60'),
    image('/library/sub/hdr-3.arw', 6, '1/15'),
  ];
  for (const mode of [LibraryViewMode.Flat, LibraryViewMode.Recursive]) {
    const collapsed = layout(images, mode, 3);
    const stackIds = new Set(
      collapsed.items.map((item) => item.stack?.id).filter((id): id is string => id !== undefined),
    );
    const expanded = layout(images, mode, 3, stackIds);
    expect(paths(expanded)).toEqual(images.map(({ path }) => path));
    expect(paths(collapsed)).toContain('/library/burst-3.arw?vc=1');
  }
});

test('width-only layout rebuilds retain semantic item identity and perform no range slices', () => {
  const images = Array.from({ length: 100 }, (_, index) => image(`/library/frame-${index}.arw`, index % 9));
  const semantic = buildLibrarySemanticIndex(images, '/library');
  const visible = buildLibraryVisibleSemanticIndex(semantic, new Set(), LibraryViewMode.Flat);
  const originalSlice = Array.prototype.slice;
  let sliceCalls = 0;
  Array.prototype.slice = function (...args) {
    sliceCalls += 1;
    return originalSlice.apply(this, args as []);
  };
  try {
    const first = buildLibraryLayoutIndex(visible, {
      collapsedFolderPaths: new Set(),
      columnCount: 3,
      footerHeight: 12,
      headerHeight: 40,
      rowHeight: 100,
      viewMode: LibraryViewMode.Flat,
    });
    const resized = buildLibraryLayoutIndex(visible, {
      collapsedFolderPaths: new Set(),
      columnCount: 7,
      footerHeight: 12,
      headerHeight: 40,
      rowHeight: 55,
      viewMode: LibraryViewMode.Flat,
    });
    expect(sliceCalls).toBe(0);
    expect(resized.items).toBe(first.items);
    expect(resized.items[20]).toBe(first.items[20]);
    expect(resized.getRowOffset(2)).toBe(110);
    expect(resized.totalHeight).toBe(resized.rows.slice(0, -1).length * 55 + 12);
  } finally {
    Array.prototype.slice = originalSlice;
  }
});

test('stack and folder toggles preserve unaffected item identity', () => {
  const images = [
    image('/library/burst-1.arw', 0),
    image('/library/burst-2.arw', 1),
    image('/library/burst-3.arw', 2),
    image('/library/single.arw', 8, '1/125'),
  ];
  const semantic = buildLibrarySemanticIndex(images, '/library');
  const collapsed = buildLibraryVisibleSemanticIndex(semantic, new Set(), LibraryViewMode.Flat);
  const stackId = collapsed.items[0]?.stack?.id;
  const expanded = buildLibraryVisibleSemanticIndex(semantic, new Set(stackId ? [stackId] : []), LibraryViewMode.Flat);
  expect(expanded.items.find((item) => item.path.endsWith('single.arw'))).toBe(
    collapsed.items.find((item) => item.path.endsWith('single.arw')),
  );

  const firstLayout = buildLibraryLayoutIndex(collapsed, {
    collapsedFolderPaths: new Set(),
    columnCount: 2,
    footerHeight: 12,
    headerHeight: 40,
    rowHeight: 100,
    viewMode: LibraryViewMode.Recursive,
  });
  const collapsedFolderLayout = buildLibraryLayoutIndex(collapsed, {
    collapsedFolderPaths: new Set(['/library']),
    columnCount: 2,
    footerHeight: 12,
    headerHeight: 40,
    rowHeight: 100,
    viewMode: LibraryViewMode.Recursive,
  });
  expect(collapsedFolderLayout.items).toBe(firstLayout.items);
});

test('list layout exposes variable header, item, footer heights and active-path offsets', () => {
  const index = layout([image('/library/a.arw', 0), image('/library/sub/a.arw', 5)], LibraryViewMode.Recursive, 1);
  expect(Array.from(index.offsets)).toEqual([0, 40, 160, 200, 320, 332]);
  const rowIndex = index.getRowIndexForPath('/library/sub/a.arw');
  expect(rowIndex).toBe(3);
  expect(index.getRowOffset(rowIndex ?? -1)).toBe(200);
});
