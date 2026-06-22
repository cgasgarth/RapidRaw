import { z } from 'zod';

import {
  hdrBracketDetectionResultV1Schema,
  type HdrBracketDetectionMethodV1,
  type HdrBracketDetectionResultV1,
  type HdrBracketSourceMetadataV1,
  type HdrMergeBlockCodeV1,
  type HdrMergeWarningCodeV1,
} from './rawEngineSchemas.js';

export const hdrBracketDetectionSourceInputV1Schema = z
  .object({
    aperture: z.number().positive().optional(),
    bitDepth: z.number().int().positive().optional(),
    cameraMake: z.string().trim().min(1).optional(),
    cameraModel: z.string().trim().min(1).optional(),
    captureTimestamp: z.iso.datetime({ offset: true }).optional(),
    cfaPattern: z.string().trim().min(1).optional(),
    contentHash: z.string().trim().min(1).optional(),
    cropFactor: z.number().positive().optional(),
    declaredExposureEv: z.number().optional(),
    exposureCompensationEv: z.number().optional(),
    exposureTimeSeconds: z.number().positive().optional(),
    focalLengthMm: z.number().positive().optional(),
    graphRevision: z.string().trim().min(1).optional(),
    height: z.number().int().positive(),
    imageId: z.string().trim().min(1).optional(),
    imagePath: z.string().trim().min(1),
    iso: z.number().positive().optional(),
    lensModel: z.string().trim().min(1).optional(),
    lensProfileId: z.string().trim().min(1).optional(),
    rawActiveArea: z
      .object({
        height: z.number().int().positive(),
        width: z.number().int().positive(),
        x: z.number().int().nonnegative(),
        y: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
    rawBlackLevelKnown: z.boolean(),
    rawOrientation: z.enum(['normal', 'rotated_90', 'rotated_180', 'rotated_270']).optional(),
    rawWhiteLevelKnown: z.boolean(),
    resolvedBracketRole: z.enum(['over_exposed', 'reference', 'under_exposed', 'unknown']).optional(),
    resolvedExposureEv: z.number().optional(),
    sourceIndex: z.number().int().nonnegative(),
    virtualCopyId: z.string().trim().min(1).nullable().optional(),
    whiteBalanceComparable: z.boolean(),
    width: z.number().int().positive(),
  })
  .strict();

export const hdrBracketDetectionOptionsV1Schema = z
  .object({
    captureTimeGapWarnSeconds: z.number().positive().default(8),
    duplicateExposureToleranceEv: z.number().nonnegative().default(0.05),
    irregularSpacingToleranceEv: z.number().nonnegative().default(0.5),
    minimumBracketSpanEv: z.number().positive().default(1),
  })
  .strict();

export const hdrBracketDetectionRequestV1Schema = z
  .object({
    options: hdrBracketDetectionOptionsV1Schema.optional(),
    sources: z.array(hdrBracketDetectionSourceInputV1Schema).min(2),
  })
  .strict()
  .superRefine((request, context) => {
    const sourceIndexes = new Set(request.sources.map((source) => source.sourceIndex));
    if (sourceIndexes.size !== request.sources.length) {
      context.addIssue({
        code: 'custom',
        message: 'HDR bracket detection sources require unique source indexes.',
        path: ['sources'],
      });
    }
  });

export type HdrBracketDetectionSourceInputV1 = z.infer<typeof hdrBracketDetectionSourceInputV1Schema>;
export type HdrBracketDetectionOptionsV1 = z.infer<typeof hdrBracketDetectionOptionsV1Schema>;
export type HdrBracketDetectionRequestV1 = z.infer<typeof hdrBracketDetectionRequestV1Schema>;

type SourceExposure = {
  method: HdrBracketDetectionMethodV1;
  source: HdrBracketDetectionSourceInputV1;
  value: number;
};

export const detectHdrBracketV1 = (requestValue: unknown): HdrBracketDetectionResultV1 => {
  const request = hdrBracketDetectionRequestV1Schema.parse(requestValue);
  const options = hdrBracketDetectionOptionsV1Schema.parse(request.options ?? {});
  const exposures = request.sources.map(resolveSourceExposure);
  const warnings: HdrMergeWarningCodeV1[] = [];
  const blocks: HdrMergeBlockCodeV1[] = [];
  const exposureResolutionResolved = hasCommonExposureResolutionStrategy(exposures);

  if (!exposureResolutionResolved) {
    blocks.push('missing_required_exposure_metadata');
    warnings.push('exposure_metadata_missing');
  }

  const resolvedExposures = normalizeExposureValues(exposures, request.sources);
  const uniqueExposureValues = distinctExposureValues(resolvedExposures, options.duplicateExposureToleranceEv);
  const bracketSpanEv = getExposureSpan(resolvedExposures);

  if (
    exposureResolutionResolved &&
    (uniqueExposureValues.length < 2 ||
      hasDuplicateExposurePair(resolvedExposures, options.duplicateExposureToleranceEv))
  ) {
    blocks.push('duplicate_exposure_values');
  }

  if (exposureResolutionResolved && bracketSpanEv < options.minimumBracketSpanEv) {
    blocks.push('not_a_bracket');
  }

  if (hasDimensionMismatch(request.sources)) {
    blocks.push('dimension_mismatch');
  }

  if (hasRawGeometryMismatch(request.sources)) {
    blocks.push('raw_geometry_mismatch');
  }

  if (hasCameraOrLensMismatch(request.sources)) {
    warnings.push('camera_or_lens_mismatch');
  }

  if (hasCaptureTimeGap(request.sources, options.captureTimeGapWarnSeconds)) {
    warnings.push('capture_time_gap_large');
  }

  if (request.sources.some((source) => !source.whiteBalanceComparable)) {
    warnings.push('white_balance_mismatch');
  }

  if (
    request.sources.some((source) => !source.rawBlackLevelKnown || !source.rawWhiteLevelKnown) ||
    hasUnverifiedRawGeometry(request.sources)
  ) {
    warnings.push('dimensions_match_but_raw_geometry_unverified');
  }

  if (exposureResolutionResolved && !isExposureOrderAscending(resolvedExposures)) {
    warnings.push('bracket_order_inferred');
  }

  if (exposureResolutionResolved && hasIrregularSpacing(resolvedExposures, options.irregularSpacingToleranceEv)) {
    warnings.push('bracket_spacing_irregular');
  }

  const referenceSourceIndex = getReferenceSourceIndex(resolvedExposures);
  const accepted = blocks.length === 0;

  return hdrBracketDetectionResultV1Schema.parse({
    accepted,
    blockCodes: uniqueBlocks(blocks),
    bracketSpanEv,
    detectionConfidence: getDetectionConfidence(warnings, blocks),
    detectionMethod: getDetectionMethod(exposures),
    referenceSourceIndex,
    sourceMetadata: resolvedExposures.map(({ source, value }) => ({
      aperture: source.aperture,
      bitDepth: source.bitDepth,
      cameraMake: source.cameraMake,
      cameraModel: source.cameraModel,
      captureTimestamp: source.captureTimestamp,
      cfaPattern: source.cfaPattern,
      contentHash: source.contentHash,
      cropFactor: source.cropFactor,
      declaredExposureEv: source.declaredExposureEv,
      exposureCompensationEv: source.exposureCompensationEv,
      exposureTimeSeconds: source.exposureTimeSeconds,
      focalLengthMm: source.focalLengthMm,
      graphRevision: source.graphRevision,
      height: source.height,
      imageId: source.imageId,
      imagePath: source.imagePath,
      iso: source.iso,
      lensModel: source.lensModel,
      lensProfileId: source.lensProfileId,
      rawActiveArea: source.rawActiveArea,
      rawBlackLevelKnown: source.rawBlackLevelKnown,
      rawOrientation: source.rawOrientation,
      rawWhiteLevelKnown: source.rawWhiteLevelKnown,
      resolvedBracketRole: exposureResolutionResolved ? getBracketRole(value) : 'unknown',
      resolvedExposureEv: value,
      sourceIndex: source.sourceIndex,
      virtualCopyId: source.virtualCopyId,
      whiteBalanceComparable: source.whiteBalanceComparable,
      width: source.width,
    })),
    warningCodes: uniqueWarnings(warnings),
  });
};

const resolveSourceExposure = (source: HdrBracketDetectionSourceInputV1): SourceExposure | undefined => {
  if (source.declaredExposureEv !== undefined) {
    return {
      method: 'caller_declared_ev',
      source,
      value: source.declaredExposureEv,
    };
  }

  if (source.resolvedExposureEv !== undefined) {
    return {
      method: 'caller_declared_ev',
      source,
      value: source.resolvedExposureEv,
    };
  }

  if (source.exposureCompensationEv !== undefined) {
    return {
      method: 'metadata_exposure_compensation',
      source,
      value: source.exposureCompensationEv,
    };
  }

  if (source.exposureTimeSeconds !== undefined && source.aperture !== undefined && source.iso !== undefined) {
    return {
      method: 'metadata_exposure_time_iso_aperture',
      source,
      value: Math.log2((source.exposureTimeSeconds * source.iso) / (source.aperture * source.aperture)),
    };
  }

  return undefined;
};

const hasCommonExposureResolutionStrategy = (exposures: Array<SourceExposure | undefined>): boolean => {
  const methods = exposures.map((exposure) => exposure?.method);
  const [firstMethod] = methods;
  if (firstMethod === undefined) return false;
  return methods.every((method) => method === firstMethod);
};

const normalizeExposureValues = (
  exposures: Array<SourceExposure | undefined>,
  sources: HdrBracketDetectionSourceInputV1[],
): SourceExposure[] => {
  const resolved = exposures.map((exposure, index) => {
    if (exposure !== undefined) return exposure;

    const source = sources[index];
    if (source === undefined) {
      throw new Error('HDR bracket source lookup failed during exposure normalization.');
    }

    return {
      method: 'manual_order' as const,
      source,
      value: 0,
    };
  });

  const metadataExposures = resolved.filter((exposure) => exposure.method === 'metadata_exposure_time_iso_aperture');
  if (metadataExposures.length !== resolved.length) return resolved;

  const middleExposure = [...metadataExposures].sort((left, right) => left.value - right.value)[
    Math.floor(metadataExposures.length / 2)
  ];
  const referenceValue = middleExposure?.value ?? 0;

  return resolved.map((exposure) => ({
    ...exposure,
    value: roundEv(exposure.value - referenceValue),
  }));
};

const distinctExposureValues = (exposures: SourceExposure[], toleranceEv: number): number[] => {
  const sortedValues = exposures.map((exposure) => exposure.value).sort((left, right) => left - right);
  const distinctValues: number[] = [];

  for (const value of sortedValues) {
    const previousValue = distinctValues.at(-1);
    if (previousValue === undefined || Math.abs(value - previousValue) > toleranceEv) {
      distinctValues.push(value);
    }
  }

  return distinctValues;
};

const hasDuplicateExposurePair = (exposures: SourceExposure[], toleranceEv: number): boolean => {
  const sortedValues = exposures.map((exposure) => exposure.value).sort((left, right) => left - right);
  return sortedValues.some((value, index) => {
    const previousValue = sortedValues[index - 1];
    return previousValue !== undefined && value - previousValue <= toleranceEv;
  });
};

const getExposureSpan = (exposures: SourceExposure[]): number => {
  const values = exposures.map((exposure) => exposure.value);
  return roundEv(Math.max(...values) - Math.min(...values));
};

const hasDimensionMismatch = (sources: HdrBracketDetectionSourceInputV1[]): boolean => {
  const [firstSource] = sources;
  if (firstSource === undefined) return false;

  return sources.some((source) => source.width !== firstSource.width || source.height !== firstSource.height);
};

const hasCameraOrLensMismatch = (sources: HdrBracketDetectionSourceInputV1[]): boolean => {
  const [firstSource] = sources;
  if (firstSource === undefined) return false;

  return sources.some(
    (source) =>
      isKnownMismatch(source.cameraMake, firstSource.cameraMake) ||
      isKnownMismatch(source.cameraModel, firstSource.cameraModel) ||
      isKnownMismatch(source.lensModel, firstSource.lensModel) ||
      isKnownMismatch(source.lensProfileId, firstSource.lensProfileId) ||
      isKnownNumberMismatch(source.focalLengthMm, firstSource.focalLengthMm) ||
      isKnownNumberMismatch(source.cropFactor, firstSource.cropFactor),
  );
};

const hasRawGeometryMismatch = (sources: HdrBracketDetectionSourceInputV1[]): boolean => {
  const [firstSource] = sources;
  if (firstSource === undefined) return false;

  return sources.some(
    (source) =>
      isKnownMismatch(source.rawOrientation, firstSource.rawOrientation) ||
      isKnownMismatch(source.cfaPattern, firstSource.cfaPattern) ||
      isKnownNumberMismatch(source.bitDepth, firstSource.bitDepth) ||
      isKnownActiveAreaMismatch(source.rawActiveArea, firstSource.rawActiveArea),
  );
};

const hasUnverifiedRawGeometry = (sources: HdrBracketDetectionSourceInputV1[]): boolean =>
  sources.some(
    (source) =>
      source.rawOrientation === undefined ||
      source.rawActiveArea === undefined ||
      source.cfaPattern === undefined ||
      source.bitDepth === undefined,
  );

const hasCaptureTimeGap = (sources: HdrBracketDetectionSourceInputV1[], gapWarnSeconds: number): boolean => {
  const timestamps = sources
    .map((source) =>
      source.captureTimestamp === undefined ? undefined : Date.parse(source.captureTimestamp) / MILLISECONDS_PER_SECOND,
    )
    .filter((timestamp) => timestamp !== undefined);

  if (timestamps.length < 2) return false;

  return Math.max(...timestamps) - Math.min(...timestamps) > gapWarnSeconds;
};

const isExposureOrderAscending = (exposures: SourceExposure[]): boolean =>
  exposures.every((exposure, index) => {
    const previousExposure = exposures[index - 1];
    return previousExposure === undefined || exposure.value >= previousExposure.value;
  });

const hasIrregularSpacing = (exposures: SourceExposure[], toleranceEv: number): boolean => {
  const sortedValues = exposures.map((exposure) => exposure.value).sort((left, right) => left - right);
  const spacings = sortedValues.slice(1).map((value, index) => value - (sortedValues[index] ?? value));
  const positiveSpacings = spacings.filter((spacing) => spacing > 0);
  if (positiveSpacings.length < 2) return false;

  return Math.max(...positiveSpacings) - Math.min(...positiveSpacings) > toleranceEv;
};

const getReferenceSourceIndex = (exposures: SourceExposure[]): number => {
  const referenceExposure = [...exposures].sort(
    (left, right) =>
      Math.abs(left.value) - Math.abs(right.value) ||
      Math.abs(left.source.sourceIndex - getMiddleSourceIndex(exposures)) -
        Math.abs(right.source.sourceIndex - getMiddleSourceIndex(exposures)),
  )[0];

  if (referenceExposure === undefined) {
    throw new Error('HDR bracket detection requires at least one source.');
  }

  return referenceExposure.source.sourceIndex;
};

const getMiddleSourceIndex = (exposures: SourceExposure[]): number =>
  exposures.reduce((total, exposure) => total + exposure.source.sourceIndex, 0) / exposures.length;

const getDetectionMethod = (exposures: Array<SourceExposure | undefined>): HdrBracketDetectionMethodV1 => {
  const methods = exposures.map((exposure) => exposure?.method).filter((method) => method !== undefined);
  if (methods.length === 0) return 'manual_order';

  const [firstMethod] = methods;
  if (firstMethod !== undefined && methods.every((method) => method === firstMethod)) {
    return firstMethod;
  }

  return 'manual_order';
};

const getBracketRole = (exposureEv: number): HdrBracketSourceMetadataV1['resolvedBracketRole'] => {
  if (exposureEv < -0.25) return 'under_exposed';
  if (exposureEv > 0.25) return 'over_exposed';
  return 'reference';
};

const getDetectionConfidence = (warnings: HdrMergeWarningCodeV1[], blocks: HdrMergeBlockCodeV1[]): number =>
  Math.max(0.05, roundConfidence(0.99 - uniqueWarnings(warnings).length * 0.07 - uniqueBlocks(blocks).length * 0.22));

const isKnownMismatch = (left: string | undefined, right: string | undefined): boolean =>
  left !== undefined && right !== undefined && left !== right;

const isKnownNumberMismatch = (left: number | undefined, right: number | undefined): boolean =>
  left !== undefined && right !== undefined && left !== right;

const isKnownActiveAreaMismatch = (
  left: HdrBracketDetectionSourceInputV1['rawActiveArea'],
  right: HdrBracketDetectionSourceInputV1['rawActiveArea'],
): boolean =>
  left !== undefined &&
  right !== undefined &&
  (left.x !== right.x || left.y !== right.y || left.width !== right.width || left.height !== right.height);

const roundEv = (value: number): number => Math.round(value * 1000) / 1000;

const roundConfidence = (value: number): number => Math.round(value * 1000) / 1000;

const uniqueWarnings = (warnings: HdrMergeWarningCodeV1[]): HdrMergeWarningCodeV1[] => Array.from(new Set(warnings));

const uniqueBlocks = (blocks: HdrMergeBlockCodeV1[]): HdrMergeBlockCodeV1[] => Array.from(new Set(blocks));

const MILLISECONDS_PER_SECOND = 1000;
