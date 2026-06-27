import { z } from 'zod';

export const tetherIngestPresetIdSchema = z.enum([
  'cameraSequence',
  'sourceSequence',
  'timestampCamera',
  'wedding-copy-ingest',
]);
export const tetherMetadataTemplateIdSchema = z.enum([
  'none',
  'studioSession',
  'reviewSelect',
  'copyright-client-delivery',
]);
export const tetherCameraControlIdSchema = z.enum(['iso', 'shutterSpeed', 'aperture']);
export const tetherCameraControlStatusSchema = z.enum(['ready', 'read_only', 'unsupported']);

export const tetherCapabilitySchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  status: z.enum(['ready', 'not_checked', 'unavailable']),
});

export const tetherCameraControlSchema = z.object({
  currentValue: z.string().trim().min(1),
  id: tetherCameraControlIdSchema,
  label: z.string().trim().min(1),
  status: tetherCameraControlStatusSchema,
  unit: z.string().trim().min(1).nullable(),
  values: z.array(z.string().trim().min(1)).min(1),
  writable: z.boolean(),
});

export const tetheredCameraSchema = z.object({
  batteryPercent: z.number().int().min(0).max(100).nullable(),
  capabilities: z.array(tetherCapabilitySchema),
  connection: z.object({
    transport: z.string().trim().min(1),
    trusted: z.boolean(),
  }),
  displayName: z.string().trim().min(1),
  id: z.string().trim().min(1),
  make: z.string().trim().min(1),
  model: z.string().trim().min(1),
  controls: z.array(tetherCameraControlSchema).default([]),
  storage: z.object({
    freeGb: z.number().nonnegative().nullable(),
    label: z.string().trim().min(1),
    state: z.enum(['ready', 'unknown', 'unavailable']),
  }),
});

export const tetherDiscoveryResponseSchema = z.object({
  cameras: z.array(tetheredCameraSchema),
  proof: z.object({
    fakeProviderAvailable: z.boolean(),
    macosProviderBoundary: z.string().trim().min(1),
    manualHardwareRequired: z.boolean(),
  }),
  provider: z.object({
    adapter: z.string().trim().min(1),
    message: z.string().trim().min(1),
    mode: z.enum(['auto', 'fake']),
    status: z.enum(['ready', 'hardware_adapter_pending']),
  }),
});

export const tetherRecoverySummarySchema = z.object({
  message: z.string().trim().min(1),
  partialFilesFound: z.number().int().nonnegative(),
  quarantinedFiles: z.array(z.string().trim().min(1)),
  status: z.enum(['clean', 'failed', 'not_checked', 'quarantined', 'reconnect_required']),
});

export const tetherSessionSnapshotSchema = z.object({
  cameraDisplayName: z.string().trim().min(1),
  cameraId: z.string().trim().min(1),
  captureCounter: z.number().int().nonnegative(),
  destinationRoot: z.string().trim().min(1).nullable(),
  openedAt: z.string().trim().min(1),
  providerMode: z.enum(['auto', 'fake']),
  recovery: tetherRecoverySummarySchema,
  sessionId: z.string().trim().min(1),
  status: z.enum(['open', 'reconnect_required']),
});

export const tetherSessionResponseSchema = z.object({
  session: tetherSessionSnapshotSchema.nullable(),
  status: z.enum(['open', 'closed']),
});

export const tetherSessionOpenRequestSchema = z.object({
  cameraId: z.string().trim().min(1),
  destinationRoot: z.string().trim().min(1).optional(),
  providerMode: z.enum(['auto', 'fake']).default('auto'),
});

export const tetherCameraControlWriteRequestSchema = z.object({
  cameraId: z.string().trim().min(1),
  controlId: tetherCameraControlIdSchema,
  providerMode: z.enum(['auto', 'fake']).default('auto'),
  value: z.string().trim().min(1),
});

export const tetherCameraControlWriteResponseSchema = z.object({
  appliedValue: z.string().trim().min(1),
  cameraId: z.string().trim().min(1),
  controlId: tetherCameraControlIdSchema,
  requestedValue: z.string().trim().min(1),
  status: z.literal('verified'),
  verifiedAt: z.string().trim().min(1),
});

export const tetherCaptureRequestSchema = z.object({
  backupDestinationRoot: z.string().trim().min(1).optional(),
  cameraControlValues: z.record(z.string().trim().min(1), z.string().trim().min(1)).default({}),
  destinationRoot: z.string().trim().min(1).optional(),
  fakeSourcePath: z.string().trim().min(1).optional(),
  ingestPresetId: tetherIngestPresetIdSchema.default('timestampCamera'),
  metadataTemplateId: tetherMetadataTemplateIdSchema.default('none'),
});

export const tetherCaptureBackupSchema = z.object({
  bytes: z.number().int().nonnegative().nullable(),
  checksum: z
    .string()
    .trim()
    .regex(/^sha256:[a-f0-9]{64}$/u)
    .nullable(),
  destinationPath: z.string().trim().min(1).nullable(),
  enabled: z.boolean(),
  error: z.string().trim().min(1).nullable(),
  status: z.enum(['disabled', 'failed', 'verified']),
});

