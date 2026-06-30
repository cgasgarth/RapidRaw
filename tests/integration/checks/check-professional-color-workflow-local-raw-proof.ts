#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { access, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { z } from 'zod';

import { rawOpenEditExportProofRequestSchema } from '../../../src/schemas/rawOpenEditExportCommandSchemas.ts';

const REPORT_PATH = 'docs/validation/proofs/color-selective/professional-color-workflow-cc-raw-proof-2026-06-20.json';
const REQUEST_PATH = 'fixtures/validation/professional-color-workflow/professional-color-workflow-proof-request.json';
const UPDATE_REPORT = process.argv.includes('--update');
const requireAssets = process.argv.includes('--require-assets');
const privateRoot = process.env.RAWENGINE_PRIVATE_RAW_ROOT;
const request = rawOpenEditExportProofRequestSchema.parse(JSON.parse(await readFile(REQUEST_PATH, 'utf8')));
const WORKFLOW_REPORT_PATH = `${request.artifactDirRelative}/professional-color-v1-workflow-report.json`;
const VISUAL_SMOKE_SCREENSHOT_PATH = 'artifacts/visual-smoke/color-workflow.png';
const PRIVATE_ROOT = '/tmp/rawengine-professional-color-alaska-proof';
const PRIVATE_SOURCE = '/Users/cgas/Pictures/Capture One/Alaska';
const PROFESSIONAL_RUNTIME_COMMAND =
  'RAWENGINE_RUN_PRIVATE_RAW_PROFESSIONAL_COLOR_PROOF=1 RAWENGINE_PRIVATE_RAW_ROOT=/tmp/rawengine-private-root cargo +1.95.0 test --manifest-path src-tauri/Cargo.toml --locked --no-default-features --features required-ci,validation-harness,tauri-test raw_open_edit_export_proof::tests::private_runtime_smoke_generates_professional_color_report_when_enabled -- --nocapture';
const PROFESSIONAL_SOURCE_FOLDER_PROOF_COMMAND = `RAWENGINE_PRIVATE_RAW_ROOT=${PRIVATE_ROOT} RAWENGINE_PRIVATE_RAW_SOURCE="${PRIVATE_SOURCE}" bun run check:professional-color-workflow-private-proof -- --require-assets`;
const PROFESSIONAL_ASSET_PROOF_COMMAND = `RAWENGINE_PRIVATE_RAW_ROOT=${PRIVATE_ROOT} bun run check:professional-color-workflow-local-raw-proof -- --require-assets`;

const hashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const artifactSchema = z
  .object({
    hash: hashSchema,
    kind: z.enum([
      'source_raw_private',
      'preview_before_private',
      'preview_after_private',
      'export_after_private',
      'soft_proof_after_private',
      'sidecar_after_private',
      'visual_smoke_screenshot',
    ]),
    path: z.string().trim().min(1),
    publicRepoAllowed: z.literal(false),
  })
  .strict();

const metricSchema = z
  .object({
    changedPixelRatio: z.number().gt(0),
    previewExportMeanAbsDelta: z.number().min(0).max(0.015),
    softProofExportRgb8MeanAbsDelta: z.literal(0),
    sourceHashUnchanged: z.literal(1),
  })
  .strict();

const renderPathsSchema = z
  .object({
    exportAfterFormat: z.literal('tiff'),
    exportAfterWriterId: z.string().trim().min(1),
    previewAfterFormat: z.literal('png'),
    previewAfterWriterId: z.string().trim().min(1),
    previewBeforeWriterId: z.string().trim().min(1),
    softProofAfterFormat: z.literal('png'),
    softProofAfterWriterId: z.string().trim().min(1),
  })
  .strict();

