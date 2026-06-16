import {
  NEGATIVE_LAB_FRAME_HEALTH_SCHEMA_VERSION,
  parseNegativeLabFrameHealthReport,
  type NegativeLabFrameHealthReport,
  type NegativeLabFrameWarningCode,
} from '../schemas/negativeLabFrameHealthSchemas';

export const getNegativeLabScanLabel = (path: string, index: number) => {
  const pathParts = path.split(/[\\/]/u).filter(Boolean);
  return pathParts.at(-1) ?? String(index + 1);
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

    return {
      active,
      baseConfidence: active ? baseFogConfidence : null,
      baseStatus: active && baseFogConfidence !== null ? 'estimated' : 'pending',
      frameId: `negative-lab-frame-${pathIndex + 1}`,
      healthStatus: !included ? 'skipped' : active ? 'active' : 'queued',
      included,
      pathIndex,
      scanLabel: getNegativeLabScanLabel(sourcePath, pathIndex),
      sourcePath,
      warningCodes,
    };
  });

  return parseNegativeLabFrameHealthReport({
    activeFrameId: frames.find((frame) => frame.active)?.frameId ?? null,
    frames,
    includedCount: frames.filter((frame) => frame.included).length,
    queuedCount: frames.filter((frame) => frame.healthStatus !== 'skipped').length,
    schemaVersion: NEGATIVE_LAB_FRAME_HEALTH_SCHEMA_VERSION,
    warningCodes: [...new Set(frames.flatMap((frame) => frame.warningCodes))],
  });
};
