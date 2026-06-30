import type { ImageFile } from '../components/ui/AppProperties.tsx';
import { buildHdrBracketPreflight } from './hdrBracketPreflight.ts';

export type LibraryAutoStackKind = 'bracket' | 'burst';

export interface LibraryAutoStack {
  confidence: number;
  coverPath: string;
  id: string;
  kind: LibraryAutoStackKind;
  paths: string[];
}

export interface LibraryAutoStackDisplay {
  confidence: number;
  count: number;
  id: string;
  isCover: boolean;
  isExpanded: boolean;
  kind: LibraryAutoStackKind;
}

export interface LibraryAutoStackItem {
  image: ImageFile;
  stack?: LibraryAutoStackDisplay;
}

const MIN_STACK_SIZE = 3;
const MAX_BRACKET_SIZE = 5;
const BRACKET_TIME_WINDOW_SECONDS = 12;
const BURST_TIME_WINDOW_SECONDS = 3;
const BURST_STEP_SECONDS = 1.25;

export const buildLibraryAutoStacks = (images: ImageFile[]): LibraryAutoStack[] => {
  const stacks: LibraryAutoStack[] = [];
  let index = 0;

  while (index < images.length) {
    const bracket = findBracketStack(images, index);
    if (bracket) {
      stacks.push(bracket);
      index += bracket.paths.length;
      continue;
    }

    const burst = findBurstStack(images, index);
    if (burst) {
      stacks.push(burst);
      index += burst.paths.length;
      continue;
    }

    index += 1;
  }

  return stacks;
};

export const buildLibraryAutoStackItems = (
  images: ImageFile[],
  expandedStackIds: ReadonlySet<string>,
): LibraryAutoStackItem[] => {
  const stacks = buildLibraryAutoStacks(images);
  const stacksByPath = new Map<string, LibraryAutoStack>();
  const stackMemberPaths = new Set<string>();

  for (const stack of stacks) {
    for (const path of stack.paths) {
      stacksByPath.set(path, stack);
      stackMemberPaths.add(path);
    }
  }

  return images.flatMap((image) => {
    const stack = stacksByPath.get(image.path);
    if (!stack) return [{ image }];

    const isExpanded = expandedStackIds.has(stack.id);
    const isCover = image.path === stack.coverPath;
    if (!isExpanded && !isCover) return [];

    return [
      {
        image,
        stack: {
          confidence: stack.confidence,
          count: stack.paths.length,
          id: stack.id,
          isCover,
          isExpanded,
          kind: stack.kind,
        },
      },
    ];
  });
};

const findBracketStack = (images: ImageFile[], startIndex: number): LibraryAutoStack | null => {
  const start = images[startIndex];
  if (!isPhysicalImage(start)) return null;

  for (let size = Math.min(MAX_BRACKET_SIZE, images.length - startIndex); size >= MIN_STACK_SIZE; size -= 1) {
    const candidate = images.slice(startIndex, startIndex + size);
    if (!isAdjacentCaptureSet(candidate, BRACKET_TIME_WINDOW_SECONDS)) continue;

    const preflight = buildHdrBracketPreflight(candidate.map(({ path, exif }) => ({ path, exif })));
    if (!preflight?.accepted || preflight.detectionConfidence < 0.55) continue;

    return {
      confidence: preflight.detectionConfidence,
      coverPath: candidate[preflight.referenceSourceIndex]?.path ?? candidate[0]?.path ?? start.path,
      id: makeStackId('bracket', candidate),
      kind: 'bracket',
      paths: candidate.map(({ path }) => path),
    };
  }

  return null;
};

