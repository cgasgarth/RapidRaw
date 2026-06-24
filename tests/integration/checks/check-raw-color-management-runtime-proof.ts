#!/usr/bin/env bun

import { readFile, writeFile } from 'node:fs/promises';

import { z } from 'zod';

import { parseRawOpenEditExportRunReportCollection } from '../../../src/schemas/rawOpenEditExportRunReportSchemas.ts';

const REQUEST_PATH = 'fixtures/validation/raw-open-edit-export-proof-request.json';
const REPORT_PATH = 'docs/validation/raw-color-management-runtime-proof-2026-06-20.json';
const UPDATE_REPORT = process.argv.includes('--update');
const VALIDATE_ONLY = process.argv.includes('--validate-only');
const RUN_REPORTS_PATH = valueAfter('--run-reports');

if (RUN_REPORTS_PATH === undefined) {
  console.error(
    'Missing --run-reports <path>. Generate a private report first; committed run-report fixtures are not used.',
  );
  process.exit(1);
}

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
    sourceMetadata: z
      .object({
        cameraMake: z.string().min(1),
        cameraModel: z.string().min(1),
        privacySafeCameraId: z.string().min(1),
        rawFormat: z.string().min(1),
      })
      .strict(),
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
              conformance: z.literal('partial'),
              observedBitDepth: z.literal(16),
              observedExportColorEncoding: z.literal('display_p3_rgb16_tiff'),
              observedIccProfileEmbedded: z.literal(true),
              observedOperationDomain: z.literal('linear_srgb_d65_observed'),
              observedOutputProfile: z.literal('display_p3'),
              proofLevel: z.literal('private_raw_runtime_color_management_metadata'),
              requestedOperationDomain: z.literal('acescg_linear_v1'),
              requestedOutputProfile: z.literal('display_p3'),
              requestedRenderBitDepth: z.literal(16),
              requestedViewTransform: z.literal('rawengine_agx_v1'),
            }),
            commandId: z.string().min(1),
            decoderTrace: z.object({
              cameraMake: z.string().min(1),
              cameraModel: z.string().min(1),
              decodedHeight: z.number().int().positive(),
              decodedWidth: z.number().int().positive(),
              privacySafeCameraId: z.string().min(1),
              rawFormat: z.string().min(1),
              sourceHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
            }),
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
    issue: z.literal(2308),
    requestPath: z.literal(REQUEST_PATH),
    runReportsPath: z.literal(RUN_REPORTS_PATH),
    schemaVersion: z.literal(1),
    validationMode: z.literal('private_raw_color_management_runtime_metadata'),
  })
  .strict();

const request = rawProofRequestSchema.parse(JSON.parse(await readFile(REQUEST_PATH, 'utf8')));
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
  compare(
    'requested input domain',
    colorManagement.requestedColorPipeline.inputDomain,
    request.editCommand.colorPipeline.inputDomain,
  );
  compare(
    'requested operation domain',
    colorManagement.requestedColorPipeline.operationDomain,
    request.editCommand.colorPipeline.operationDomain,
  );
  compare(
    'requested working space',
    colorManagement.requestedColorPipeline.workingSpace,
    request.editCommand.colorPipeline.workingSpace,
  );
  compare(
    'chromatic adaptation method',
    colorManagement.requestedColorPipeline.chromaticAdaptation.method,
    request.editCommand.colorPipeline.chromaticAdaptation.method,
  );
  compare(
    'scene-to-display transform',
    colorManagement.observedColorPipeline.sceneToDisplayTransform,
    request.editCommand.colorPipeline.sceneToDisplayTransform,
  );
  compare(
    'requested output profile',
    colorManagement.requestedColorPipeline.renderTarget.outputProfile,
    request.editCommand.colorPipeline.renderTarget.outputProfile,
  );
  compare(
    'view transform',
    colorManagement.observedColorPipeline.viewTransform,
    request.editCommand.colorPipeline.renderTarget.viewTransform,
  );
  compare('source hash trace', colorManagement.decoderTrace.sourceHash, runReport.sourceRaw.hash);
  compare('RAW format trace', colorManagement.decoderTrace.rawFormat, request.sourceMetadata.rawFormat);
  compare('camera make trace', colorManagement.decoderTrace.cameraMake, request.sourceMetadata.cameraMake);
  compare('camera model trace', colorManagement.decoderTrace.cameraModel, request.sourceMetadata.cameraModel);
  compare(
    'privacy-safe camera ID trace',
    colorManagement.decoderTrace.privacySafeCameraId,
    request.sourceMetadata.privacySafeCameraId,
  );

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
      conformance: colorManagement.conformance,
      observedBitDepth: colorManagement.observedColorPipeline.bitDepth,
      observedExportColorEncoding: colorManagement.observedColorPipeline.exportColorEncoding,
      observedIccProfileEmbedded: colorManagement.observedColorPipeline.iccProfileEmbedded,
      observedOperationDomain: colorManagement.observedColorPipeline.operationDomain,
      observedOutputProfile: colorManagement.observedColorPipeline.outputProfile,
      proofLevel: colorManagement.proofLevel,
      requestedOperationDomain: colorManagement.requestedColorPipeline.operationDomain,
      requestedOutputProfile: colorManagement.requestedColorPipeline.renderTarget.outputProfile,
      requestedRenderBitDepth: colorManagement.requestedColorPipeline.renderTarget.bitDepth,
      requestedViewTransform: colorManagement.requestedColorPipeline.renderTarget.viewTransform,
    },
    commandId: runReport.editCommandId,
    decoderTrace: {
      cameraMake: colorManagement.decoderTrace.cameraMake,
      cameraModel: colorManagement.decoderTrace.cameraModel,
      decodedHeight: colorManagement.decoderTrace.decodedDimensions.height,
      decodedWidth: colorManagement.decoderTrace.decodedDimensions.width,
      privacySafeCameraId: colorManagement.decoderTrace.privacySafeCameraId,
      rawFormat: colorManagement.decoderTrace.rawFormat,
      sourceHash: colorManagement.decoderTrace.sourceHash,
    },
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
  issue: 2308,
  requestPath: REQUEST_PATH,
  runReportsPath: RUN_REPORTS_PATH,
  schemaVersion: 1,
  validationMode: 'private_raw_color_management_runtime_metadata',
});

if (UPDATE_REPORT) {
  await writeFile(REPORT_PATH, `${JSON.stringify(proofReport, null, 2)}\n`);
} else if (!VALIDATE_ONLY) {
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

function valueAfter(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
