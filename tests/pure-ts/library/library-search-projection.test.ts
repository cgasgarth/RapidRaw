import { describe, expect, test } from 'bun:test';

import {
  EditedStatus,
  type FilterCriteria,
  type ImageFile,
  RawStatus,
  type SortCriteria,
  SortDirection,
  type SupportedTypes,
} from '../../../src/components/ui/AppProperties.tsx';
import { computeSortedLibrary } from '../../../src/hooks/library/useSortedLibrary.ts';
import { LibraryProjectionCache } from '../../../src/library/LibraryProjectionCache.ts';
import {
  buildLibrarySearchProjection,
  normalizeSupportedTypes,
  parseAperture,
  parseFocalLength,
  parseShutter,
} from '../../../src/library/LibrarySearchProjection.ts';
import type { SearchCriteria } from '../../../src/store/useLibraryStore.ts';

const supportedTypes: SupportedTypes = { raw: ['arw', 'RAF'], nonRaw: ['jpg', 'JPEG', 'png'] };
const noSearch: SearchCriteria = { tags: [], text: '', mode: 'OR' };
const allFilter: FilterCriteria = { colors: [], rating: 0, rawStatus: RawStatus.All };
const nameSort: SortCriteria = { key: 'name', order: SortDirection.Ascending };

describe('library projection normalization', () => {
  test.each([
    ['/photos/set/image.one.ARW', '/photos/set', 'image.one', 'arw'],
    ['C:\\photos\\set\\image.one.JPG', 'C:\\photos\\set', 'image.one', 'jpg'],
    ['/root/README', '/root', 'README', ''],
    ['/é/東京.raf', '/é', '東京', 'raf'],
    ['/root/.hidden', '/root', '', 'hidden'],
    ['root.ARW?vc=copy-1', '', 'root', 'arw'],
  ])('parses %s once', (path, parentDirectory, baseName, extension) => {
    const projection = project(image(path));
    expect({
      parentDirectory: projection.parentDirectory,
      baseName: projection.baseName,
      extension: projection.extension,
    }).toEqual({ parentDirectory, baseName, extension });
  });

  test('preserves virtual entity identity while sharing physical RAW-pair identity', () => {
    const original = project(image('/set/frame.ARW'));
    const virtual = project(image('/set/frame.ARW?vc=1'));
    expect(virtual.path).not.toBe(original.path);
    expect(virtual.physicalPath).toBe(original.physicalPath);
    expect(virtual.rawPairKey).toBe(original.rawPairKey);
  });

  test.each([
    [undefined, 0],
    ['1/250 s', 0.004],
    ['2/0', 0],
    ['bad', 0],
    ['0.5s', 0.5],
  ])('normalizes shutter %s', (value, expected) => expect(parseShutter(value)).toBe(expected));

  test('normalizes aperture and focal values with legacy fallbacks', () => {
    expect(parseAperture('f/2.8')).toBe(2.8);
    expect(parseAperture('invalid')).toBe(0);
    expect(parseFocalLength('85 mm')).toBe(85);
    expect(parseFocalLength(undefined)).toBe(0);
  });
});

