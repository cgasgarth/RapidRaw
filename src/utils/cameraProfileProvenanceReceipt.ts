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
    coolIlluminant: report.cameraProfile.coolIlluminant ?? null,
    coolWeight: report.cameraProfile.coolWeight ?? null,
    demosaicPath: report.demosaicPath,
    estimatedCctKelvin: report.cameraProfile.estimatedCctKelvin ?? null,
    fallbackReason: report.cameraProfile.fallbackReason ?? null,
    illuminantEstimateConfidence: report.cameraProfile.illuminantEstimateConfidence,
    illuminantEstimateMethod: report.cameraProfile.illuminantEstimateMethod,
    matrixHash: report.cameraProfile.matrixHash ?? null,
    receiptVersion: 1,
    status: report.cameraProfile.status,
    warmIlluminant: report.cameraProfile.warmIlluminant ?? null,
    warningCount: report.cameraProfile.warningCodes.length,
  });
}