const reportSchema = z
  .object({
    colorManagement: z
      .object({
        inputDomain: z.literal('camera_linear_rgb'),
        operationDomain: z.literal('acescg_linear_v1'),
        outputProfile: z.literal('display_p3'),
        proofLevel: z.literal('private_raw_runtime_color_management_metadata'),
        sceneToDisplayTransform: z.literal('rawengine_agx_v1'),
        viewTransform: z.literal('rawengine_agx_v1'),
        workingSpace: z.literal('acescg_linear_v1'),
      })
      .strict(),
    doesNotProve: z
      .array(
        z.enum([
          'camera_profile_quality',
          'capture_one_class_quality',
          'display_device_visual_match',
          'full_macos_app_manual_session',
          'gpu_color_parity',
          'icc_colorimetric_accuracy',
        ]),
      )
      .min(6),
    fixtureId: z.literal('validation.color.professional-workflow.local-cc-raw.v1'),
    generatedAt: z.iso.datetime({ offset: true }),
    e2eIssue: z.literal(2309),
    issue: z.literal(2309),
    proofBoundary: z.literal('private_raw_runtime_plus_visual_smoke_not_full_macos_manual_e2e'),
    proofStatus: z.literal('private_raw_professional_color_runtime_with_visual_smoke'),
    localRawRuntime: z
      .object({
        artifactRoot: z.literal(request.artifactDirRelative),
        command: z.literal(PROFESSIONAL_RUNTIME_COMMAND),
        editCommandId: z.literal(request.editCommand.commandId),
        metrics: metricSchema,
        rawRuntimeFixtureId: z.literal(request.fixtureId),
        renderPaths: renderPathsSchema,
        status: z.literal('passed'),
        workflowReportPath: z.literal(WORKFLOW_REPORT_PATH),
      })
      .strict(),
    schemaVersion: z.literal(1),
    sourceRaw: z
      .object({
        licenseEvidence: z.literal(
          'User explicitly provided /Users/cgas/Pictures/Capture One/Alaska as project-owned RAW validation input for this repo.',
        ),
        licenseSummary: z.literal('Project-owned local RAW sample for software development validation.'),
        localPath: z.literal(request.sourceRelativePath),
        sha256: hashSchema,
        sourceFolder: z.literal(PRIVATE_SOURCE),
      })
      .strict(),
    validationCommands: z
      .array(z.enum([PROFESSIONAL_SOURCE_FOLDER_PROOF_COMMAND, PROFESSIONAL_ASSET_PROOF_COMMAND]))
      .length(2),
    validationMode: z.literal('local_cc_raw_runtime_plus_visual_smoke'),
    workflowArtifacts: z.array(artifactSchema).length(7),
  })
  .strict()
  .superRefine((report, context) => {
    const artifactKinds = report.workflowArtifacts.map((artifact) => artifact.kind);
    if (new Set(artifactKinds).size !== artifactKinds.length) {
      context.addIssue({ code: 'custom', message: 'workflow artifact kinds must be unique' });
    }

    if (!report.doesNotProve.includes('full_macos_app_manual_session')) {
      context.addIssue({
        code: 'custom',
        message: 'report must explicitly avoid claiming a full manual macOS app session',
        path: ['doesNotProve'],
      });
    }
  });

const workflowMetricSchema = z
  .object({
    name: z.enum([
      'changedPixelRatio',
      'previewExportMeanAbsDelta',
      'softProofExportRgb8MeanAbsDelta',
      'sidecarReloadRevisionMatch',
      'sourceHashUnchanged',
    ]),
    value: z.number(),
  })
  .passthrough();

const workflowReportSchema = z
  .object({
    artifacts: z
      .array(
        artifactSchema
          .omit({ kind: true })
          .extend({ kind: artifactSchema.shape.kind.exclude(['visual_smoke_screenshot']) }),
      )
      .length(6),
    fixtureId: z.literal(request.fixtureId),
    metrics: z.array(workflowMetricSchema).length(5),
    renderPaths: renderPathsSchema,
    sourceRaw: z.object({ hash: hashSchema, path: z.string(), publicRepoAllowed: z.literal(false) }).strict(),
  })
  .passthrough();

const failures: string[] = [];

if ((UPDATE_REPORT || requireAssets) && privateRoot === undefined) {
  failures.push('RAWENGINE_PRIVATE_RAW_ROOT is required with --require-assets.');
}