describe('library query journeys', () => {
  const fixtures = [
    image('/a/duplicate.JPG', {
      modified: 30,
      tags: ['user:Travel', 'color:red'],
      rating: 5,
      is_edited: true,
      exif: {
        DateTimeOriginal: '2024:01:02',
        PhotographicSensitivity: '800',
        ExposureTime: '1/250',
        FNumber: 'f/2.8',
        FocalLength: '35 mm',
        Make: 'Sony',
        Model: 'A7',
        LensModel: 'Prime',
      },
    }),
    image('/b/duplicate.ARW', {
      modified: 10,
      tags: ['user:Portrait'],
      rating: 3,
      exif: {
        DateTimeOriginal: '2024:01:01',
        ISOSpeedRatings: '100',
        ExposureTime: '1/30 s',
        FNumber: '5.6',
        FocalLength: '85mm',
        Make: 'Fuji',
        Model: 'X-T5',
        Lens: 'Tele',
      },
    }),
    image('/pair/frame.JPG', { modified: 20, tags: null, rating: 0 }),
    image('/pair/frame.ARW', { modified: 21, tags: ['color:blue'], rating: 1 }),
    image('/pair/frame.ARW?vc=1', { modified: 22, tags: ['user:Virtual'], rating: 1, is_virtual_copy: true }),
  ];
  const ratings = Object.fromEntries(fixtures.map((fixture) => [fixture.path, fixture.rating]));

  test.each([
    [
      'rating descending',
      noSearch,
      allFilter,
      { key: 'rating', order: SortDirection.Descending },
      ['/a/duplicate.JPG', '/b/duplicate.ARW', '/pair/frame.ARW', '/pair/frame.ARW?vc=1', '/pair/frame.JPG'],
    ],
    ['unrated', noSearch, { ...allFilter, rating: -1 }, nameSort, ['/pair/frame.JPG']],
    ['five star', noSearch, { ...allFilter, rating: 5 }, nameSort, ['/a/duplicate.JPG']],
    [
      'raw only',
      noSearch,
      { ...allFilter, rawStatus: RawStatus.RawOnly },
      nameSort,
      ['/b/duplicate.ARW', '/pair/frame.ARW', '/pair/frame.ARW?vc=1'],
    ],
    [
      'non-raw only',
      noSearch,
      { ...allFilter, rawStatus: RawStatus.NonRawOnly },
      nameSort,
      ['/a/duplicate.JPG', '/pair/frame.JPG'],
    ],
    [
      'raw over non-raw',
      noSearch,
      { ...allFilter, rawStatus: RawStatus.RawOverNonRaw },
      nameSort,
      ['/b/duplicate.ARW', '/a/duplicate.JPG', '/pair/frame.ARW', '/pair/frame.ARW?vc=1'],
    ],
    ['edited', noSearch, { ...allFilter, editedStatus: EditedStatus.EditedOnly }, nameSort, ['/a/duplicate.JPG']],
    [
      'color none',
      noSearch,
      { ...allFilter, colors: ['none'] },
      nameSort,
      ['/b/duplicate.ARW', '/pair/frame.ARW?vc=1', '/pair/frame.JPG'],
    ],
    ['text tag search', { ...noSearch, text: 'travel' }, allFilter, nameSort, ['/a/duplicate.JPG']],
    [
      'tag AND search',
      { tags: ['portrait', 'iso>=100'], text: '', mode: 'AND' },
      allFilter,
      nameSort,
      ['/b/duplicate.ARW'],
    ],
    [
      'tag OR search',
      { tags: ['color=blue', 'lens=prime'], text: '', mode: 'OR' },
      allFilter,
      nameSort,
      ['/a/duplicate.JPG', '/pair/frame.ARW'],
    ],
    ['camera search', { tags: ['camera:fuji'], text: '', mode: 'AND' }, allFilter, nameSort, ['/b/duplicate.ARW']],
    [
      'shutter search',
      { tags: ['shutter<1/100'], text: '', mode: 'AND' },
      allFilter,
      nameSort,
      ['/a/duplicate.JPG', '/pair/frame.ARW', '/pair/frame.ARW?vc=1', '/pair/frame.JPG'],
    ],
    ['focal search', { tags: ['mm>=85'], text: '', mode: 'AND' }, allFilter, nameSort, ['/b/duplicate.ARW']],
  ] as const)('%s', (_name, searchCriteria, filterCriteria, sortCriteria, expected) => {
    expect(run(fixtures, ratings, searchCriteria, filterCriteria, sortCriteria)).toEqual(expected);
  });

  test.each([
    'date_taken',
    'iso',
    'shutter_speed',
    'aperture',
    'focal_length',
    'date',
    'rating',
    'edited',
    'name',
  ])('sorts %s deterministically in both directions', (key) => {
    const ascending = run(fixtures, ratings, noSearch, allFilter, { key, order: SortDirection.Ascending });
    const descending = run(fixtures, ratings, noSearch, allFilter, { key, order: SortDirection.Descending });
    expect(ascending).toHaveLength(fixtures.length);
    expect(descending).toHaveLength(fixtures.length);
    expect(new Set(ascending)).toEqual(new Set(descending));
    expect(run(fixtures, ratings, noSearch, allFilter, { key, order: SortDirection.Ascending })).toEqual(ascending);
  });
});

