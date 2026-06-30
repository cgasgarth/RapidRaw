import {
  type TetherCaptureResponse,
  type TetherIngestProofReceipt,
  type TetherRecoveryProofReceipt,
  type TetherSessionSnapshot,
  tetherIngestProofReceiptSchema,
  tetherRecoveryProofReceiptSchema,
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

export function buildTetherRecoveryProofReceipt(session: TetherSessionSnapshot): TetherRecoveryProofReceipt {
  return tetherRecoveryProofReceiptSchema.parse({
    cameraDisplayName: session.cameraDisplayName,
    captureCounter: session.captureCounter,
    destinationRoot: session.destinationRoot,
    firstQuarantinedFile: session.recovery.quarantinedFiles[0] ?? null,
    partialFilesFound: session.recovery.partialFilesFound,
    providerMode: session.providerMode,
    quarantinedFileCount: session.recovery.quarantinedFiles.length,
    receiptVersion: 1,
    recoveryMessage: session.recovery.message,
    recoveryStatus: session.recovery.status,
    reconnectRequired: session.status === 'reconnect_required' || session.recovery.status === 'reconnect_required',
    sessionId: session.sessionId,
    sessionStatus: session.status,
  });
}
