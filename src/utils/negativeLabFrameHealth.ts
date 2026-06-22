import {
  NEGATIVE_LAB_FRAME_HEALTH_SCHEMA_VERSION,
  parseNegativeLabBatchDryRunSummary,
  parseNegativeLabFrameHealthReport,
  negativeLabFrameAcquisitionHealthSchema,
  type NegativeLabAcquisitionHealthReport,
  type NegativeLabBatchDryRunSummary,
  type NegativeLabFrameBatchDisposition,
  type NegativeLabFrameBatchDispositionReason,
  type NegativeLabFrameAcquisitionHealth,
  type NegativeLabFrameBaseScope,
  type NegativeLabFrameCropStatus,
  type NegativeLabFrameHealthReport,
  type NegativeLabFrameWarningCode,
  type NegativeLabFrameWarningSeverity,
} from '../schemas/negativeLabFrameHealthSchemas';

export const getNegativeLabScanLabel = (path: string, index: number) => {
  const pathParts = path.split(/[\\/]/u).filter(Boolean);
  return pathParts.at(-1) ?? String(index + 1);
};

const RAW_LIKE_EXTENSIONS = new Set(['.arw', '.cr2', '.cr3', '.dng', '.nef', '.orf', '.raf', '.raw', '.rw2']);
const TIFF_SCAN_EXTENSIONS = new Set(['.tif', '.tiff']);
const JPEG_LOSSY_EXTENSIONS = new Set(['.jpg', '.jpeg']);
const LAB_PROCESSED_PATH_TOKEN_PATTERN =
  /(?:^|[._\-/\\\s])(?:auto[-_\s]?corrected|lab[-_\s]?processed|positive|proof)(?:$|[._\-/\\\s])/iu;

const getPathExtension = (path: string) => {
  const name = getNegativeLabScanLabel(path, 0);
  const dotIndex = name.lastIndexOf('.');
  return dotIndex === -1 ? '' : name.slice(dotIndex).toLocaleLowerCase('en-US');
};

const classifyAcquisitionSourceFamily = (path: string) => {
  const extension = getPathExtension(path);
  if (RAW_LIKE_EXTENSIONS.has(extension)) return 'raw_like';
  if (TIFF_SCAN_EXTENSIONS.has(extension)) return 'tiff_scan';
  if (JPEG_LOSSY_EXTENSIONS.has(extension)) return 'jpeg_lossy';
  return 'unknown';
};

export const buildNegativeLabFrameAcquisitionHealth = (path: string): NegativeLabFrameAcquisitionHealth => {
  const sourceFamily = classifyAcquisitionSourceFamily(path);
  const warningCodes: NegativeLabFrameAcquisitionHealth['warningCodes'] = [];

  if (LAB_PROCESSED_PATH_TOKEN_PATTERN.test(path)) warningCodes.push('lab_processed_input_for_negative_lab');
  if (sourceFamily === 'jpeg_lossy') warningCodes.push('lossy_source_for_negative_lab');
  if (sourceFamily === 'unknown') warningCodes.push('unknown_acquisition_state');

  return negativeLabFrameAcquisitionHealthSchema.parse({
    severity: warningCodes.length === 0 ? 'ok' : 'review',
    sourceFamily,
    warningCodes,
  });
};

const getNegativeLabWarningSeverity = (
  warningCodes: ReadonlyArray<NegativeLabFrameWarningCode>,
): NegativeLabFrameWarningSeverity => {
  if (warningCodes.includes('excluded_from_batch') || warningCodes.includes('preview_not_ready')) {
    return 'review';
  }

  return warningCodes.length === 0 ? 'ok' : 'info';
};

