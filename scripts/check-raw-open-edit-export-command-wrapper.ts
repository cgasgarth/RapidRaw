#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import { toneColorCommandEnvelopeV1Schema } from '../packages/rawengine-schema/src/rawEngineSchemas.ts';
import { sampleRawEngineSceneColorPipelineV1 } from '../packages/rawengine-schema/src/samplePayloads.ts';
import { sampleAgentActor, sampleImageTarget } from '../packages/rawengine-schema/src/samplePayloadFactories.ts';
import {
  rawOpenEditExportProofReportSchema,
  rawOpenEditExportProofRequestSchema,
} from '../src/schemas/rawOpenEditExportCommandSchemas.ts';

const [wrapperSource, appPropertiesSource, rustSource] = await Promise.all([
  readFile('src/utils/rawOpenEditExportProofCommand.ts', 'utf8'),
  readFile('src/components/ui/AppProperties.tsx', 'utf8'),
  readFile('src-tauri/src/raw_open_edit_export_proof.rs', 'utf8'),
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
if (!appPropertiesSource.includes("RunRawOpenEditExportProof = 'run_raw_open_edit_export_proof'")) {
  failures.push('Invokes.RunRawOpenEditExportProof must map to run_raw_open_edit_export_proof.');
}
if (!rustSource.includes('pub async fn run_raw_open_edit_export_proof(')) {
  failures.push('Rust Tauri command run_raw_open_edit_export_proof is missing.');
}

const validHash = `sha256:${'0'.repeat(64)}`;
const editCommand = {
  actor: sampleAgentActor('raw-proof-command-wrapper'),
  approval: {
    approvalClass: 'edit_apply',
    reason: 'Apply accepted basic tone command for RAW open/edit/export runtime proof.',
    state: 'approved',
  },
  colorPipeline: sampleRawEngineSceneColorPipelineV1,
  commandId: 'command.raw-open-edit-export.basic-tone.v1',
  commandType: 'toneColor.setBasicTone',
  correlationId: 'corr.raw-open-edit-export.basic-tone.v1',
  dryRun: false,
  expectedGraphRevision: 'graph-rev.raw-open-edit-export.sample.v1',
  idempotencyKey: 'idem.raw-open-edit-export.basic-tone.v1',
  parameters: {
    blackPoint: -2,
    clarity: 4,
    contrast: 8,
    exposureEv: 0.35,
    highlights: -12,
    saturation: 5,
    shadows: 9,
    whitePoint: 3,
  },
  schemaVersion: 1,
  target: sampleImageTarget('private-fixtures/detail/sample.cr3'),
};
const sampleRequest = rawOpenEditExportProofRequestSchema.parse({
  artifactDirRelative: 'private-artifacts/validation/open-edit-export',
  editCommand,
  fixtureId: 'validation.raw-open-edit-export.sample.v1',
  privateRootPath: '/tmp/rawengine-private-root',
  sourceRelativePath: 'private-fixtures/detail/sample.cr3',
});

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
  editCommandId: sampleRequest.editCommand.commandId,
  editGraphRevision: sampleRequest.editCommand.expectedGraphRevision,
  fixtureId: sampleRequest.fixtureId,
  generatedAt: '2026-06-17T00:00:00Z',
  metrics: [
    { name: 'changedPixelRatio', passed: true, source: 'private_raw_report', threshold: 0, value: 0.1 },
    { name: 'previewExportMeanAbsDelta', passed: true, source: 'private_raw_report', threshold: 0.015, value: 0.01 },
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
