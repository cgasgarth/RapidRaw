#!/usr/bin/env bun

import { readFile, writeFile } from 'node:fs/promises';

import { z } from 'zod';

import { parseRawOpenEditExportRunReportCollection } from '../../../src/schemas/rawOpenEditExportRunReportSchemas.ts';

const REQUEST_PATH = 'fixtures/validation/raw-open-edit-export-proof-request.json';
const RUN_REPORTS_PATH = 'fixtures/validation/raw-open-edit-export-run-reports.json';
const COLORSYNC_PROOF_PATH = 'docs/validation/macos-colorsync-display-proof-2026-06-20.json';
const REPORT_PATH = 'docs/validation/raw-color-management-runtime-proof-2026-06-20.json';
const UPDATE_REPORT = process.argv.includes('--update');

const whitePointSchema = z.object({ x: z.number().positive(), y: z.number().positive() }).strict();

const colorPipelineRequestSchema = z
  .object({
    chromaticAdaptation: z
      .object({
        method: z.literal('bradford_v1'),
        sourceWhitePoint: whitePointSchema,
        status: z.literal('math_validated'),
        targetWhitePoint: whitePointSchema,
        warnings: z.array(z.string()),
      })
      .strict(),
    inputDomain: z.literal('camera_linear_rgb'),
    operationDomain: z.literal('acescg_linear_v1'),
    renderTarget: z
      .object({
        bitDepth: z.literal(16),
        embedIcc: z.literal(true),
        intent: z.literal('relative_colorimetric'),
        outputProfile: z.literal('display_p3'),
        viewTransform: z.literal('rawengine_agx_v1'),
      })
      .strict(),
    sceneToDisplayTransform: z.literal('rawengine_agx_v1'),
    workingSpace: z.literal('acescg_linear_v1'),
  })
  .strict();

const rawProofRequestSchema = z
  .object({
    editCommand: z
      .object({
        colorPipeline: colorPipelineRequestSchema,
        commandId: z.string().min(1),
        target: z.object({ imagePath: z.string().min(1), kind: z.literal('image') }).strict(),
      })
      .passthrough(),
    fixtureId: z.string().min(1),
    sourceRelativePath: z.string().min(1),
  })
  .passthrough();

const colorSyncProofSchema = z
  .object({
    fixtureId: z.string().min(1),
    outputTransform: z
      .object({
        bitDepth: z.literal(16),
        embedIcc: z.literal(true),
        intent: z.literal('relative_colorimetric'),
        outputProfile: z.literal('display_p3'),
        sceneToDisplayTransform: z.literal('rawengine_agx_v1'),
        viewTransform: z.literal('rawengine_agx_v1'),
        workingSpace: z.literal('acescg_linear_v1'),
      })
      .strict(),
    runtimeStatus: z.literal('local_macos_colorsync_display_transform_proof'),
    sourceRelativePath: z.string().min(1),
  })
  .passthrough();

const proofReportSchema = z
  .object({
    cases: z
      .array(
        z
          .object({
            artifacts: z.object({
              exportHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
              sourceRawHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
              workflowReportHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
            }),
            colorManagement: z.object({
              bitDepth: z.literal(16),
              embedIcc: z.literal(true),
              inputDomain: z.literal('camera_linear_rgb'),
              intent: z.literal('relative_colorimetric'),
              operationDomain: z.literal('acescg_linear_v1'),
              outputProfile: z.literal('display_p3'),
              proofLevel: z.literal('private_raw_runtime_color_management_metadata'),
              sceneToDisplayTransform: z.literal('rawengine_agx_v1'),
              viewTransform: z.literal('rawengine_agx_v1'),
              workingSpace: z.literal('acescg_linear_v1'),
            }),
            commandId: z.string().min(1),
            doesNotProve: z.array(z.string().min(1)).min(5),
            fixtureId: z.string().min(1),
            metrics: z.object({
              changedPixelRatio: z.number().positive(),
              previewExportMeanAbsDelta: z.number().min(0).max(0.015),
              sourceHashUnchanged: z.literal(1),
            }),
            sourceRelativePath: z.string().min(1),
          })
          .strict(),
      )
      .min(1),
    colorSyncProofPath: z.literal(COLORSYNC_PROOF_PATH),
    issue: z.literal(2308),
    requestPath: z.literal(REQUEST_PATH),
    runReportsPath: z.literal(RUN_REPORTS_PATH),
    schemaVersion: z.literal(1),
    validationMode: z.literal('private_raw_color_management_runtime_metadata'),
  })
  .strict();

const request = rawProofRequestSchema.parse(JSON.parse(await readFile(REQUEST_PATH, 'utf8')));
const colorSyncProof = colorSyncProofSchema.parse(JSON.parse(await readFile(COLORSYNC_PROOF_PATH, 'utf8')));
const reportCollection = parseRawOpenEditExportRunReportCollection(
  JSON.parse(await readFile(RUN_REPORTS_PATH, 'utf8')),
);
const failures: string[] = [];
const cases = [];

