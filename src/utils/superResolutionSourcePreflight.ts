import { z } from 'zod';
import {
  type SuperResolutionSourceValidationInputV1,
  type SuperResolutionSourceValidationResultV1,
  validateSuperResolutionSourcesV1,
} from '../../packages/rawengine-schema/src/super-resolution/superResolutionSourceValidation.ts';
import { parseExifInteger, parseExposureEv, readExifString } from './exifPreflightMetadata';

export const superResolutionSourcePreflightMetadataSchema = z
  .object({
    exif: z.record(z.string(), z.string()).nullable().optional(),
    height: z.number().int().positive().optional(),
    imagePath: z.string().trim().min(1),
    sourceIndex: z.number().int().nonnegative(),
    width: z.number().int().positive().optional(),
  })
  .strict();

export const superResolutionSourcePreflightRequestSchema = z
  .object({
    requestedScale: z.number().min(1).max(4),
    sources: z.array(superResolutionSourcePreflightMetadataSchema).min(1),
  })
  .strict();

export type SuperResolutionSourcePreflightMetadata = z.infer<typeof superResolutionSourcePreflightMetadataSchema>;

export interface SuperResolutionSourcePreflightResult {
  status: 'blocked' | 'metadata_missing' | 'ready';
  missingMetadataCount: number;
  validation: SuperResolutionSourceValidationResultV1 | null;
}

export const buildSuperResolutionSourcePreflight = (requestValue: unknown): SuperResolutionSourcePreflightResult => {
  const request = superResolutionSourcePreflightRequestSchema.parse(requestValue);
  const validationSources = request.sources.map(toValidationSource).filter((source) => source !== null);

  if (validationSources.length !== request.sources.length) {
    return {
      missingMetadataCount: request.sources.length - validationSources.length,
      status: 'metadata_missing',
      validation: null,
    };
  }

  const validation = validateSuperResolutionSourcesV1({
    requestedScale: request.requestedScale,
    sources: validationSources,
  });

  return {
    missingMetadataCount: 0,
    status: validation.accepted ? 'ready' : 'blocked',
    validation,
  };
};

export const createSuperResolutionSourcePreflightMetadata = (
  sourcePaths: string[],
  imageRecords: Array<{
    exif?: Record<string, string> | null;
    path: string;
  }>,
): SuperResolutionSourcePreflightMetadata[] => {
  const imageByPath = new Map(imageRecords.map((image) => [image.path, image]));
  return sourcePaths.map((imagePath, sourceIndex) => {
    const exif = imageByPath.get(imagePath)?.exif ?? null;
    return superResolutionSourcePreflightMetadataSchema.parse({
      exif,
      height: parseExifInteger(exif, ['ImageHeight', 'ExifImageHeight', 'PixelYDimension']),
      imagePath,
      sourceIndex,
      width: parseExifInteger(exif, ['ImageWidth', 'ExifImageWidth', 'PixelXDimension']),
    });
  });
};

const toValidationSource = (
  source: SuperResolutionSourcePreflightMetadata,
): SuperResolutionSourceValidationInputV1 | null => {
  if (source.width === undefined || source.height === undefined) return null;

  return {
    cameraMake: readExifString(source.exif, ['Make']),
    cameraModel: readExifString(source.exif, ['Model']),
    colorSpaceHint: readExifString(source.exif, ['ColorSpace', 'ColorSpaceData']),
    exposureEv: parseExposureEv(source.exif),
    fixtureStatus: 'private_raw',
    height: source.height,
    imagePath: source.imagePath,
    iso: parseExifInteger(source.exif, ['PhotographicSensitivity', 'ISOSpeedRatings', 'ISO']),
    lensModel: readExifString(source.exif, ['LensModel', 'Lens', 'LensInfo']),
    rawBlackLevelKnown: false,
    rawDefaultsApplied: false,
    rawWhiteLevelKnown: false,
    shiftX: parseShift(source.imagePath, 'x'),
    shiftY: parseShift(source.imagePath, 'y'),
    sourceIndex: source.sourceIndex,
    width: source.width,
  };
};

const parseShift = (imagePath: string, axis: 'x' | 'y'): number | undefined => {
  const match = new RegExp(`(?:shift|d)${axis}[-_=](\\d+)`, 'iu').exec(imagePath);
  if (!match) return undefined;
  const parsed = Number.parseInt(match[1] ?? '', 10);
  return Number.isFinite(parsed) ? parsed : undefined;
};
