import {
  rawCameraProfileProvenanceReceiptSchema,
  type RawCameraProfileProvenanceReceipt,
  type RawDevelopmentReport,
} from '../schemas/imageLoaderSchemas';

export function buildCameraProfileProvenanceReceipt(report: RawDevelopmentReport): RawCameraProfileProvenanceReceipt {
  const colorCheckerGate = report.cameraProfile.colorCheckerGate ?? null;
  const colorCheckerGateStatus = colorCheckerGate?.status ?? 'runtime_smoke_only';
  return rawCameraProfileProvenanceReceiptSchema.parse({
    algorithmId: report.cameraProfile.algorithmId,
    candidateCount: report.cameraProfile.candidateCount,
    cctClamped: report.cameraProfile.cctClamped ?? null,
    colorCheckerFallbackReason: colorCheckerGate?.fallbackReason ?? null,
    colorCheckerGateStatus,
    colorCheckerMaxDeltaE00: colorCheckerGate?.maxDeltaE00 ?? null,
    colorCheckerMeanDeltaE00: colorCheckerGate?.meanDeltaE00 ?? null,
    colorCheckerMedianDeltaE00: colorCheckerGate?.medianDeltaE00 ?? null,
    colorCheckerPatchCount: colorCheckerGate?.patchCount ?? null,
    colorCheckerP95DeltaE00: colorCheckerGate?.p95DeltaE00 ?? null,
    colorCheckerThresholdMeanDeltaE00: colorCheckerGate?.thresholdMeanDeltaE00 ?? null,
    colorCheckerThresholdP95DeltaE00: colorCheckerGate?.thresholdP95DeltaE00 ?? null,
    cacheHit: report.runtime?.cacheHit ?? null,
    coolIlluminant: report.cameraProfile.coolIlluminant ?? null,
    coolWeight: report.cameraProfile.coolWeight ?? null,
    decodeElapsedMs: report.runtime?.decodeElapsedMs ?? null,
    demosaicAlgorithmId: report.demosaicAlgorithmId ?? null,
    demosaicPath: report.demosaicPath,
    estimatedCctKelvin: report.cameraProfile.estimatedCctKelvin ?? null,
    exportElapsedMs: report.runtime?.exportElapsedMs ?? null,
    fallbackReason: report.cameraProfile.fallbackReason ?? null,
    illuminantEstimateConfidence: report.cameraProfile.illuminantEstimateConfidence,
    illuminantEstimateMethod: report.cameraProfile.illuminantEstimateMethod,
    matrixHash: report.cameraProfile.matrixHash ?? null,
    outputDimensions: report.runtime?.outputDimensions ?? null,
    previewElapsedMs: report.runtime?.previewElapsedMs ?? null,
    processingProfile: report.processingProfile,
    profileConfidenceBasis: profileConfidenceBasisFor(colorCheckerGateStatus, report.cameraProfile.status),
    receiptVersion: 1,
    scratchMemoryBytes: report.xtransHq?.reconstruction.scratchMemory.totalEstimatedPeakBytes ?? null,
    status: report.cameraProfile.status,
    warmIlluminant: report.cameraProfile.warmIlluminant ?? null,
    warningCount: report.cameraProfile.warningCodes.length,
  });
}

const profileConfidenceBasisFor = (
  colorCheckerGateStatus: RawCameraProfileProvenanceReceipt['colorCheckerGateStatus'],
  profileStatus: RawDevelopmentReport['cameraProfile']['status'],
): RawCameraProfileProvenanceReceipt['profileConfidenceBasis'] => {
  if (
    colorCheckerGateStatus === 'gated_pass' ||
    colorCheckerGateStatus === 'gated_warn' ||
    colorCheckerGateStatus === 'gated_fail'
  ) {
    return 'colorchecker_gated';
  }
  if (profileStatus === 'fallback' || profileStatus === 'unavailable' || colorCheckerGateStatus === 'not_available') {
    return 'metadata_only_fallback';
  }
  return 'runtime_smoke_only';
};
