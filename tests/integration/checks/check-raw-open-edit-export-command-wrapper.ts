#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import { toneColorCommandEnvelopeV1Schema } from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import {
  rawOpenEditExportProofReportSchema,
  rawOpenEditExportProofRequestSchema,
} from '../../../src/schemas/rawOpenEditExportCommandSchemas.ts';

const [wrapperSource, appPropertiesSource, rustSource, rustLibSource, proofRequestFixtureSource] = await Promise.all([
  readFile('src/utils/rawOpenEditExportProofCommand.ts', 'utf8'),
  readFile('src/components/ui/AppProperties.tsx', 'utf8'),
  readFile('src-tauri/src/raw_open_edit_export_proof.rs', 'utf8'),
  readFile('src-tauri/src/lib.rs', 'utf8'),
  readFile('fixtures/validation/raw-open-edit-export-proof-request.json', 'utf8'),
]);

const failures: string[] = [];

if (!wrapperSource.includes('invokeWithSchema(')) {
  failures.push('RAW proof wrapper must use invokeWithSchema.');
}
if (!wrapperSource.includes('rawOpenEditExportProofRequestSchema.parse(request)')) {
  failures.push('RAW proof wrapper must parse request payloads before invoke.');
}
if (!wrapperSource.includes('rawOpenEditExportProofReportSchema')) {
  failures.push('RAW proof wrapper must validate command responses with Zod.');
}
if (!wrapperSource.includes("const RAW_OPEN_EDIT_EXPORT_PROOF_COMMAND = 'run_raw_open_edit_export_proof'")) {
  failures.push('RAW proof wrapper must keep the validation command string private to the wrapper.');
}
if (appPropertiesSource.includes('run_raw_open_edit_export_proof')) {
  failures.push('Validation-only RAW proof command must not be exposed through the product Invokes enum.');
}
if (!rustSource.includes('pub async fn run_raw_open_edit_export_proof(')) {
  failures.push('Rust Tauri command run_raw_open_edit_export_proof is missing.');
}
if (
  !rustLibSource.includes('#[cfg(feature = "validation-harness")]') ||
  !rustLibSource.includes('raw_open_edit_export_proof::run_raw_open_edit_export_proof')
) {
  failures.push('Rust RAW proof command must stay gated behind the validation-harness feature.');
}

const validHash = `sha256:${'0'.repeat(64)}`;
const fixtureValue = JSON.parse(proofRequestFixtureSource) as unknown;
const sampleRequest = rawOpenEditExportProofRequestSchema.parse(fixtureValue);

if (!toneColorCommandEnvelopeV1Schema.safeParse(sampleRequest.editCommand).success) {
  failures.push('RAW proof editCommand must stay compatible with ToneColorCommandEnvelopeV1.');
}

const sampleAsset = {
  hash: validHash,
  path: 'private-artifacts/validation/open-edit-export/sample.png',
  publicRepoAllowed: false,
};

