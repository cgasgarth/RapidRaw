#!/usr/bin/env bun

import { readFile, writeFile } from 'node:fs/promises';

import { z } from 'zod';

const RAW_PROOF_REPORT_PATH = 'docs/validation/selective-color-local-raw-proof-2026-06-20.json';
const UI_PROOF_REPORT_PATH = 'docs/validation/selective-color-private-ui-proof-2026-06-20.json';
const SCREENSHOT_PATH = 'artifacts/visual-smoke/color-workflow.png';
const update = process.argv.includes('--update');

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const pngDimensionsSchema = z.object({ height: z.literal(960), width: z.literal(1440) }).strict();

const rawProofReportSchema = z
  .object({
    fixtureId: z.literal('validation.raw-open-edit-export.selective-color-orange.v1'),
    issue: z.literal(2476),
    localRawRuntime: z
      .object({
        editCommandId: z.literal('command.raw-open-edit-export.selective-color-orange.v1'),
        metrics: z
          .object({
            changedPixelRatio: z.number().gt(0),
            previewExportMeanAbsDelta: z.number().min(0).max(0.015),
            sidecarReloadRevisionMatch: z.literal(1),
            sourceHashUnchanged: z.literal(1),
          })
          .strict(),
        status: z.literal('passed'),
        workflowReportPath: z.literal(
          'private-artifacts/validation/selective-color/selective-color-orange-v1-workflow-report.json',
        ),
      })
      .passthrough(),
    sourceRaw: z
      .object({
        fixtureStatus: z.literal('private_cc_raw_not_committed'),
        localPath: z.literal('private-fixtures/detail/high-iso-skin-shadow-v1.arw'),
        sha256: sha256Schema,
      })
      .strict(),
    workflowArtifacts: z
      .array(
        z
          .object({
            hash: sha256Schema,
            kind: z.string().min(1),
            path: z.string().trim().min(1),
            publicRepoAllowed: z.literal(false),
          })
          .strict(),
      )
      .min(6),
  })
  .passthrough();

const uiProofReportSchema = z
  .object({
    doesNotProve: z.array(z.string().min(1)).min(1),
    fixtureId: z.literal('validation.raw-open-edit-export.selective-color-orange.v1'),
    issue: z.literal(2476),
    rawRuntime: z
      .object({
        editCommandId: z.literal('command.raw-open-edit-export.selective-color-orange.v1'),
        metrics: rawProofReportSchema.shape.localRawRuntime.shape.metrics,
        sourceRawSha256: sha256Schema,
        workflowArtifactCount: z.number().int().min(6),
        workflowReportPath: z.literal(
          'private-artifacts/validation/selective-color/selective-color-orange-v1-workflow-report.json',
        ),
      })
      .strict(),
    schemaVersion: z.literal(1),
    validationCommands: z
      .array(
        z.enum([
          'RAWENGINE_PRIVATE_RAW_ROOT=/tmp/rawengine-private-root bun run check:selective-color-local-raw-proof -- --require-assets',
          'bun scripts/capture-visual-smoke.ts --scenario color-workflow',
          'bun run check:selective-color-private-ui-proof',
        ]),
      )
      .length(3),
    visualReview: z
      .object({
        dimensions: pngDimensionsSchema,
        scenario: z.literal('color-workflow'),
        screenshotPath: z.literal(SCREENSHOT_PATH),
        selectiveColorControlsExercised: z.literal(true),
      })
      .strict(),
  })
  .strict();

function runCommand(command: string[], env: Record<string, string> = {}) {
  const result = Bun.spawnSync(command, { env: { ...process.env, ...env }, stderr: 'pipe', stdout: 'pipe' });
  if (result.success) return;

  const output = [new TextDecoder().decode(result.stdout), new TextDecoder().decode(result.stderr)]
    .join('\n')
    .split('\n')
    .filter(Boolean)
    .slice(-30)
    .join('\n');
  throw new Error(`${command.join(' ')} failed:\n${output}`);
}

async function readPngDimensions(path: string) {
  const buffer = await readFile(path);
  if (buffer.toString('ascii', 1, 4) !== 'PNG') {
    throw new Error(`${path} is not a PNG file.`);
  }

  return pngDimensionsSchema.parse({
    height: buffer.readUInt32BE(20),
    width: buffer.readUInt32BE(16),
  });
}

runCommand(['bun', 'run', 'check:selective-color-local-raw-proof', '--', '--require-assets'], {
  RAWENGINE_PRIVATE_RAW_ROOT: '/tmp/rawengine-private-root',
});
runCommand(['bun', 'scripts/capture-visual-smoke.ts', '--scenario', 'color-workflow']);

const rawProofReport = rawProofReportSchema.parse(JSON.parse(await readFile(RAW_PROOF_REPORT_PATH, 'utf8')));
const screenshotDimensions = await readPngDimensions(SCREENSHOT_PATH);
const expectedReport = uiProofReportSchema.parse({
  doesNotProve: [
    'capture_one_class_color_quality',
    'full_macos_app_manual_session',
    'gpu_cpu_parity',
    'icc_colorimetric_accuracy',
    'public_raw_fixture',
  ],
  fixtureId: rawProofReport.fixtureId,
  issue: 2476,
  rawRuntime: {
    editCommandId: rawProofReport.localRawRuntime.editCommandId,
    metrics: rawProofReport.localRawRuntime.metrics,
    sourceRawSha256: rawProofReport.sourceRaw.sha256,
    workflowArtifactCount: rawProofReport.workflowArtifacts.length,
    workflowReportPath: rawProofReport.localRawRuntime.workflowReportPath,
  },
  schemaVersion: 1,
  validationCommands: [
    'RAWENGINE_PRIVATE_RAW_ROOT=/tmp/rawengine-private-root bun run check:selective-color-local-raw-proof -- --require-assets',
    'bun scripts/capture-visual-smoke.ts --scenario color-workflow',
    'bun run check:selective-color-private-ui-proof',
  ],
  visualReview: {
    dimensions: screenshotDimensions,
    scenario: 'color-workflow',
    screenshotPath: SCREENSHOT_PATH,
    selectiveColorControlsExercised: true,
  },
});
const expectedJson = `${JSON.stringify(expectedReport, null, 2)}\n`;

if (update) {
  await writeFile(UI_PROOF_REPORT_PATH, expectedJson);
  console.log('selective color private UI proof updated');
  process.exit(0);
}

const committedReport = uiProofReportSchema.parse(JSON.parse(await readFile(UI_PROOF_REPORT_PATH, 'utf8')));
if (JSON.stringify(committedReport) !== JSON.stringify(expectedReport)) {
  throw new Error(
    `Selective color private UI proof is stale. Run bun tests/integration/checks/check-selective-color-private-ui-proof.ts --update`,
  );
}

console.log(
  `selective color private UI proof ok (${expectedReport.rawRuntime.workflowArtifactCount} artifacts, ${expectedReport.visualReview.dimensions.width}x${expectedReport.visualReview.dimensions.height})`,
);
