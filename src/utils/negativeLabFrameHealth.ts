import {
  NEGATIVE_LAB_FRAME_HEALTH_SCHEMA_VERSION,
  parseNegativeLabBatchDryRunSummary,
  parseNegativeLabFrameHealthReport,
  type NegativeLabAcquisitionHealthReport,
  type NegativeLabBatchDryRunSummary,
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

const getNegativeLabWarningSeverity = (
  warningCodes: ReadonlyArray<NegativeLabFrameWarningCode>,
): NegativeLabFrameWarningSeverity => {
  if (warningCodes.includes('excluded_from_batch') || warningCodes.includes('preview_not_ready')) {
    return 'review';
  }

  return warningCodes.length === 0 ? 'ok' : 'info';
};

export const buildNegativeLabAcquisitionHealthReport = (
  targetPaths: readonly string[],
): NegativeLabAcquisitionHealthReport => {
  const sourceFamilies = targetPaths.map(classifyAcquisitionSourceFamily);
  const uniqueSourceFamilies = [...new Set(sourceFamilies)].toSorted();
  const lossyCount = sourceFamilies.filter((family) => family === 'jpeg_lossy').length;
  const rawLikeCount = sourceFamilies.filter((family) => family === 'raw_like').length;
  const tiffScanCount = sourceFamilies.filter((family) => family === 'tiff_scan').length;
  const unknownCount = sourceFamilies.filter((family) => family === 'unknown').length;
  const warningCodes: NegativeLabAcquisitionHealthReport['warningCodes'] = [];

  if (lossyCount > 0) warningCodes.push('lossy_source_for_negative_lab');
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
  includedPathSet: ReadonlySet<string>;
  previewReady: boolean;
  targetPaths: string[];
}

export const buildNegativeLabFrameHealthReport = ({
  activePathIndex,
  baseFogConfidence,
  includedPathSet,
  previewReady,
  targetPaths,
}: BuildNegativeLabFrameHealthReportParams): NegativeLabFrameHealthReport => {
  const effectiveActivePathIndex = targetPaths[activePathIndex] === undefined ? 0 : activePathIndex;
  const frames = targetPaths.map((sourcePath, pathIndex) => {
    const active = pathIndex === effectiveActivePathIndex;
    const included = includedPathSet.has(sourcePath);
    const warningCodes: NegativeLabFrameWarningCode[] = [];

    if (!included) warningCodes.push('excluded_from_batch');
    if (!previewReady && active) warningCodes.push('preview_not_ready');
    if (baseFogConfidence !== null && !active) warningCodes.push('base_estimate_active_frame_only');
    const warningSeverity = getNegativeLabWarningSeverity(warningCodes);

    return {
      active,
      baseConfidence: active ? baseFogConfidence : null,
      baseStatus: active && baseFogConfidence !== null ? 'estimated' : 'pending',
      conversionStatus: !included
        ? 'skipped'
        : active
          ? previewReady
            ? 'preview_ready'
            : 'preview_pending'
          : 'queued',
      cropStatus: !included ? 'skipped' : active ? 'active_frame_editable' : 'roll_default',
      frameId: `negative-lab-frame-${pathIndex + 1}`,
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

  return parseNegativeLabBatchDryRunSummary({
    affectedFrameIds,
    blocked: affectedFrameIds.length === 0,
    frameHealthReport,
    plannedApplyCount: affectedFrameIds.length,
    rollWarningCodes: frameHealthReport.warningCodes,
    schemaVersion: NEGATIVE_LAB_FRAME_HEALTH_SCHEMA_VERSION,
    skippedFrameIds,
  });
};