rawOpenEditExportProofReportSchema.parse({
  artifacts: [
    { ...sampleAsset, kind: 'source_raw_private', path: sampleRequest.sourceRelativePath },
    { ...sampleAsset, kind: 'preview_before_private' },
    { ...sampleAsset, kind: 'preview_after_private' },
    { ...sampleAsset, kind: 'export_after_private' },
    { ...sampleAsset, kind: 'sidecar_after_private' },
    { ...sampleAsset, kind: 'workflow_report_private' },
  ],
  colorManagement: {
    conformance: 'partial',
    decoderTrace: {
      cameraCalibration: {
        applied: 'not_surfaced_by_current_decoder_trace',
        presence: 'not_surfaced_by_current_decoder_trace',
        source: 'raw_open_edit_export_validation_spine',
      },
      cameraMake: sampleRequest.sourceMetadata.cameraMake,
      cameraModel: sampleRequest.sourceMetadata.cameraModel,
      decodedDimensions: { height: 100, width: 100 },
      privacySafeCameraId: sampleRequest.sourceMetadata.privacySafeCameraId,
      rawFormat: sampleRequest.sourceMetadata.rawFormat,
      sourceHash: validHash,
      whiteBalance: {
        applied: 'not_surfaced_by_current_decoder_trace',
        presence: 'not_surfaced_by_current_decoder_trace',
        source: 'raw_open_edit_export_validation_spine',
      },
    },
    doesNotProve: [
      'acescg_working_space',
      'bradford_chromatic_adaptation',
      'camera_profile_quality',
      'capture_one_class_quality',
      'display_device_visual_match',
      'gpu_color_parity',
      'icc_colorimetric_accuracy',
    ],
    observedColorPipeline: {
      bitDepth: 16,
      cmmUsed: true,
      displayProfileCorrectness: 'active_display_lut_profile_loaded',
      exportColorEncoding: 'display_p3_rgb16_tiff',
      exportFormat: 'tiff',
      gamutMapping: 'not_proven',
      iccProfileEmbedded: true,
      inputDomain: 'decoder_camera_rgb_observed',
      operationDomain: 'linear_srgb_d65_observed',
      outputProfile: 'display_p3',
      renderingIntentApplied: true,
      sceneToDisplayTransform: 'rawengine_agx_v1',
      transferStatus: 'lcms2_bpc_rgb16_display_p3_final_file',
      viewTransform: 'rawengine_agx_v1',
      workingBuffer: 'linear_srgb_d65_observed',
    },
    proofLevel: 'private_raw_runtime_color_management_metadata',
    requestedColorPipeline: sampleRequest.editCommand.colorPipeline,
    runtimeEnvironment: {
      wgpuAdapter: 'not_surfaced_by_current_proof',
      wgpuBackend: 'not_surfaced_by_current_proof',
    },
    trackingIssue: 2308,
    warnings: [
      'Black-point compensation is proven as an applied LittleCMS export policy, not as a full print-match or chart-based colorimetric result.',
    ],
  },
  editCommandId: sampleRequest.editCommand.commandId,
  editGraphRevision: sampleRequest.editCommand.expectedGraphRevision,
  fixtureId: sampleRequest.fixtureId,
  generatedAt: '2026-06-17T00:00:00Z',
  metrics: [
    { name: 'changedPixelRatio', passed: true, source: 'private_raw_report', threshold: 0, value: 0.1 },
    {
      name: 'finalFileBlackPointCompensationApplied',
      passed: true,
      source: 'private_raw_report',
      threshold: 1,
      value: 1,
    },
    { name: 'finalFileBitDepth', passed: true, source: 'private_raw_report', threshold: 16, value: 16 },
    { name: 'finalFileColorEngineLcms2', passed: true, source: 'private_raw_report', threshold: 1, value: 1 },
    { name: 'finalFileIccProfileEmbedded', passed: true, source: 'private_raw_report', threshold: 1, value: 1 },
    { name: 'finalFileReopenSucceeded', passed: true, source: 'private_raw_report', threshold: 1, value: 1 },
    { name: 'finalFileSoftProofRgb8MaxAbsDelta', passed: true, source: 'private_raw_report', threshold: 0, value: 0 },
    { name: 'finalFileSoftProofRgb8MeanAbsDelta', passed: true, source: 'private_raw_report', threshold: 0, value: 0 },
    { name: 'finalFileTransformApplied', passed: true, source: 'private_raw_report', threshold: 1, value: 1 },
    { name: 'previewExportMeanAbsDelta', passed: true, source: 'private_raw_report', threshold: 0.015, value: 0.01 },
    { name: 'softProofExportRgb8MeanAbsDelta', passed: true, source: 'private_raw_report', threshold: 0, value: 0 },
    { name: 'sidecarReloadRevisionMatch', passed: true, source: 'private_raw_report', threshold: 1, value: 1 },
    { name: 'sourceHashUnchanged', passed: true, source: 'private_raw_report', threshold: 1, value: 1 },
  ],
  previewAfter: sampleAsset,
  previewBefore: sampleAsset,
  reportId: 'raw-open-edit-export-run.sample.v1',
  sidecarAfter: sampleAsset,
  sourceRaw: { ...sampleAsset, path: sampleRequest.sourceRelativePath },
  trackingIssue: 1376,
});

if (failures.length > 0) {
  console.error('RAW open/edit/export command wrapper failed.');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('raw open/edit/export command wrapper ok');