const buildNegativeLabFrameBatchDisposition = ({
  acquisitionHealth,
  hasBaseEstimate,
  included,
  previewReady,
}: {
  acquisitionHealth: NegativeLabFrameAcquisitionHealth;
  hasBaseEstimate: boolean;
  included: boolean;
  previewReady: boolean;
}): {
  batchDisposition: NegativeLabFrameBatchDisposition;
  batchDispositionReason: NegativeLabFrameBatchDispositionReason;
} => {
  if (!included) {
    return { batchDisposition: 'skip', batchDispositionReason: 'excluded_from_batch' };
  }

  if (!previewReady) {
    return { batchDisposition: 'review', batchDispositionReason: 'preview_required' };
  }

  if (!hasBaseEstimate) {
    return { batchDisposition: 'review', batchDispositionReason: 'base_not_estimated' };
  }

  if (acquisitionHealth.severity === 'review') {
    return { batchDisposition: 'review', batchDispositionReason: 'acquisition_review_required' };
  }

  return { batchDisposition: 'apply', batchDispositionReason: 'ready_to_apply' };
};

export const buildNegativeLabAcquisitionHealthReport = (
  targetPaths: readonly string[],
): NegativeLabAcquisitionHealthReport => {
  const sourceFamilies = targetPaths.map((path) => buildNegativeLabFrameAcquisitionHealth(path).sourceFamily);
  const uniqueSourceFamilies = [...new Set(sourceFamilies)].toSorted();
  const lossyCount = sourceFamilies.filter((family) => family === 'jpeg_lossy').length;
  const rawLikeCount = sourceFamilies.filter((family) => family === 'raw_like').length;
  const tiffScanCount = sourceFamilies.filter((family) => family === 'tiff_scan').length;
  const unknownCount = sourceFamilies.filter((family) => family === 'unknown').length;
  const warningCodes: NegativeLabAcquisitionHealthReport['warningCodes'] = [];

  if (lossyCount > 0) warningCodes.push('lossy_source_for_negative_lab');
  if (
    targetPaths.some((path) =>
      buildNegativeLabFrameAcquisitionHealth(path).warningCodes.includes('lab_processed_input_for_negative_lab'),
    )
  ) {
    warningCodes.push('lab_processed_input_for_negative_lab');
  }
  if (unknownCount > 0) warningCodes.push('unknown_acquisition_state');
  if (uniqueSourceFamilies.length > 1) warningCodes.push('mixed_source_families');

  return {
    lossyCount,
    rawLikeCount,
    schemaVersion: NEGATIVE_LAB_FRAME_HEALTH_SCHEMA_VERSION,
    severity: warningCodes.length === 0 ? 'ok' : 'review',
    sourceFamilies: uniqueSourceFamilies.length === 0 ? ['unknown'] : uniqueSourceFamilies,
    tiffScanCount,
    totalCount: targetPaths.length,
    unknownCount,
    warningCodes,
  };
};

interface BuildNegativeLabFrameHealthReportParams {
  activePathIndex: number;
  baseFogConfidence: number | null;
  baseScope?: NegativeLabFrameBaseScope;
  cropStatusByFrameId?: Readonly<Record<string, NegativeLabFrameCropStatus>>;
  includedPathSet: ReadonlySet<string>;
  previewReady: boolean;
  targetPaths: string[];
}