export const tetherCaptureIngestSchema = z.object({
  addTags: z.array(z.string().trim().min(1)).default([]),
  applyPresetIds: z.array(z.string().trim().min(1)).default([]),
  collisionIndex: z.number().int().min(1),
  fileName: z.string().trim().min(1),
  namingTemplate: z.string().trim().min(1),
  presetId: tetherIngestPresetIdSchema,
});

export const tetherCaptureMetadataSchema = z.object({
  applied: z.boolean(),
  appliedFields: z.array(z.string().trim().min(1)),
  sidecarPath: z.string().trim().min(1).nullable(),
  templateId: tetherMetadataTemplateIdSchema,
});

export const tetherCaptureResponseSchema = z.object({
  backup: tetherCaptureBackupSchema,
  bytes: z.number().int().nonnegative(),
  cameraDisplayName: z.string().trim().min(1),
  cameraControlValues: z.record(z.string().trim().min(1), z.string().trim().min(1)).default({}),
  capturedAt: z.string().trim().min(1),
  checksum: z
    .string()
    .trim()
    .regex(/^sha256:[a-f0-9]{64}$/u),
  ingest: tetherCaptureIngestSchema,
  importedPath: z.string().trim().min(1),
  metadata: tetherCaptureMetadataSchema,
  providerMode: z.enum(['auto', 'fake']),
  sessionId: z.string().trim().min(1),
  sourcePath: z.string().trim().min(1),
  status: z.enum(['captured', 'duplicate']),
});

export const tetherIngestProofReceiptSchema = z.object({
  backupDestinationPath: z.string().trim().min(1).nullable(),
  backupEnabled: z.boolean(),
  backupStatus: tetherCaptureBackupSchema.shape.status,
  bytes: z.number().int().nonnegative(),
  cameraControlCount: z.number().int().nonnegative(),
  capturedAt: z.string().trim().min(1),
  checksum: tetherCaptureResponseSchema.shape.checksum,
  collisionIndex: tetherCaptureIngestSchema.shape.collisionIndex,
  duplicateSuppressed: z.boolean(),
  ingestPresetId: tetherIngestPresetIdSchema,
  importedPath: tetherCaptureResponseSchema.shape.importedPath,
  metadataApplied: z.boolean(),
  metadataSidecarPath: z.string().trim().min(1).nullable(),
  metadataTemplateId: tetherMetadataTemplateIdSchema,
  providerMode: tetherCaptureResponseSchema.shape.providerMode,
  receiptVersion: z.literal(1),
  sessionId: tetherCaptureResponseSchema.shape.sessionId,
  status: tetherCaptureResponseSchema.shape.status,
});

export const tetherRecoveryProofReceiptSchema = z.object({
  cameraDisplayName: tetherSessionSnapshotSchema.shape.cameraDisplayName,
  captureCounter: tetherSessionSnapshotSchema.shape.captureCounter,
  destinationRoot: tetherSessionSnapshotSchema.shape.destinationRoot,
  firstQuarantinedFile: z.string().trim().min(1).nullable(),
  partialFilesFound: tetherRecoverySummarySchema.shape.partialFilesFound,
  providerMode: tetherSessionSnapshotSchema.shape.providerMode,
  quarantinedFileCount: z.number().int().nonnegative(),
  receiptVersion: z.literal(1),
  recoveryMessage: tetherRecoverySummarySchema.shape.message,
  recoveryStatus: tetherRecoverySummarySchema.shape.status,
  reconnectRequired: z.boolean(),
  sessionId: tetherSessionSnapshotSchema.shape.sessionId,
  sessionStatus: tetherSessionSnapshotSchema.shape.status,
});

export type TetherCapability = z.infer<typeof tetherCapabilitySchema>;
export type TetherCameraControl = z.infer<typeof tetherCameraControlSchema>;
export type TetherCameraControlWriteRequest = z.infer<typeof tetherCameraControlWriteRequestSchema>;
export type TetherCameraControlWriteResponse = z.infer<typeof tetherCameraControlWriteResponseSchema>;
export type TetherCaptureRequest = z.infer<typeof tetherCaptureRequestSchema>;
export type TetherCaptureResponse = z.infer<typeof tetherCaptureResponseSchema>;
export type TetherDiscoveryResponse = z.infer<typeof tetherDiscoveryResponseSchema>;
export type TetherIngestProofReceipt = z.infer<typeof tetherIngestProofReceiptSchema>;
export type TetherRecoveryProofReceipt = z.infer<typeof tetherRecoveryProofReceiptSchema>;
export type TetherRecoverySummary = z.infer<typeof tetherRecoverySummarySchema>;
export type TetherSessionOpenRequest = z.infer<typeof tetherSessionOpenRequestSchema>;
export type TetherSessionResponse = z.infer<typeof tetherSessionResponseSchema>;
export type TetherSessionSnapshot = z.infer<typeof tetherSessionSnapshotSchema>;
export type TetheredCamera = z.infer<typeof tetheredCameraSchema>;
