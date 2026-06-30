import { expect, test } from 'bun:test';
import type { ImageFile } from '../../src/components/ui/AppProperties.tsx';
import {
  buildLibraryAutoStackItems,
  buildLibraryAutoStacks,
  type LibraryAutoStackKind,
} from '../../src/utils/libraryAutoStacks.ts';

const baseExif = {
  DateTimeOriginal: '2026:06:01 12:00:00',
  FNumber: '5.6',
  FocalLength: '35',
  ISO: '100',
  LensModel: 'FE 35mm',
  Make: 'Sony',
  Model: 'ILCE-7CR',
};

const makeImage = (path: string, exif: Record<string, string>, offsetSeconds = 0): ImageFile => ({
  exif: {
    ...baseExif,
    ...exif,
    DateTimeOriginal: `2026:06:01 12:00:0${offsetSeconds}`,
  },
  is_edited: false,
  is_virtual_copy: path.includes('?vc='),
  modified: 1_780_000_000 + offsetSeconds,
  path,
  rating: 0,
  tags: null,
});

const expectStackKind = (images: ImageFile[], kind: LibraryAutoStackKind, count: number) => {
  const [stack] = buildLibraryAutoStacks(images);
  expect(stack?.kind).toBe(kind);
  expect(stack?.paths).toEqual(images.slice(0, count).map(({ path }) => path));
  expect(stack?.paths).toHaveLength(count);
  return stack;
};

test('detects adjacent HDR bracket stacks from exposure changes', () => {
  const images = [
    makeImage('/shoot/a_-1ev.arw', { ExposureTime: '1/250' }, 0),
    makeImage('/shoot/a_+0ev.arw', { ExposureTime: '1/60' }, 1),
    makeImage('/shoot/a_+1ev.arw', { ExposureTime: '1/15' }, 2),
  ];

  const stack = expectStackKind(images, 'bracket', 3);

  expect(stack?.confidence).toBeGreaterThanOrEqual(0.55);
});

test('detects adjacent burst stacks from matching exposure metadata', () => {
  const images = [
    makeImage('/shoot/burst-001.arw', { ExposureTime: '1/500' }, 0),
    makeImage('/shoot/burst-002.arw', { ExposureTime: '1/500' }, 1),
    makeImage('/shoot/burst-003.arw', { ExposureTime: '1/500' }, 2),
  ];

  expectStackKind(images, 'burst', 3);
});

test('collapses stacks to cover images and expands members on demand', () => {
  const images = [
    makeImage('/shoot/burst-001.arw', { ExposureTime: '1/500' }, 0),
    makeImage('/shoot/burst-002.arw', { ExposureTime: '1/500' }, 1),
    makeImage('/shoot/burst-003.arw', { ExposureTime: '1/500' }, 2),
    makeImage('/shoot/single.arw', { ExposureTime: '1/125' }, 7),
  ];

  const collapsed = buildLibraryAutoStackItems(images, new Set());
  expect(collapsed.map(({ image }) => image.path)).toEqual(['/shoot/burst-001.arw', '/shoot/single.arw']);
  expect(collapsed[0]?.stack).toMatchObject({ count: 3, isCover: true, isExpanded: false, kind: 'burst' });

  const stackId = collapsed[0]?.stack?.id;
  expect(stackId).toBeDefined();
  const expanded = buildLibraryAutoStackItems(images, new Set([stackId ?? '']));
  expect(expanded.map(({ image }) => image.path)).toEqual(images.map(({ path }) => path));
  expect(expanded.slice(0, 3).every(({ stack }) => stack?.isExpanded)).toBe(true);
});

test('does not group virtual copies as physical stack members', () => {
  const images = [
    makeImage('/shoot/burst-001.arw', { ExposureTime: '1/500' }, 0),
    makeImage('/shoot/burst-001.arw?vc=1', { ExposureTime: '1/500' }, 1),
    makeImage('/shoot/burst-002.arw', { ExposureTime: '1/500' }, 2),
    makeImage('/shoot/burst-003.arw', { ExposureTime: '1/500' }, 3),
  ];

  expect(buildLibraryAutoStacks(images)).toEqual([]);
  expect(buildLibraryAutoStackItems(images, new Set()).map(({ image }) => image.path)).toEqual(
    images.map(({ path }) => path),
  );
});