let report: z.infer<typeof reportSchema>;
if (UPDATE_REPORT) {
  const workflowReport = await readWorkflowReport();
  const visualSmokeScreenshot = await visualSmokeArtifact();
  report = reportSchema.parse({
    colorManagement: {
      inputDomain: 'camera_linear_rgb',
      operationDomain: 'acescg_linear_v1',
      outputProfile: 'display_p3',
      proofLevel: 'private_raw_runtime_color_management_metadata',
      sceneToDisplayTransform: 'rawengine_agx_v1',
      viewTransform: 'rawengine_agx_v1',
      workingSpace: 'acescg_linear_v1',
    },
    doesNotProve: [
      'camera_profile_quality',
      'capture_one_class_quality',
      'display_device_visual_match',
      'full_macos_app_manual_session',
      'gpu_color_parity',
      'icc_colorimetric_accuracy',
    ],
    fixtureId: 'validation.color.professional-workflow.local-cc-raw.v1',
    generatedAt: new Date().toISOString(),
    e2eIssue: 2309,
    issue: 2309,
    proofBoundary: 'private_raw_runtime_plus_visual_smoke_not_full_macos_manual_e2e',
    proofStatus: 'private_raw_professional_color_runtime_with_visual_smoke',
    localRawRuntime: {
      artifactRoot: request.artifactDirRelative,
      command: PROFESSIONAL_RUNTIME_COMMAND,
      editCommandId: request.editCommand.commandId,
      metrics: metricMap(workflowReport.metrics),
      rawRuntimeFixtureId: workflowReport.fixtureId,
      renderPaths: workflowReport.renderPaths,
      status: 'passed',
      workflowReportPath: WORKFLOW_REPORT_PATH,
    },
    schemaVersion: 1,
    sourceRaw: {
      licenseEvidence:
        'User explicitly provided /Users/cgas/Pictures/Capture One/Alaska as project-owned RAW validation input for this repo.',
      licenseSummary: 'Project-owned local RAW sample for software development validation.',
      localPath: workflowReport.sourceRaw.path,
      sha256: workflowReport.sourceRaw.hash,
      sourceFolder: PRIVATE_SOURCE,
    },
    validationCommands: [PROFESSIONAL_SOURCE_FOLDER_PROOF_COMMAND, PROFESSIONAL_ASSET_PROOF_COMMAND],
    validationMode: 'local_cc_raw_runtime_plus_visual_smoke',
    workflowArtifacts: [...workflowReport.artifacts, visualSmokeScreenshot],
  });
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
} else {
  report = reportSchema.parse(JSON.parse(await readFile(REPORT_PATH, 'utf8')));
}

if (requireAssets && privateRoot !== undefined) {
  const workflowReport = await readWorkflowReport();
  if (workflowReport.fixtureId !== report.localRawRuntime.rawRuntimeFixtureId) {
    failures.push('workflow report fixture ID must match local raw runtime fixture ID.');
  }

  for (const artifact of report.workflowArtifacts) {
    const absolutePath =
      artifact.kind === 'visual_smoke_screenshot' ? resolve(artifact.path) : resolve(privateRoot, artifact.path);
    try {
      await access(absolutePath);
    } catch {
      failures.push(`${artifact.kind}: missing artifact ${artifact.path}`);
      continue;
    }
    const actualHash = createHash('sha256')
      .update(await readFile(absolutePath))
      .digest('hex');
    if (`sha256:${actualHash}` !== artifact.hash) {
      failures.push(`${artifact.kind}: hash mismatch for ${artifact.path}`);
    }
  }
}

if (failures.length > 0) {
  console.error('professional color workflow local RAW proof failed.');
  console.error(failures.join('\n'));
  process.exit(1);
}

const mode = requireAssets ? 'assets verified' : 'schema verified';
console.log(`professional color workflow local RAW proof ok (${mode})`);

async function readWorkflowReport(): Promise<z.infer<typeof workflowReportSchema>> {
  if (privateRoot === undefined) throw new Error('RAWENGINE_PRIVATE_RAW_ROOT is required.');
  return workflowReportSchema.parse(JSON.parse(await readFile(resolve(privateRoot, WORKFLOW_REPORT_PATH), 'utf8')));
}

async function visualSmokeArtifact(): Promise<z.infer<typeof artifactSchema>> {
  return artifactSchema.parse({
    hash: hashBuffer(await readFile(VISUAL_SMOKE_SCREENSHOT_PATH)),
    kind: 'visual_smoke_screenshot',
    path: VISUAL_SMOKE_SCREENSHOT_PATH,
    publicRepoAllowed: false,
  });
}

function metricMap(metrics: ReadonlyArray<z.infer<typeof workflowMetricSchema>>): z.infer<typeof metricSchema> {
  const byName = new Map(metrics.map((metric) => [metric.name, metric.value]));
  return {
    changedPixelRatio: requiredMetric(byName, 'changedPixelRatio'),
    previewExportMeanAbsDelta: requiredMetric(byName, 'previewExportMeanAbsDelta'),
    softProofExportRgb8MeanAbsDelta: requiredMetric(byName, 'softProofExportRgb8MeanAbsDelta'),
    sourceHashUnchanged: requiredMetric(byName, 'sourceHashUnchanged'),
  };
}

function requiredMetric(metrics: ReadonlyMap<string, number>, name: string): number {
  const value = metrics.get(name);
  if (value === undefined) throw new Error(`missing workflow metric ${name}`);
  return value;
}

function hashBuffer(value: Buffer): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
