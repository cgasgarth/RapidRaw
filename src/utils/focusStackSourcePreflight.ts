import { z } from 'zod';
import {
  type FocusStackSourceValidationInputV1,
  type FocusStackSourceValidationResultV1,
  validateFocusStackSourcesV1,
} from '../../packages/rawengine-schema/src/focus-stack/focusStackSourceValidation.ts';
import { parseExifDistanceMm, parseExifInteger, parseExposureEv, readExifString } from './exifPreflightMetadata';

export const focusStackSourcePreflightMetadataSchema = z
  .object({
    exif: z.record(z.string(), z.string()).nullable().optional(),
    graphRevision: z.string().min(1).optional(),
    height: z.number().int().positive().optional(),
    imagePath: z.string().trim().min(1),
    sourceIndex: z.number().int().nonnegative(),
    width: z.number().int().positive().optional(),
  })
  .strict();

export const focusStackSourcePreflightRequestSchema = z
  .object({
    sources: z.array(focusStackSourcePreflightMetadataSchema).min(1),
  })
  .strict();

export type FocusStackSourcePreflightMetadata = z.infer<typeof focusStackSourcePreflightMetadataSchema>;

export interface FocusStackSourcePreflightResult {
  status: 'blocked' | 'metadata_missing' | 'ready' | 'warning';
  missingMetadataCount: number;
  validation: FocusStackSourceValidationResultV1 | null;
}

export const buildFocusStackSourcePreflight = (requestValue: unknown): FocusStackSourcePreflightResult => {
  const request = focusStackSourcePreflightRequestSchema.parse(requestValue);
  const validationSources = request.sources.map(toValidationSource).filter((source) => source !== null);

  if (validationSources.length !== request.sources.length) {
    return {
      missingMetadataCount: request.sources.length - validationSources.length,
      status: 'metadata_missing',
      validation: null,
    };
  }

  const validation = validateFocusStackSourcesV1({ sources: validationSources });
  return {
    missingMetadataCount: 0,
    status: validation.accepted ? (validation.warningCodes.length > 0 ? 'warning' : 'ready') : 'blocked',
    validation,
  };
};

export const createFocusStackSourcePreflightMetadata = (
  sourcePaths: string[],
  imageRecords: Array<{
    exif?: Record<string, string> | null;
    is_edited?: boolean;
    modified?: number;
    path: string;
  }>,
): FocusStackSourcePreflightMetadata[] => {
  const imageByPath = new Map(imageRecords.map((image) => [image.path, image]));
  return sourcePaths.map((imagePath, sourceIndex) => {
    const exif = imageByPath.get(imagePath)?.exif ?? null;
    return focusStackSourcePreflightMetadataSchema.parse({
      exif,
      graphRevision: `library:${imageByPath.get(imagePath)?.modified ?? 0}:${imageByPath.get(imagePath)?.is_edited === true ? 'edited' : 'neutral'}`,
      height: parseExifInteger(exif, ['ImageHeight', 'ExifImageHeight', 'PixelYDimension']),
      imagePath,
      sourceIndex,
      width: parseExifInteger(exif, ['ImageWidth', 'ExifImageWidth', 'PixelXDimension']),
    });
  });
};

const toValidationSource = (source: FocusStackSourcePreflightMetadata): FocusStackSourceValidationInputV1 | null => {
  if (source.width === undefined || source.height === undefined) return null;

  return {
    cameraMake: readExifString(source.exif, ['Make']),
    cameraModel: readExifString(source.exif, ['Model']),
    exposureEv: parseExposureEv(source.exif),
    focusDistanceMm: parseExifDistanceMm(source.exif, ['FocusDistance', 'SubjectDistance', 'ApproximateFocusDistance']),
    height: source.height,
    imagePath: source.imagePath,
    iso: parseExifInteger(source.exif, ['PhotographicSensitivity', 'ISOSpeedRatings', 'ISO']),
    lensModel: readExifString(source.exif, ['LensModel', 'Lens', 'LensInfo']),
    rawBlackLevelKnown: false,
    rawWhiteLevelKnown: false,
    sourceIndex: source.sourceIndex,
    whiteBalanceComparable: readExifString(source.exif, ['WhiteBalance', 'WhiteBalanceMode']) !== undefined,
    width: source.width,
  };
};