const findBurstStack = (images: ImageFile[], startIndex: number): LibraryAutoStack | null => {
  const start = images[startIndex];
  if (!isPhysicalImage(start)) return null;

  const candidate: ImageFile[] = [start];
  for (let index = startIndex + 1; index < images.length; index += 1) {
    const next = images[index];
    const previous = images[index - 1];
    if (!isPhysicalImage(next) || !previous) break;
    if (!isSameCameraLens(start, next) || !isSameExposure(start, next)) break;
    if (!isSameFolder(start.path, next.path)) break;

    const firstTime = getCaptureTimeSeconds(start);
    const nextTime = getCaptureTimeSeconds(next);
    const previousTime = getCaptureTimeSeconds(previous);
    if (firstTime === null || nextTime === null || previousTime === null) break;
    if (Math.abs(nextTime - previousTime) > BURST_STEP_SECONDS) break;
    if (Math.abs(nextTime - firstTime) > BURST_TIME_WINDOW_SECONDS) break;

    candidate.push(next);
  }

  if (candidate.length < MIN_STACK_SIZE) return null;

  return {
    confidence: Math.min(0.95, 0.68 + candidate.length * 0.04),
    coverPath: candidate[0]?.path ?? start.path,
    id: makeStackId('burst', candidate),
    kind: 'burst',
    paths: candidate.map(({ path }) => path),
  };
};

const isAdjacentCaptureSet = (images: ImageFile[], maxWindowSeconds: number): boolean => {
  const first = images[0];
  if (!first || images.length < MIN_STACK_SIZE) return false;
  if (!images.every(isPhysicalImage)) return false;
  if (!images.every((image) => isSameFolder(first.path, image.path) && isSameCameraLens(first, image))) return false;

  const times = images.map(getCaptureTimeSeconds);
  if (times.some((time) => time === null)) return false;
  const numericTimes = times as number[];
  return Math.max(...numericTimes) - Math.min(...numericTimes) <= maxWindowSeconds;
};

const isPhysicalImage = (image: ImageFile | undefined): image is ImageFile =>
  !!image && !image.is_virtual_copy && !image.path.includes('?vc=');

const isSameFolder = (leftPath: string, rightPath: string): boolean =>
  getFolderPath(leftPath) === getFolderPath(rightPath);

const getFolderPath = (path: string): string => {
  const physicalPath = path.split('?vc=')[0] ?? path;
  const separator = physicalPath.includes('/') ? '/' : '\\';
  const lastSeparator = physicalPath.lastIndexOf(separator);
  return lastSeparator >= 0 ? physicalPath.slice(0, lastSeparator) : '';
};

const isSameCameraLens = (left: ImageFile, right: ImageFile): boolean =>
  getExifText(left, 'Make') === getExifText(right, 'Make') &&
  getExifText(left, 'Model') === getExifText(right, 'Model') &&
  getExifText(left, 'LensModel') === getExifText(right, 'LensModel') &&
  getExifText(left, 'FocalLength') === getExifText(right, 'FocalLength') &&
  getExifText(left, 'FocalLengthIn35mmFilm') === getExifText(right, 'FocalLengthIn35mmFilm');

const isSameExposure = (left: ImageFile, right: ImageFile): boolean =>
  getExifText(left, 'ExposureTime') === getExifText(right, 'ExposureTime') &&
  getExifText(left, 'FNumber') === getExifText(right, 'FNumber') &&
  getExifText(left, 'ISO', 'PhotographicSensitivity') === getExifText(right, 'ISO', 'PhotographicSensitivity');

const getExifText = (image: ImageFile, ...keys: string[]): string => {
  for (const key of keys) {
    const value = image.exif?.[key]?.trim();
    if (value) return value;
  }
  return '';
};

const getCaptureTimeSeconds = (image: ImageFile): number | null => {
  const exifTime = image.exif?.['DateTimeOriginal'] ?? image.exif?.['CreateDate'];
  const parsedExifTime = parseExifDateTimeSeconds(exifTime);
  if (parsedExifTime !== null) return parsedExifTime;
  if (!Number.isFinite(image.modified)) return null;
  return image.modified > 1e11 ? image.modified / 1000 : image.modified;
};

const parseExifDateTimeSeconds = (value: string | undefined): number | null => {
  if (!value) return null;
  const normalized = value.trim().replace(/^(\d{4}):(\d{2}):(\d{2})/u, '$1-$2-$3');
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed / 1000 : null;
};

const makeStackId = (kind: LibraryAutoStackKind, images: ImageFile[]): string => {
  const first = images[0]?.path ?? '';
  const last = images.at(-1)?.path ?? first;
  return `${kind}:${first}:${last}:${images.length}`;
};
