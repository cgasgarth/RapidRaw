import type { FilterCriteria, ImageFile, SortCriteria } from '../../src/components/ui/AppProperties';
import { RawStatus, SortDirection } from '../../src/components/ui/AppProperties';
import { compileLibraryQuery } from '../../src/library/compileLibraryQuery';
import { LibraryProjectionCache } from '../../src/library/LibraryProjectionCache';
import { normalizeSupportedTypes, parseShutter } from '../../src/library/LibrarySearchProjection';
import type { SearchCriteria } from '../../src/store/useLibraryStore';

const supportedTypes = { raw: ['arw', 'raf', 'dng'], nonRaw: ['jpg', 'jpeg', 'png'] };
const normalizedTypes = normalizeSupportedTypes(supportedTypes);
const noFilter: FilterCriteria = { colors: [], rating: 0, rawStatus: RawStatus.All };
const search: SearchCriteria = { tags: ['travel', 'iso>=400'], text: 'frame', mode: 'OR' };
const sort: SortCriteria = { key: 'shutter_speed', order: SortDirection.Descending };

for (const size of [10_000, 50_000, 100_000]) benchmark(size);

function benchmark(size: number): void {
  const images = fixtures(size);
  const cache = new LibraryProjectionCache();
  const heapBefore = process.memoryUsage().heapUsed;
  const coldStart = performance.now();
  const projections = images.map((image) => cache.getOrBuild(image, image.rating, normalizedTypes));
  const coldMs = performance.now() - coldStart;
  let comparatorCalls = 0;

  const repeatedStart = performance.now();
  for (let iteration = 0; iteration < 5; iteration++) {
    const query = compileLibraryQuery(search, noFilter, sort);
    projections.filter(query.filter).sort((a, b) => {
      comparatorCalls++;
      return query.compare(a, b);
    });
  }
  const repeatedMs = performance.now() - repeatedStart;

  const legacyStart = performance.now();
  for (let iteration = 0; iteration < 5; iteration++) legacySearchAndSort(images);
  const legacyMs = performance.now() - legacyStart;

  const rawStart = performance.now();
  const rawKeys = new Set(projections.filter((item) => item.isRaw).map((item) => item.rawPairKey));
  projections.filter((item) => !(item.isNonRaw && rawKeys.has(item.rawPairKey)));
  const rawPairMs = performance.now() - rawStart;
  const heapMb = (process.memoryUsage().heapUsed - heapBefore) / 1024 / 1024;

  console.log(
    JSON.stringify({
      size,
      coldMs: round(coldMs),
      repeatedProjectedMs: round(repeatedMs),
      repeatedLegacyMs: round(legacyMs),
      speedup: round(legacyMs / repeatedMs),
      rawPairMs: round(rawPairMs),
      projectionBuilds: cache.buildCount,
      comparatorCalls,
      heapGrowthMb: round(heapMb),
    }),
  );
}

function legacySearchAndSort(images: ImageFile[]): ImageFile[] {
  const filtered = images.filter((image) => {
    const tags = (image.tags ?? []).map((tag) => tag.toLowerCase().replace('user:', ''));
    const fileName = image.path.split(/[\\/]/).pop()?.toLowerCase() ?? '';
    const iso = Number.parseInt(image.exif?.PhotographicSensitivity ?? '0', 10) || 0;
    return (
      (tags.some((tag) => tag.includes('travel')) || iso >= 400) &&
      (fileName.includes('frame') || tags.some((tag) => tag.includes('frame')))
    );
  });
  return filtered.sort((a, b) => {
    const comparison = parseShutter(a.exif?.ExposureTime) - parseShutter(b.exif?.ExposureTime);
    if (comparison !== 0) return -comparison;
    const nameA = a.path.split(/[\\/]/).pop() ?? a.path;
    const nameB = b.path.split(/[\\/]/).pop() ?? b.path;
    return nameA.localeCompare(nameB);
  });
}

function fixtures(size: number): ImageFile[] {
  return Array.from({ length: size }, (_, index) => {
    const paired = index % 10 === 0;
    const extension = paired ? (index % 20 === 0 ? 'ARW' : 'JPG') : index % 3 === 0 ? 'RAF' : 'JPG';
    const frame = paired ? Math.floor(index / 2) * 2 : index;
    return {
      path: `/library/2025/session-${index % 200}/frame-${frame.toString().padStart(6, '0')}.${extension}`,
      modified: 1_700_000_000 + index,
      rating: index % 6,
      tags: [`user:${index % 4 === 0 ? 'Travel' : 'Portrait'}`, `color:${['red', 'blue', 'green'][index % 3]}`],
      exif: {
        PhotographicSensitivity: String(100 * 2 ** (index % 6)),
        ExposureTime: `1/${30 + (index % 970)}`,
        FNumber: `f/${2 + (index % 8) / 2}`,
        FocalLength: `${24 + (index % 177)} mm`,
        DateTimeOriginal: `2025:01:${String(1 + (index % 28)).padStart(2, '0')}`,
        Make: index % 2 === 0 ? 'Sony' : 'Fujifilm',
        Model: `Camera ${index % 8}`,
        LensModel: `Lens ${index % 12}`,
      },
      is_edited: index % 5 === 0,
      is_virtual_copy: false,
    };
  });
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
