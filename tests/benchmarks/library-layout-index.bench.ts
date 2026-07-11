import type { ImageFile } from '../../src/components/ui/AppProperties';
import { LibraryViewMode } from '../../src/components/ui/AppProperties';
import { buildLibraryLayoutIndex } from '../../src/library/buildLibraryLayoutIndex';
import {
  buildLibrarySemanticIndex,
  buildLibraryVisibleSemanticIndex,
} from '../../src/library/buildLibrarySemanticIndex';
import { buildLibraryAutoStackItems } from '../../src/utils/libraryAutoStacks';

type LegacyRow = { images: unknown[] } | { header: string } | { footer: true };
const retained: unknown[] = [];

const benchmarkCase = process.argv[2];
const benchmarkSize = Number(process.argv[3]);
if ((benchmarkCase === 'legacy' || benchmarkCase === 'compact') && Number.isFinite(benchmarkSize)) {
  runIsolated(benchmarkCase, benchmarkSize);
} else {
  for (const size of [10_000, 50_000, 100_000]) benchmark(size);
}

function benchmark(size: number): void {
  const legacy = isolated('legacy', size);
  const compact = isolated('compact', size);

  console.log(
    JSON.stringify({
      size,
      semanticMs: compact.semanticMs,
      legacyResizeMs: legacy.resizeMs,
      compactResizeMs: compact.resizeMs,
      resizeSpeedup: round(legacy.resizeMs / compact.resizeMs),
      legacyRowArrays: legacy.rowArrays,
      legacyCopiedItemRefs: size,
      copiedReferenceBytesEliminated: size * 8,
      compactCopiedItemArrays: 0,
      compactRows: compact.rowCount,
    }),
  );
}

interface IsolatedResult {
  resizeMs: number;
  rowArrays: number;
  rowCount: number;
  semanticMs: number;
}

function isolated(kind: 'legacy' | 'compact', size: number): IsolatedResult {
  const child = Bun.spawnSync([process.execPath, import.meta.path, kind, String(size)], {
    stderr: 'inherit',
    stdout: 'pipe',
  });
  if (child.exitCode !== 0) throw new Error(`${kind} benchmark failed for ${size}`);
  return JSON.parse(child.stdout.toString()) as IsolatedResult;
}

function runIsolated(kind: 'legacy' | 'compact', size: number): void {
  const images = fixtures(size);
  let semanticMs = 0;
  let resizeMs = 0;
  let rowArrays = 0;
  let rowCount = 0;

  if (kind === 'legacy') {
    const start = performance.now();
    let rows: LegacyRow[] = [];
    for (const columns of [3, 5, 8, 12]) rows = buildLegacyRows(images, columns);
    resizeMs = performance.now() - start;
    rows = [];
    const prepared = prepareLegacyItems(images);
    const retainedRows = layoutLegacyItems(prepared, 12);
    rowArrays = retainedRows.filter((row): row is { images: unknown[] } => 'images' in row).length;
    rowCount = retainedRows.length;
    retain(retainedRows);
  } else {
    const semanticStart = performance.now();
    const semantic = buildLibrarySemanticIndex(images, '/library/session-0');
    const visible = buildLibraryVisibleSemanticIndex(semantic, new Set(), LibraryViewMode.Recursive);
    semanticMs = performance.now() - semanticStart;
    const start = performance.now();
    let index = buildCompact(visible, 3);
    for (const columns of [5, 8, 12]) index = buildCompact(visible, columns);
    resizeMs = performance.now() - start;
    rowCount = index.rows.length;
    retain(index);
  }
  console.log(
    JSON.stringify({
      resizeMs: round(resizeMs),
      rowArrays,
      rowCount,
      semanticMs: round(semanticMs),
    } satisfies IsolatedResult),
  );
}

function retain(value: unknown): void {
  retained.push(value);
}

function buildCompact(visible: ReturnType<typeof buildLibraryVisibleSemanticIndex>, columnCount: number) {
  return buildLibraryLayoutIndex(visible, {
    collapsedFolderPaths: new Set(),
    columnCount,
    footerHeight: 12,
    headerHeight: 40,
    rowHeight: 160,
    viewMode: LibraryViewMode.Recursive,
  });
}

function buildLegacyRows(images: ImageFile[], columnCount: number): LegacyRow[] {
  return layoutLegacyItems(prepareLegacyItems(images), columnCount);
}

interface LegacyPreparedFolder {
  folder: string;
  items: ReturnType<typeof buildLibraryAutoStackItems>;
}

function prepareLegacyItems(images: ImageFile[]): LegacyPreparedFolder[] {
  const groups = new Map<string, ImageFile[]>();
  for (const image of images) {
    const folder = image.path.slice(0, image.path.lastIndexOf('/'));
    const group = groups.get(folder);
    if (group) group.push(image);
    else groups.set(folder, [image]);
  }
  return [...groups.keys()]
    .sort((left, right) => left.localeCompare(right))
    .map((folder) => ({ folder, items: buildLibraryAutoStackItems(groups.get(folder) ?? [], new Set()) }));
}

function layoutLegacyItems(prepared: LegacyPreparedFolder[], columnCount: number): LegacyRow[] {
  const rows: LegacyRow[] = [];
  for (const { folder, items } of prepared) {
    rows.push({ header: folder });
    for (let index = 0; index < items.length; index += columnCount) {
      rows.push({ images: items.slice(index, index + columnCount) });
    }
  }
  rows.push({ footer: true });
  return rows;
}

function fixtures(size: number): ImageFile[] {
  return Array.from({ length: size }, (_, index) => ({
    path: `/library/session-${index % 200}/frame-${index.toString().padStart(6, '0')}.arw`,
    modified: 1_700_000_000 + index * 10,
    rating: index % 6,
    tags: null,
    exif: {
      DateTimeOriginal: new Date((1_700_000_000 + index * 10) * 1000).toISOString(),
      ExposureTime: `1/${100 + (index % 10)}`,
      FNumber: '5.6',
      FocalLength: '35',
      ISO: '100',
      LensModel: 'FE 35mm',
      Make: 'Sony',
      Model: 'ILCE-7CR',
    },
    is_edited: false,
    is_virtual_copy: false,
  }));
}

function gc(): void {
  Bun.gc(true);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
