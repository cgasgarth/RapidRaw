import {
  rawCameraProfileProvenanceReceiptSchema,
  type RawCameraProfileProvenanceReceipt,
  type RawDevelopmentReport,
} from '../schemas/imageLoaderSchemas';

export function buildCameraProfileProvenanceReceipt(report: RawDevelopmentReport): RawCameraProfileProvenanceReceipt {
  return rawCameraProfileProvenanceReceiptSchema.parse({
    algorithmId: report.cameraProfile.algorithmId,
    candidateCount: report.cameraProfile.candidateCount,
    cctClamped: report.cameraProfile.cctClamped ?? null,
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
    receiptVersion: 1,
    scratchMemoryBytes: report.xtransHq?.reconstruction.scratchMemory.totalEstimatedPeakBytes ?? null,
    status: report.cameraProfile.status,
    warmIlluminant: report.cameraProfile.warmIlluminant ?? null,
    warningCount: report.cameraProfile.warningCodes.length,
  });
}
