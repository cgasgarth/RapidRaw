import {
  tetherIngestProofReceiptSchema,
  type TetherCaptureResponse,
  type TetherIngestProofReceipt,
} from '../schemas/tetheringSchemas';

export function buildTetherIngestProofReceipt(capture: TetherCaptureResponse): TetherIngestProofReceipt {
  return tetherIngestProofReceiptSchema.parse({
    backupDestinationPath: capture.backup.destinationPath,
    backupEnabled: capture.backup.enabled,
    backupStatus: capture.backup.status,
    bytes: capture.bytes,
    cameraControlCount: Object.keys(capture.cameraControlValues).length,
    capturedAt: capture.capturedAt,
    checksum: capture.checksum,
    collisionIndex: capture.ingest.collisionIndex,
    duplicateSuppressed: capture.status === 'duplicate',
    ingestPresetId: capture.ingest.presetId,
    importedPath: capture.importedPath,
    metadataApplied: capture.metadata.applied,
    metadataSidecarPath: capture.metadata.sidecarPath,
    metadataTemplateId: capture.metadata.templateId,
    providerMode: capture.providerMode,
    receiptVersion: 1,
    sessionId: capture.sessionId,
    status: capture.status,
  });
}