export const buildNegativeLabFrameHealthReport = ({
  activePathIndex,
  baseFogConfidence,
  baseScope = 'frame',
  cropStatusByFrameId = {},
  includedPathSet,
  previewReady,
  targetPaths,
}: BuildNegativeLabFrameHealthReportParams): NegativeLabFrameHealthReport => {
  const effectiveActivePathIndex = targetPaths[activePathIndex] === undefined ? 0 : activePathIndex;
  const frames = targetPaths.map((sourcePath, pathIndex) => {
    const active = pathIndex === effectiveActivePathIndex;
    const included = includedPathSet.has(sourcePath);
    const acquisitionHealth = buildNegativeLabFrameAcquisitionHealth(sourcePath);
    const frameId = `negative-lab-frame-${pathIndex + 1}`;
    const hasRollBaseEstimate = baseScope === 'roll' && included && baseFogConfidence !== null;
    const hasFrameBaseEstimate = active && baseFogConfidence !== null;
    const hasBaseEstimate = hasRollBaseEstimate || hasFrameBaseEstimate;
    const warningCodes: NegativeLabFrameWarningCode[] = [];
    const batchDisposition = buildNegativeLabFrameBatchDisposition({
      acquisitionHealth,
      hasBaseEstimate,
      included,
      previewReady,
    });

    if (!included) warningCodes.push('excluded_from_batch');
    if (!previewReady && active) warningCodes.push('preview_not_ready');
    if (baseScope === 'frame' && baseFogConfidence !== null && !active) {
      warningCodes.push('base_estimate_active_frame_only');
    }
    const warningSeverity =
      acquisitionHealth.severity === 'review' ? 'review' : getNegativeLabWarningSeverity(warningCodes);

    return {
      active,
      acquisitionSourceFamily: acquisitionHealth.sourceFamily,
      acquisitionWarningCodes: acquisitionHealth.warningCodes,
      baseConfidence: hasBaseEstimate ? baseFogConfidence : null,
      baseScope: hasRollBaseEstimate ? 'roll' : 'frame',
      baseStatus: hasBaseEstimate ? 'estimated' : 'pending',
      ...batchDisposition,
      conversionStatus: !included
        ? 'skipped'
        : active
          ? previewReady
            ? 'preview_ready'
            : 'preview_pending'
          : 'queued',
      cropStatus: !included
        ? 'skipped'
        : (cropStatusByFrameId[frameId] ?? (active ? 'active_frame_editable' : 'roll_default')),
      frameId,
      healthStatus: !included ? 'skipped' : active ? 'active' : 'queued',
      included,
      pathIndex,
      qcStatus: !included ? 'skipped' : warningSeverity === 'review' ? 'review' : 'ready',
      scanLabel: getNegativeLabScanLabel(sourcePath, pathIndex),
      sourcePath,
      warningCodes,
      warningSeverity,
    };
  });

  return parseNegativeLabFrameHealthReport({
    activeFrameId: frames.find((frame) => frame.active)?.frameId ?? null,
    acquisitionHealth: buildNegativeLabAcquisitionHealthReport(targetPaths),
    frames,
    includedCount: frames.filter((frame) => frame.included).length,
    queuedCount: frames.filter((frame) => frame.healthStatus !== 'skipped').length,
    schemaVersion: NEGATIVE_LAB_FRAME_HEALTH_SCHEMA_VERSION,
    warningCodes: [...new Set(frames.flatMap((frame) => frame.warningCodes))],
  });
};

export const buildNegativeLabBatchDryRunSummary = (
  frameHealthReport: NegativeLabFrameHealthReport,
): NegativeLabBatchDryRunSummary => {
  const affectedFrameIds = frameHealthReport.frames
    .filter((frame) => frame.healthStatus !== 'skipped')
    .map((frame) => frame.frameId);
  const skippedFrameIds = frameHealthReport.frames
    .filter((frame) => frame.healthStatus === 'skipped')
    .map((frame) => frame.frameId);
  const reviewFrameIds = frameHealthReport.frames
    .filter((frame) => frame.batchDisposition === 'review')
    .map((frame) => frame.frameId);
  const dispositionCounts = frameHealthReport.frames.reduce(
    (counts, frame) => ({
      ...counts,
      [frame.batchDisposition]: counts[frame.batchDisposition] + 1,
    }),
    { apply: 0, review: 0, skip: 0 },
  );

  return parseNegativeLabBatchDryRunSummary({
    affectedFrameIds,
    acquisitionReviewFrameIds: frameHealthReport.frames
      .filter((frame) => frame.acquisitionWarningCodes.length > 0)
      .map((frame) => frame.frameId),
    blocked: affectedFrameIds.length === 0,
    dispositionCounts,
    frameHealthReport,
    plannedApplyCount: affectedFrameIds.length,
    reviewFrameIds,
    rollWarningCodes: frameHealthReport.warningCodes,
    schemaVersion: NEGATIVE_LAB_FRAME_HEALTH_SCHEMA_VERSION,
    skippedFrameIds,
  });
};
