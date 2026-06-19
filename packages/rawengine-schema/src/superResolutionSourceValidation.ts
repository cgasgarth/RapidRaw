import { z } from 'zod';

export const superResolutionSourceValidationBlockCodeV1Schema = z.enum([
  'dimension_mismatch',
  'duplicate_source_indexes',
  'source_count_too_low',
]);

export const superResolutionSourceValidationWarningCodeV1Schema = z.enum([
  'camera_or_lens_mismatch',
  'color_space_mismatch',
  'content_hash_missing',
  'exposure_or_iso_mismatch',
  'graph_revision_missing',
  'public_fixture_metadata_only',
  'raw_defaults_missing',
  'raw_geometry_unverified',
  'source_order_inferred',
  'subpixel_shift_metadata_missing',
]);

export const superResolutionSourceValidationDowngradeReasonV1Schema = z.enum([
  'exposure_or_iso_mismatch',
  'insufficient_source_count_for_requested_scale',
  'missing_subpixel_shift_metadata',
  'public_fixture_metadata_only',
  'raw_geometry_unverified',
]);

export const superResolutionSourceValidationFixtureStatusV1Schema = z.enum([
  'private_raw',
  'public_fixture_metadata_only',
]);

export const superResolutionSourceValidationInputV1Schema = z
  .object({
    cameraMake: z.string().trim().min(1).optional(),
    cameraModel: z.string().trim().min(1).optional(),
    captureTimestamp: z.iso.datetime({ offset: true }).optional(),
    colorSpaceHint: z.string().trim().min(1).optional(),
    contentHash: z.string().trim().min(1).optional(),
    exposureEv: z.number().optional(),
    fixtureStatus: superResolutionSourceValidationFixtureStatusV1Schema.default('private_raw'),
    graphRevision: z.string().trim().min(1).optional(),
    height: z.number().int().positive(),
    imageId: z.string().trim().min(1).optional(),
    imagePath: z.string().trim().min(1),
    iso: z.number().positive().optional(),
    lensModel: z.string().trim().min(1).optional(),
    rawBlackLevelKnown: z.boolean(),
    rawDefaultsApplied: z.boolean(),
    rawWhiteLevelKnown: z.boolean(),
    shiftX: z.number().int().nonnegative().optional(),
    shiftY: z.number().int().nonnegative().optional(),
    sourceIndex: z.number().int().nonnegative(),
    width: z.number().int().positive(),
  })
  .strict();

export const superResolutionSourceValidationRequestV1Schema = z
  .object({
    requestedScale: z.number().min(1).max(4).default(2),
    sources: z.array(superResolutionSourceValidationInputV1Schema).min(1),
  })
  .strict();

export const superResolutionSourceValidationMetadataV1Schema = superResolutionSourceValidationInputV1Schema.extend({
  resolvedShiftRole: z.enum(['reference', 'subpixel_sample', 'unknown']),
});

export const superResolutionSourceValidationResultV1Schema = z
  .object({
    accepted: z.boolean(),
    blockCodes: z.array(superResolutionSourceValidationBlockCodeV1Schema),
    downgradeReasons: z.array(superResolutionSourceValidationDowngradeReasonV1Schema),
    effectiveScale: z.number().min(1).max(4),
    referenceSourceIndex: z.number().int().nonnegative(),
    requestedScale: z.number().min(1).max(4),
    sourceCount: z.number().int().positive(),
    sourceMetadata: z.array(superResolutionSourceValidationMetadataV1Schema).min(1),
    validationConfidence: z.number().min(0).max(1),
    warningCodes: z.array(superResolutionSourceValidationWarningCodeV1Schema),
  })
  .strict();

export type SuperResolutionSourceValidationBlockCodeV1 = z.infer<
  typeof superResolutionSourceValidationBlockCodeV1Schema
>;
export type SuperResolutionSourceValidationDowngradeReasonV1 = z.infer<
  typeof superResolutionSourceValidationDowngradeReasonV1Schema
