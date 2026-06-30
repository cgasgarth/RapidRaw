#!/usr/bin/env bun

import { Invokes } from '../../../src/tauri/commands.ts';
import {
  tetherCameraControlWriteRequestSchema,
  tetherCameraControlWriteResponseSchema,
  tetherCaptureRequestSchema,
  tetherCaptureResponseSchema,
  tetherDiscoveryResponseSchema,
  tetherIngestProofReceiptSchema,
  tetherRecoveryProofReceiptSchema,
  tetherSessionOpenRequestSchema,
  tetherSessionResponseSchema,
  type TetherCaptureResponse,
  type TetherDiscoveryResponse,
  type TetherSessionResponse,
} from '../../../src/schemas/tetheringSchemas.ts';
import {
  buildTetherIngestProofReceipt,
  buildTetherRecoveryProofReceipt,
} from '../../../src/utils/tetherIngestProofReceipt.ts';

const expectedCommands = {
  CloseTetherSession: 'close_tether_session',
  DiscoverTetheredCameras: 'discover_tethered_cameras',
  GetTetherSession: 'get_tether_session',
  OpenTetherSession: 'open_tether_session',
  SetTetherCameraControl: 'set_tether_camera_control',
  TriggerTetherCapture: 'trigger_tether_capture',
} as const;

for (const [name, command] of Object.entries(expectedCommands)) {
  assertEqual(Invokes[name as keyof typeof expectedCommands], command, `tether command ${name}`);
}

const discovery = tetherDiscoveryResponseSchema.parse({
  cameras: [
    {
      batteryPercent: 87,
      capabilities: [
        { id: 'discovery', label: 'Discovery', status: 'ready' },
        { id: 'remote_capture', label: 'Remote capture ready', status: 'ready' },
        { id: 'live_view', label: 'Live view simulator', status: 'ready' },
      ],
      connection: {
        transport: 'USB-C PTP',
        trusted: true,
      },
      controls: [
        {
          currentValue: '400',
          id: 'iso',
          label: 'ISO',
          status: 'ready',
          unit: null,
          values: ['100', '200', '400', '800', '1600'],
          writable: true,
        },
        {
          currentValue: '1/125',
          id: 'shutterSpeed',
          label: 'Shutter',
          status: 'ready',
          unit: 's',
          values: ['1/60', '1/125', '1/250'],
          writable: true,
        },
        {
          currentValue: 'f/5.6',
          id: 'aperture',
          label: 'Aperture',
          status: 'ready',
          unit: 'f-stop',
          values: ['f/4', 'f/5.6', 'f/8'],
          writable: true,
        },
      ],
      displayName: 'Sony ILCE-7M4',
      id: 'fake-sony-ilce-7m4-usb',
      make: 'Sony',
      model: 'ILCE-7M4',
      storage: {
        freeGb: 118.4,
        label: 'Slot 1',
        state: 'ready',
      },
    },
  ],
  proof: {
    fakeProviderAvailable: true,
    macosProviderBoundary: 'fake_tether_provider',
    manualHardwareRequired: true,
  },
  provider: {
    adapter: 'fake_tether_provider',
    message: 'Fake tether provider is ready for deterministic contract validation.',
    mode: 'fake',
    status: 'ready',
  },
} satisfies TetherDiscoveryResponse);

assertEqual(discovery.cameras[0]?.controls.length, 3, 'fake discovery exposes writable controls');
assertRejectsContract(
  tetherDiscoveryResponseSchema,
  { ...discovery, proof: { fakeProviderAvailable: true, manualHardwareRequired: true } },
  'discovery proof requires macOS provider boundary',
);

const openSessionRequest = tetherSessionOpenRequestSchema.parse({
  cameraId: discovery.cameras[0]?.id,
  destinationRoot: '/tmp/rawengine-tether-captures',
  providerMode: 'fake',
});
assertEqual(openSessionRequest.providerMode, 'fake', 'session request preserves fake provider mode');
assertRejectsContract(
  tetherSessionOpenRequestSchema,
  { cameraId: '', providerMode: 'fake' },
  'session request rejects empty camera IDs',
);

const session = tetherSessionResponseSchema.parse({
  session: {
    cameraDisplayName: 'Sony ILCE-7M4',
    cameraId: openSessionRequest.cameraId,
    captureCounter: 2,
    destinationRoot: openSessionRequest.destinationRoot,
    openedAt: '2026-06-23T00:00:00.000Z',
    providerMode: 'fake',
    recovery: {
      message: 'Partial tether downloads were quarantined before capture.',
      partialFilesFound: 1,
      quarantinedFiles: ['/tmp/rawengine-tether-captures/.rawengine-tether-quarantine/interrupted.ARW.part'],
      status: 'quarantined',
    },
    sessionId: 'tether-session-contract',
    status: 'open',
  },
  status: 'open',
} satisfies TetherSessionResponse);

const recoveryReceipt = buildTetherRecoveryProofReceipt(requireSession(session));
tetherRecoveryProofReceiptSchema.parse(recoveryReceipt);
assertEqual(recoveryReceipt.receiptVersion, 1, 'recovery receipt version');
assertEqual(recoveryReceipt.recoveryStatus, 'quarantined', 'recovery receipt status');
assertEqual(
  recoveryReceipt.firstQuarantinedFile,
  session.session?.recovery.quarantinedFiles[0],
  'recovery receipt quarantined file',
);
assertEqual(recoveryReceipt.quarantinedFileCount, 1, 'recovery receipt quarantine count');
assertRejectsContract(
  tetherRecoveryProofReceiptSchema,
  { ...recoveryReceipt, recoveryStatus: undefined },
  'recovery receipt requires recovery status',
);

