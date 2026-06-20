#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { z } from 'zod';

const REPORT_PATH = 'docs/validation/professional-color-workflow-cc-raw-proof-2026-06-20.json';
const requireAssets = process.argv.includes('--require-assets');
const privateRoot = process.env.RAWENGINE_PRIVATE_RAW_ROOT;

const hashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const artifactSchema = z
  .object({
    hash: hashSchema,
    kind: z.enum([
      'source_raw_private',
      'preview_before_private',
      'preview_after_private',
      'export_after_private',
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
    sourceHashUnchanged: z.literal(1),
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
    issue: z.literal(2309),
    localRawRuntime: z
      .object({
        artifactRoot: z.literal('private-artifacts/validation/open-edit-export'),
        command: z.literal(
          'RAWENGINE_RUN_PRIVATE_RAW_OPEN_EDIT_EXPORT_PROOF=1 RAWENGINE_PRIVATE_RAW_ROOT=/tmp/rawengine-private-root cargo +1.95.0 test --manifest-path src-tauri/Cargo.toml --locked --no-default-features --features required-ci,validation-harness,tauri-test raw_open_edit_export_proof::tests::private_runtime_smoke_generates_raw_open_edit_export_report_when_enabled -- --nocapture',
        ),
        editCommandId: z.literal('command.raw-open-edit-export.basic-tone.v1'),
        metrics: metricSchema,
        rawRuntimeFixtureId: z.literal('validation.raw-open-edit-export.high-iso-skin-shadow.v1'),
        status: z.literal('passed'),
        workflowReportPath: z.literal(
          'private-artifacts/validation/open-edit-export/high-iso-skin-shadow-v1-workflow-report.json',
        ),
      })
      .strict(),
    schemaVersion: z.literal(1),
    sourceRaw: z
      .object({
        downloadedFrom: z.literal('https://www.rawsamples.ch/index.php/en/sony'),
        licenseEvidence: z.literal('https://www.rawsamples.ch/index.php/en/legal-stuff'),
        licenseSummary: z.literal('Creative Commons RAW sample for software development validation.'),
        localPath: z.literal('private-fixtures/detail/high-iso-skin-shadow-v1.arw'),
        sha256: hashSchema,
      })
      .strict(),
    validationMode: z.literal('local_cc_raw_runtime_plus_visual_smoke'),
    workflowArtifacts: z.array(artifactSchema).length(6),
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

const report = reportSchema.parse(JSON.parse(await readFile(REPORT_PATH, 'utf8')));
const failures: string[] = [];

if (requireAssets && privateRoot === undefined) {
  failures.push('RAWENGINE_PRIVATE_RAW_ROOT is required with --require-assets.');
}

if (requireAssets && privateRoot !== undefined) {
  const workflowReport = JSON.parse(
    await readFile(resolve(privateRoot, report.localRawRuntime.workflowReportPath), 'utf8'),
  );
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