>;
export type SuperResolutionSourceValidationInputV1 = z.infer<typeof superResolutionSourceValidationInputV1Schema>;
export type SuperResolutionSourceValidationResultV1 = z.infer<typeof superResolutionSourceValidationResultV1Schema>;
export type SuperResolutionSourceValidationWarningCodeV1 = z.infer<
  typeof superResolutionSourceValidationWarningCodeV1Schema
>;

export const validateSuperResolutionSourcesV1 = (requestValue: unknown): SuperResolutionSourceValidationResultV1 => {
  const request = superResolutionSourceValidationRequestV1Schema.parse(requestValue);
  const { requestedScale, sources } = request;
  const blockCodes: SuperResolutionSourceValidationBlockCodeV1[] = [];
  const warningCodes: SuperResolutionSourceValidationWarningCodeV1[] = [];
  const downgradeReasons: SuperResolutionSourceValidationDowngradeReasonV1[] = [];

  if (sources.length < 2) blockCodes.push('source_count_too_low');
  if (new Set(sources.map((source) => source.sourceIndex)).size !== sources.length) {
    blockCodes.push('duplicate_source_indexes');
  }
  if (hasDimensionMismatch(sources)) blockCodes.push('dimension_mismatch');
  if (hasCameraOrLensMismatch(sources)) warningCodes.push('camera_or_lens_mismatch');
  if (hasColorSpaceMismatch(sources)) warningCodes.push('color_space_mismatch');
  if (hasExposureOrIsoMismatch(sources)) {
    warningCodes.push('exposure_or_iso_mismatch');
    downgradeReasons.push('exposure_or_iso_mismatch');
  }
  if (sources.some((source) => source.contentHash === undefined)) warningCodes.push('content_hash_missing');
  if (sources.some((source) => source.graphRevision === undefined)) warningCodes.push('graph_revision_missing');
  if (sources.some((source) => !source.rawDefaultsApplied)) {
    warningCodes.push('raw_defaults_missing');
  }
  if (sources.some((source) => !source.rawBlackLevelKnown || !source.rawWhiteLevelKnown)) {
    warningCodes.push('raw_geometry_unverified');
    downgradeReasons.push('raw_geometry_unverified');
  }
  if (sources.some((source) => source.fixtureStatus === 'public_fixture_metadata_only')) {
    warningCodes.push('public_fixture_metadata_only');
    downgradeReasons.push('public_fixture_metadata_only');
  }

  const shiftMetadataAvailable = hasCompleteSubpixelShiftMetadata(sources);
  if (!shiftMetadataAvailable) {
    warningCodes.push('subpixel_shift_metadata_missing');
    downgradeReasons.push('missing_subpixel_shift_metadata');
  }
  if (!isSourceOrderAscending(sources)) warningCodes.push('source_order_inferred');

  const sourceLimitedScale = getSourceLimitedScale(sources.length);
  if (requestedScale > sourceLimitedScale) {
    downgradeReasons.push('insufficient_source_count_for_requested_scale');
  }

  return superResolutionSourceValidationResultV1Schema.parse({
    accepted: blockCodes.length === 0,
    blockCodes: unique(blockCodes),
    downgradeReasons: unique(downgradeReasons),
    effectiveScale: getEffectiveScale({
      downgradeReasons,
      requestedScale,
      shiftMetadataAvailable,
      sourceLimitedScale,
    }),
    referenceSourceIndex: getReferenceSourceIndex(sources),
    requestedScale,
    sourceCount: sources.length,
    sourceMetadata: sources.map((source) => ({
      ...source,
      resolvedShiftRole: getResolvedShiftRole(source),
    })),
    validationConfidence: getValidationConfidence(warningCodes, blockCodes, downgradeReasons),
    warningCodes: unique(warningCodes),
  });
};

const hasDimensionMismatch = (sources: SuperResolutionSourceValidationInputV1[]): boolean => {
  const [firstSource] = sources;
  if (firstSource === undefined) return false;
  return sources.some((source) => source.width !== firstSource.width || source.height !== firstSource.height);
};