for (const runReport of reportCollection.reports) {
  if (runReport.fixtureId !== request.fixtureId) continue;

  const metric = (name: string) => runReport.metrics.find((candidate) => candidate.name === name);
  const changedPixelRatio = metric('changedPixelRatio')?.value;
  const previewExportMeanAbsDelta = metric('previewExportMeanAbsDelta')?.value;
  const sourceHashUnchanged = metric('sourceHashUnchanged')?.value;
  const exportArtifact = runReport.artifacts.find((artifact) => artifact.kind === 'export_after_private');
  const workflowArtifact = runReport.artifacts.find((artifact) => artifact.kind === 'workflow_report_private');
  const colorManagement = runReport.colorManagement;

  compare('source RAW path', runReport.sourceRaw.path, request.sourceRelativePath);
  compare('target image path', runReport.sourceRaw.path, request.editCommand.target.imagePath);
  compare('command ID', runReport.editCommandId, request.editCommand.commandId);
  compare('input domain', colorManagement.inputDomain, request.editCommand.colorPipeline.inputDomain);
  compare('operation domain', colorManagement.operationDomain, request.editCommand.colorPipeline.operationDomain);
  compare('working space', colorManagement.workingSpace, request.editCommand.colorPipeline.workingSpace);
  compare(
    'chromatic adaptation method',
    colorManagement.chromaticAdaptation.method,
    request.editCommand.colorPipeline.chromaticAdaptation.method,
  );
  compare(
    'scene-to-display transform',
    colorManagement.displayTransform.sceneToDisplayTransform,
    request.editCommand.colorPipeline.sceneToDisplayTransform,
  );
  compare(
    'output profile',
    colorManagement.displayTransform.outputProfile,
    request.editCommand.colorPipeline.renderTarget.outputProfile,
  );
  compare(
    'view transform',
    colorManagement.displayTransform.viewTransform,
    request.editCommand.colorPipeline.renderTarget.viewTransform,
  );
  compare('ColorSync fixture', colorSyncProof.fixtureId, runReport.fixtureId);
  compare('ColorSync source', colorSyncProof.sourceRelativePath, runReport.sourceRaw.path);
  compare('ColorSync working space', colorSyncProof.outputTransform.workingSpace, colorManagement.workingSpace);

  if (changedPixelRatio === undefined || changedPixelRatio <= 0) {
    failures.push(`${runReport.fixtureId}: changedPixelRatio must be greater than zero.`);
  }
  if (previewExportMeanAbsDelta === undefined || previewExportMeanAbsDelta > 0.015) {
    failures.push(`${runReport.fixtureId}: previewExportMeanAbsDelta must be <= 0.015.`);
  }
  if (sourceHashUnchanged !== 1) {
    failures.push(`${runReport.fixtureId}: sourceHashUnchanged must be 1.`);
  }
  if (exportArtifact === undefined) failures.push(`${runReport.fixtureId}: missing export_after_private artifact.`);
  if (workflowArtifact === undefined)
    failures.push(`${runReport.fixtureId}: missing workflow_report_private artifact.`);

  cases.push({
    artifacts: {
      exportHash: exportArtifact?.hash,
      sourceRawHash: runReport.sourceRaw.hash,
      workflowReportHash: workflowArtifact?.hash,
    },
    colorManagement: {
      bitDepth: colorManagement.displayTransform.bitDepth,
      embedIcc: colorManagement.displayTransform.embedIcc,
      inputDomain: colorManagement.inputDomain,
      intent: colorManagement.displayTransform.intent,
      operationDomain: colorManagement.operationDomain,
      outputProfile: colorManagement.displayTransform.outputProfile,
      proofLevel: colorManagement.proofLevel,
      sceneToDisplayTransform: colorManagement.displayTransform.sceneToDisplayTransform,
      viewTransform: colorManagement.displayTransform.viewTransform,
      workingSpace: colorManagement.workingSpace,
    },
    commandId: runReport.editCommandId,
    doesNotProve: colorManagement.doesNotProve,
    fixtureId: runReport.fixtureId,
    metrics: {
      changedPixelRatio,
      previewExportMeanAbsDelta,
      sourceHashUnchanged,
    },
    sourceRelativePath: runReport.sourceRaw.path,
  });
}

if (cases.length === 0) failures.push(`${request.fixtureId}: missing matching private RAW run report.`);

const proofReport = proofReportSchema.parse({
  cases,
  colorSyncProofPath: COLORSYNC_PROOF_PATH,
  issue: 2308,
  requestPath: REQUEST_PATH,
  runReportsPath: RUN_REPORTS_PATH,
  schemaVersion: 1,
  validationMode: 'private_raw_color_management_runtime_metadata',
});

if (UPDATE_REPORT) {
  await writeFile(REPORT_PATH, `${JSON.stringify(proofReport, null, 2)}\n`);
} else {
  const expectedReport = proofReportSchema.parse(JSON.parse(await readFile(REPORT_PATH, 'utf8')));
  if (JSON.stringify(expectedReport) !== JSON.stringify(proofReport)) {
    failures.push(
      `${REPORT_PATH} is stale; run bun tests/integration/checks/check-raw-color-management-runtime-proof.ts --update`,
    );
  }
}

if (failures.length > 0) {
  console.error('RAW color-management runtime proof failed:');
  console.error(failures.slice(0, 12).join('\n'));
  process.exit(1);
}

console.log(`raw color-management runtime proof ok (${proofReport.cases.length} private RAW report case)`);

function compare(label: string, actual: string | number | boolean, expected: string | number | boolean): void {
  if (actual !== expected) failures.push(`${label}: expected ${expected}, got ${actual}.`);
}
