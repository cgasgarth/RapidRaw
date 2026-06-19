import { z } from 'zod';

export const focusStackSourceValidationBlockCodeV1Schema = z.enum([
  'dimension_mismatch',
  'duplicate_source_indexes',
  'source_count_too_low',
]);

export const focusStackSourceValidationWarningCodeV1Schema = z.enum([
  'camera_or_lens_mismatch',
  'exposure_or_iso_mismatch',
  'focus_order_inferred',
  'focus_spacing_irregular',
  'raw_geometry_unverified',
  'white_balance_mismatch',
]);

export const focusStackSourceValidationInputV1Schema = z
  .object({
    cameraMake: z.string().trim().min(1).optional(),
    cameraModel: z.string().trim().min(1).optional(),
    captureTimestamp: z.iso.datetime({ offset: true }).optional(),
    contentHash: z.string().trim().min(1).optional(),
    exposureEv: z.number().optional(),
    focusDistanceMm: z.number().positive().optional(),
    graphRevision: z.string().trim().min(1).optional(),
    height: z.number().int().positive(),
    imageId: z.string().trim().min(1).optional(),
    imagePath: z.string().trim().min(1),
    iso: z.number().positive().optional(),
    lensModel: z.string().trim().min(1).optional(),
    rawBlackLevelKnown: z.boolean(),
    rawWhiteLevelKnown: z.boolean(),
    sourceIndex: z.number().int().nonnegative(),
    virtualCopyId: z.string().trim().min(1).nullable().optional(),
    whiteBalanceComparable: z.boolean(),
    width: z.number().int().positive(),
  })
  .strict();

export const focusStackSourceValidationRequestV1Schema = z
  .object({
    focusSpacingToleranceRatio: z.number().nonnegative().default(0.6),
    sources: z.array(focusStackSourceValidationInputV1Schema).min(1),
  })
  .strict();

export const focusStackSourceValidationMetadataV1Schema = focusStackSourceValidationInputV1Schema.extend({
  resolvedFocusRole: z.enum(['front', 'middle', 'back', 'unknown']),
});

export const focusStackSourceValidationResultV1Schema = z
  .object({
    accepted: z.boolean(),
    blockCodes: z.array(focusStackSourceValidationBlockCodeV1Schema),
    detectionConfidence: z.number().min(0).max(1),
    focusSpanMm: z.number().nonnegative().nullable(),
    referenceSourceIndex: z.number().int().nonnegative(),
    sourceMetadata: z.array(focusStackSourceValidationMetadataV1Schema).min(1),
    warningCodes: z.array(focusStackSourceValidationWarningCodeV1Schema),
  })
  .strict();

export type FocusStackSourceValidationBlockCodeV1 = z.infer<typeof focusStackSourceValidationBlockCodeV1Schema>;
export type FocusStackSourceValidationInputV1 = z.infer<typeof focusStackSourceValidationInputV1Schema>;
export type FocusStackSourceValidationResultV1 = z.infer<typeof focusStackSourceValidationResultV1Schema>;
export type FocusStackSourceValidationWarningCodeV1 = z.infer<typeof focusStackSourceValidationWarningCodeV1Schema>;

type FocusSourceWithDistance = FocusStackSourceValidationInputV1 & { focusDistanceMm: number };

export const validateFocusStackSourcesV1 = (requestValue: unknown): FocusStackSourceValidationResultV1 => {
  const request = focusStackSourceValidationRequestV1Schema.parse(requestValue);
  const { sources } = request;
  const blockCodes: FocusStackSourceValidationBlockCodeV1[] = [];
  const warningCodes: FocusStackSourceValidationWarningCodeV1[] = [];

  if (sources.length < 2) blockCodes.push('source_count_too_low');
  if (new Set(sources.map((source) => source.sourceIndex)).size !== sources.length) {
    blockCodes.push('duplicate_source_indexes');
  }
  if (hasDimensionMismatch(sources)) blockCodes.push('dimension_mismatch');
  if (hasCameraOrLensMismatch(sources)) warningCodes.push('camera_or_lens_mismatch');
  if (hasExposureOrIsoMismatch(sources)) warningCodes.push('exposure_or_iso_mismatch');
  if (sources.some((source) => !source.whiteBalanceComparable)) warningCodes.push('white_balance_mismatch');
  if (sources.some((source) => !source.rawBlackLevelKnown || !source.rawWhiteLevelKnown)) {
    warningCodes.push('raw_geometry_unverified');
  }

  const sourcesWithFocusDistance = sources.filter(hasFocusDistance);
  if (sourcesWithFocusDistance.length !== sources.length || !isFocusOrderAscending(sourcesWithFocusDistance)) {
    warningCodes.push('focus_order_inferred');
  }
  if (hasIrregularFocusSpacing(sourcesWithFocusDistance, request.focusSpacingToleranceRatio)) {
    warningCodes.push('focus_spacing_irregular');
  }

  const referenceSourceIndex = getReferenceSourceIndex(sources, sourcesWithFocusDistance);
  const focusSpanMm = getFocusSpanMm(sourcesWithFocusDistance, sources.length);

  return focusStackSourceValidationResultV1Schema.parse({
    accepted: blockCodes.length === 0,
    blockCodes: unique(blockCodes),
    detectionConfidence: getDetectionConfidence(warningCodes, blockCodes),
    focusSpanMm,
    referenceSourceIndex,
    sourceMetadata: sources.map((source) => ({
      ...source,
      resolvedFocusRole: getFocusRole(source, sourcesWithFocusDistance),
    })),
    warningCodes: unique(warningCodes),
  });
};