const hasCameraOrLensMismatch = (sources: SuperResolutionSourceValidationInputV1[]): boolean => {
  const [firstSource] = sources;
  if (firstSource === undefined) return false;
  return sources.some(
    (source) =>
      isKnownMismatch(source.cameraMake, firstSource.cameraMake) ||
      isKnownMismatch(source.cameraModel, firstSource.cameraModel) ||
      isKnownMismatch(source.lensModel, firstSource.lensModel),
  );
};

const hasColorSpaceMismatch = (sources: SuperResolutionSourceValidationInputV1[]): boolean => {
  const [firstSource] = sources;
  if (firstSource === undefined) return false;
  return sources.some((source) => isKnownMismatch(source.colorSpaceHint, firstSource.colorSpaceHint));
};

const hasExposureOrIsoMismatch = (sources: SuperResolutionSourceValidationInputV1[]): boolean => {
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

const hasCompleteSubpixelShiftMetadata = (sources: SuperResolutionSourceValidationInputV1[]): boolean => {
  if (!sources.every((source) => source.shiftX !== undefined && source.shiftY !== undefined)) return false;
  const shiftKeys = new Set(
    sources.map((source) => {
      const shiftX = source.shiftX ?? 0;
      const shiftY = source.shiftY ?? 0;
      return `${shiftX}:${shiftY}`;
    }),
  );
  return shiftKeys.size > 1;
};

const isSourceOrderAscending = (sources: SuperResolutionSourceValidationInputV1[]): boolean =>
  sources.every((source, index) => {
    const previousSource = sources[index - 1];
    return previousSource === undefined || source.sourceIndex >= previousSource.sourceIndex;
  });

const getSourceLimitedScale = (sourceCount: number): number => {
  if (sourceCount >= 16) return 4;
  if (sourceCount >= 9) return 3;
  if (sourceCount >= 4) return 2;
  return 1;
};

const getEffectiveScale = ({
  downgradeReasons,
  requestedScale,
  shiftMetadataAvailable,
  sourceLimitedScale,
}: {
  downgradeReasons: SuperResolutionSourceValidationDowngradeReasonV1[];
  requestedScale: number;
  shiftMetadataAvailable: boolean;
  sourceLimitedScale: number;
}): number => {
  const metadataLimitedScale = shiftMetadataAvailable ? requestedScale : 1;
  const qualityLimitedScale =
    downgradeReasons.includes('raw_geometry_unverified') || downgradeReasons.includes('public_fixture_metadata_only')
      ? Math.min(metadataLimitedScale, 2)
      : metadataLimitedScale;
  return Math.max(1, Math.min(requestedScale, sourceLimitedScale, qualityLimitedScale));
};

const getReferenceSourceIndex = (sources: SuperResolutionSourceValidationInputV1[]): number => {
  const reference = sources.find((source) => source.shiftX === 0 && source.shiftY === 0);
  return reference?.sourceIndex ?? sources[0]?.sourceIndex ?? 0;
};

const getResolvedShiftRole = (
  source: SuperResolutionSourceValidationInputV1,
): SuperResolutionSourceValidationResultV1['sourceMetadata'][number]['resolvedShiftRole'] => {
  if (source.shiftX === undefined || source.shiftY === undefined) return 'unknown';
  return source.shiftX === 0 && source.shiftY === 0 ? 'reference' : 'subpixel_sample';
};

const getValidationConfidence = (
  warningCodes: SuperResolutionSourceValidationWarningCodeV1[],
  blockCodes: SuperResolutionSourceValidationBlockCodeV1[],
  downgradeReasons: SuperResolutionSourceValidationDowngradeReasonV1[],
): number => {
  if (blockCodes.length > 0) return 0;
  return Math.max(0.35, 1 - warningCodes.length * 0.06 - downgradeReasons.length * 0.08);
};

const isKnownMismatch = (left: string | undefined, right: string | undefined): boolean =>
  left !== undefined && right !== undefined && left !== right;

const unique = <T>(values: T[]): T[] => [...new Set(values)];