describe('projection cache invalidation and hot path', () => {
  test('reuses unchanged inputs, rebuilds relevant changes, and ignores unrelated fields', () => {
    const cache = new LibraryProjectionCache();
    const types = normalizeSupportedTypes(supportedTypes);
    const current = image('/set/a.ARW', { tags: ['user:one'], exif: { FNumber: '2.8' } });
    const first = cache.getOrBuild(current, 1, types);
    expect(cache.getOrBuild({ ...current, unrelatedThumbnailUrl: 'blob:new' } as ImageFile, 1, types)).toBe(first);

    current.tags?.push('color:red');
    expect(cache.getOrBuild(current, 1, types)).not.toBe(first);
    const afterTag = cache.buildCount;
    expect(cache.getOrBuild({ ...current, modified: 2 }, 1, types).entityRevision).toBeGreaterThan(
      first.entityRevision,
    );
    expect(cache.getOrBuild({ ...current, exif: { ...current.exif, FNumber: '4' } }, 1, types).aperture).toBe(4);
    expect(cache.getOrBuild(current, 2, types).rating).toBe(2);
    expect(cache.buildCount).toBe(afterTag + 3);
  });

  test('does not build projections in filter or comparator execution and releases removed paths', () => {
    const cache = new LibraryProjectionCache();
    const fixtures = [image('/set/b.ARW'), image('/set/a.JPG')];
    run(fixtures, {}, noSearch, allFilter, nameSort, cache);
    const builds = cache.buildCount;
    run(fixtures, {}, { ...noSearch, text: 'a' }, allFilter, { key: 'iso', order: SortDirection.Descending }, cache);
    expect(cache.buildCount).toBe(builds);
    run(fixtures.slice(0, 1), {}, noSearch, allFilter, nameSort, cache);
    expect(cache.size).toBe(1);
  });

  test('supported extension revision rebuilds membership', () => {
    const cache = new LibraryProjectionCache();
    const current = image('/set/a.DNG');
    expect(cache.getOrBuild(current, 0, normalizeSupportedTypes(supportedTypes)).isRaw).toBe(false);
    expect(
      cache.getOrBuild(current, 0, normalizeSupportedTypes({ ...supportedTypes, raw: [...supportedTypes.raw, 'dng'] }))
        .isRaw,
    ).toBe(true);
  });
});

function image(path: string, overrides: Partial<ImageFile> = {}): ImageFile {
  return { path, modified: 0, rating: 0, tags: [], exif: {}, is_edited: false, is_virtual_copy: false, ...overrides };
}

function project(current: ImageFile) {
  return buildLibrarySearchProjection(current, {
    entityRevision: 1,
    rating: current.rating,
    stableOrdinal: 0,
    supportedTypes: normalizeSupportedTypes(supportedTypes),
  });
}

function run(
  imageList: ImageFile[],
  imageRatings: Record<string, number>,
  searchCriteria: SearchCriteria,
  filterCriteria: FilterCriteria,
  sortCriteria: SortCriteria,
  cache = new LibraryProjectionCache(),
): string[] {
  return computeSortedLibrary(
    { imageList, imageRatings, searchCriteria, filterCriteria, sortCriteria },
    { supportedTypes },
    cache,
  ).map((current) => current.path);
}