const hasDimensionMismatch = (sources: FocusStackSourceValidationInputV1[]): boolean => {
  const [firstSource] = sources;
  if (firstSource === undefined) return false;
  return sources.some((source) => source.width !== firstSource.width || source.height !== firstSource.height);
};

const hasCameraOrLensMismatch = (sources: FocusStackSourceValidationInputV1[]): boolean => {
  const [firstSource] = sources;
  if (firstSource === undefined) return false;
  return sources.some(
    (source) =>
      isKnownMismatch(source.cameraMake, firstSource.cameraMake) ||
      isKnownMismatch(source.cameraModel, firstSource.cameraModel) ||
      isKnownMismatch(source.lensModel, firstSource.lensModel),
  );
};

const hasExposureOrIsoMismatch = (sources: FocusStackSourceValidationInputV1[]): boolean => {
  const [firstSource] = sources;
  if (firstSource === undefined) return false;
  return sources.some(
    (source) =>
      (source.exposureEv !== undefined &&
        firstSource.exposureEv !== undefined &&
        Math.abs(source.exposureEv - firstSource.exposureEv) > 0.1) ||
      (source.iso !== undefined && firstSource.iso !== undefined && source.iso !== firstSource.iso),
  );
};

const hasFocusDistance = (source: FocusStackSourceValidationInputV1): source is FocusSourceWithDistance =>
  source.focusDistanceMm !== undefined;

const isFocusOrderAscending = (sources: FocusSourceWithDistance[]): boolean =>
  sources.every((source, index) => {
    const previousSource = sources[index - 1];
    return previousSource === undefined || source.focusDistanceMm >= previousSource.focusDistanceMm;
  });

const hasIrregularFocusSpacing = (sources: FocusSourceWithDistance[], toleranceRatio: number): boolean => {
  if (sources.length < 3) return false;
  const sortedDistances = sources.map((source) => source.focusDistanceMm).sort((left, right) => left - right);
  const spacings = sortedDistances.slice(1).map((distance, index) => distance - (sortedDistances[index] ?? distance));
  const averageSpacing = spacings.reduce((total, spacing) => total + spacing, 0) / spacings.length;
  if (averageSpacing <= 0) return false;
  return spacings.some((spacing) => Math.abs(spacing - averageSpacing) / averageSpacing > toleranceRatio);
};

const getReferenceSourceIndex = (
  sources: FocusStackSourceValidationInputV1[],
  sourcesWithFocusDistance: FocusSourceWithDistance[],
): number => {
  const sorted = [...sourcesWithFocusDistance].sort((left, right) => left.focusDistanceMm - right.focusDistanceMm);
  return (
    sorted[Math.floor(sorted.length / 2)]?.sourceIndex ?? sources[Math.floor(sources.length / 2)]?.sourceIndex ?? 0
  );
};

const getFocusSpanMm = (sources: FocusSourceWithDistance[], expectedSourceCount: number): number | null => {
  if (sources.length !== expectedSourceCount) return null;
  const distances = sources.map((source) => source.focusDistanceMm);
  return roundMm(Math.max(...distances) - Math.min(...distances));
};

const getFocusRole = (
  source: FocusStackSourceValidationInputV1,
  sourcesWithFocusDistance: FocusSourceWithDistance[],
): FocusStackSourceValidationResultV1['sourceMetadata'][number]['resolvedFocusRole'] => {
  if (source.focusDistanceMm === undefined || sourcesWithFocusDistance.length < 2) return 'unknown';
  const distances = sourcesWithFocusDistance.map((candidate) => candidate.focusDistanceMm);
  if (source.focusDistanceMm === Math.min(...distances)) return 'front';
  if (source.focusDistanceMm === Math.max(...distances)) return 'back';
  return 'middle';
};

const getDetectionConfidence = (
  warnings: FocusStackSourceValidationWarningCodeV1[],
  blocks: FocusStackSourceValidationBlockCodeV1[],
): number => Math.max(0.05, roundConfidence(0.99 - unique(warnings).length * 0.07 - unique(blocks).length * 0.24));

const isKnownMismatch = (left: string | undefined, right: string | undefined): boolean =>
  left !== undefined && right !== undefined && left !== right;

const roundMm = (value: number): number => Math.round(value * 1000) / 1000;

const roundConfidence = (value: number): number => Math.round(value * 1000) / 1000;

const unique = <T>(values: T[]): T[] => Array.from(new Set(values));