const controlRequest = tetherCameraControlWriteRequestSchema.parse({
  cameraId: openSessionRequest.cameraId,
  controlId: 'iso',
  providerMode: 'fake',
  value: '800',
});
assertEqual(controlRequest.controlId, 'iso', 'control request parses ISO writes');
assertRejectsContract(
  tetherCameraControlWriteRequestSchema,
  { cameraId: openSessionRequest.cameraId, controlId: 'whiteBalance', providerMode: 'fake', value: 'daylight' },
  'control request rejects unsupported control IDs',
);

const controlResponse = tetherCameraControlWriteResponseSchema.parse({
  appliedValue: '800',
  cameraId: openSessionRequest.cameraId,
  controlId: 'iso',
  requestedValue: '800',
  status: 'verified',
  verifiedAt: '2026-06-23T00:00:01.000Z',
});
assertEqual(controlResponse.status, 'verified', 'control write response verifies applied value');

const captureRequest = tetherCaptureRequestSchema.parse({
  backupDestinationRoot: '/tmp/rawengine-tether-backup',
  cameraControlValues: {
    aperture: 'f/5.6',
    iso: controlResponse.appliedValue,
    shutterSpeed: '1/125',
  },
  destinationRoot: openSessionRequest.destinationRoot,
  fakeSourcePath: '/fixtures/tether/_DSC7853.ARW',
  ingestPresetId: 'wedding-copy-ingest',
  metadataTemplateId: 'studioSession',
});
assertEqual(captureRequest.ingestPresetId, 'wedding-copy-ingest', 'capture request preserves ingest preset');
assertRejectsContract(
  tetherCaptureRequestSchema,
  { ...captureRequest, ingestPresetId: 'renamed-local-variable' },
  'capture request rejects unknown ingest preset IDs',
);

const capture = tetherCaptureResponseSchema.parse({
  backup: {
    bytes: 25565952,
    checksum: 'sha256:2ada128405c6e1b55734bb69c842259b9e1d1882abbc8f0a50461f456a93e18b',
    destinationPath: '/tmp/rawengine-tether-backup/alaska-dsc7853_0001.ARW',
    enabled: true,
    error: null,
    status: 'verified',
  },
  bytes: 25565952,
  cameraControlValues: captureRequest.cameraControlValues,
  cameraDisplayName: 'Sony ILCE-7M4',
  capturedAt: '2026-06-23T00:00:02.000Z',
  checksum: 'sha256:2ada128405c6e1b55734bb69c842259b9e1d1882abbc8f0a50461f456a93e18b',
  importedPath: '/tmp/rawengine-tether-captures/alaska-dsc7853.ARW',
  ingest: {
    addTags: ['wedding', 'incoming'],
    applyPresetIds: ['camera-standard-start'],
    collisionIndex: 1,
    fileName: '0001_alaska-dsc7853.ARW',
    namingTemplate: '{counter:04}_{source_stem}',
    presetId: captureRequest.ingestPresetId,
  },
  metadata: {
    applied: true,
    appliedFields: ['rating', 'tags', 'Artist', 'ImageDescription', 'UserComment'],
    sidecarPath: '/tmp/rawengine-tether-captures/alaska-dsc7853.ARW.rrdata',
    templateId: captureRequest.metadataTemplateId,
  },
  providerMode: 'fake',
  sessionId: requireSession(session).sessionId,
  sourcePath: captureRequest.fakeSourcePath,
  status: 'captured',
} satisfies TetherCaptureResponse);

const ingestReceipt = buildTetherIngestProofReceipt(capture);
tetherIngestProofReceiptSchema.parse(ingestReceipt);
assertEqual(ingestReceipt.receiptVersion, 1, 'ingest receipt version');
assertEqual(ingestReceipt.backupStatus, 'verified', 'ingest receipt backup status');
assertEqual(ingestReceipt.cameraControlCount, 3, 'ingest receipt control count');
assertEqual(ingestReceipt.duplicateSuppressed, false, 'ingest receipt captured status is not duplicate');
assertEqual(ingestReceipt.ingestPresetId, 'wedding-copy-ingest', 'ingest receipt preset');
assertEqual(ingestReceipt.metadataTemplateId, 'studioSession', 'ingest receipt metadata template');
assertRejectsContract(
  tetherIngestProofReceiptSchema,
  { ...ingestReceipt, checksum: 'sha256:not-a-real-checksum' },
  'ingest receipt requires verified checksum shape',
);
assertRejectsContract(
  tetherCaptureResponseSchema,
  { ...capture, backup: { ...capture.backup, status: 'copied' } },
  'capture response rejects unknown backup status',
);

const duplicateCapture = tetherCaptureResponseSchema.parse({
  ...capture,
  backup: {
    bytes: null,
    checksum: null,
    destinationPath: null,
    enabled: false,
    error: null,
    status: 'disabled',
  },
  status: 'duplicate',
});
const duplicateReceipt = buildTetherIngestProofReceipt(duplicateCapture);
assertEqual(duplicateReceipt.duplicateSuppressed, true, 'duplicate capture receipt reports suppression');
assertEqual(duplicateReceipt.backupEnabled, false, 'duplicate capture receipt keeps backup disabled');

console.log(
  `tether contracts ok (commands=${Object.keys(expectedCommands).length}, controls=${discovery.cameras[0]?.controls.length}, receipts=2)`,
);

function requireSession(response: TetherSessionResponse): NonNullable<TetherSessionResponse['session']> {
  if (response.session === null) throw new Error('Expected open tether session in contract fixture.');
  return response.session;
}

function assertRejectsContract(
  schema: { safeParse: (value: unknown) => { success: boolean } },
  value: unknown,
  label: string,
): void {
  if (schema.safeParse(value).success) {
    throw new Error(`${label}: expected schema rejection`);
  }
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
