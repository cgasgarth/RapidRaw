import { z } from 'zod';

import {
  detectHdrBracketV1,
  type HdrBracketDetectionSourceInputV1,
} from '../../packages/rawengine-schema/src/hdr/hdrBracketDetection.ts';

import type { HdrBracketDetectionResultV1 } from '../../packages/rawengine-schema/src/rawEngineSchemas.ts';

export const hdrBracketPreflightSourceMetadataSchema = z
  .object({
    contentHash: z.string().trim().min(1).optional(),
    exif: z.record(z.string(), z.string()).nullable().optional(),
    graphRevision: z.string().trim().min(1).optional(),
    path: z.string().trim().min(1),
  })
  .strict();

export const hdrBracketPreflightSourceMetadataListSchema = z.array(hdrBracketPreflightSourceMetadataSchema).min(2);

export type HdrBracketPreflightSourceMetadata = z.infer<typeof hdrBracketPreflightSourceMetadataSchema>;

export const buildHdrBracketPreflight = (sourcesValue: unknown): HdrBracketDetectionResultV1 | null => {
  const parsedSources = hdrBracketPreflightSourceMetadataListSchema.safeParse(sourcesValue);
  if (!parsedSources.success) return null;

  return detectHdrBracketV1({
    sources: parsedSources.data.map(toDetectionSource),
  });
};

const toDetectionSource = (
  source: HdrBracketPreflightSourceMetadata,
  sourceIndex: number,
): HdrBracketDetectionSourceInputV1 => {
  const exif = source.exif ?? {};

  return {
    aperture: parsePositiveNumber(exif['FNumber']),
    cameraMake: cleanString(exif['Make']),
    cameraModel: cleanString(exif['Model']),
    contentHash: source.contentHash,
    declaredExposureEv: parseFilenameExposureEv(source.path),
    exposureCompensationEv: parseExposureCompensation(exif['ExposureBiasValue']),
    exposureTimeSeconds: parseExposureTime(exif['ExposureTime']),
    focalLengthMm: parsePositiveNumber(exif['FocalLengthIn35mmFilm'] ?? exif['FocalLength']),
    graphRevision: source.graphRevision,
    height: 1,
    imagePath: source.path,
    iso: parsePositiveNumber(exif['ISO'] ?? exif['PhotographicSensitivity']),
    lensModel: cleanString(exif['LensModel']),
    rawBlackLevelKnown: false,
    rawWhiteLevelKnown: false,
    sourceIndex,
    whiteBalanceComparable: true,
    width: 1,
  };
};

const cleanString = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const parseNumber = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  const fraction = /(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)/u.exec(value);
  if (fraction?.[1] !== undefined && fraction[2] !== undefined) {
    const numerator = Number(fraction[1]);
    const denominator = Number(fraction[2]);
    return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0
      ? numerator / denominator
      : undefined;
  }

  const decimal = /-?\d+(?:\.\d+)?/u.exec(value)?.[0];
  if (decimal === undefined) return undefined;
  const parsed = Number(decimal);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const parseExposureTime = (value: string | undefined): number | undefined => {
  const parsed = parseNumber(value);
  return parsed !== undefined && parsed > 0 ? parsed : undefined;
};

const parsePositiveNumber = (value: string | undefined): number | undefined => {
  const parsed = parseNumber(value);
  return parsed !== undefined && parsed > 0 ? parsed : undefined;
};

const parseExposureCompensation = (value: string | undefined): number | undefined => {
  const parsed = parseNumber(value);
  return parsed !== undefined && Number.isFinite(parsed) ? parsed : undefined;
};

const parseFilenameExposureEv = (path: string): number | undefined => {
  const match = /(?:^|[-_\s])([+-]?\d+(?:\.\d+)?)\s*ev(?:[-_\s.]|$)/iu.exec(path);
  if (!match?.[1]) return undefined;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : undefined;
};
