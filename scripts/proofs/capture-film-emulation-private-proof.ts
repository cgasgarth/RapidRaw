#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';

import { z } from 'zod';

import { rawOpenEditExportProofRequestSchema } from '../../src/schemas/rawOpenEditExportCommandSchemas.ts';
import { rawOpenEditExportRunReportSchema } from '../../src/schemas/rawOpenEditExportRunReportSchemas.ts';
import { readBoundedStream, writeBoundedOutput } from '../lib/ci/compact-output.ts';

const sourceRoot = resolve(process.env.RAWENGINE_PRIVATE_RAW_SOURCE ?? '/Users/cgas/Pictures/Capture One/Alaska');
const proofRoot = resolve(
  process.env.RAWENGINE_FILM_PRIVATE_PROOF_ROOT ?? '/tmp/rawengine-film-emulation-private-proof',
);
const requireAssets = Bun.argv.includes('--require-assets');
const sourcePath = await findFirstRaw(sourceRoot);

if (sourcePath === undefined) {
  const message = `Film private RAW proof skipped (no RAW under ${sourceRoot})`;
  if (requireAssets) throw new Error(message);
  console.log(message);
  process.exit(0);
}

const sourceHashBefore = await sha256File(sourcePath);
const sourceName = basename(sourcePath);
const slug = slugify(sourceName.slice(0, -extname(sourceName).length));
const runId = new Date().toISOString().replace(/[-:.TZ]/gu, '');
const artifactDirRelative = `private-artifacts/film-runtime/${runId}`;
const fixtureId = `validation.raw-open-edit-export.film-reference-${slug}.v1`;
const requestPath = join(proofRoot, 'film-runtime-proof-request.json');
const request = rawOpenEditExportProofRequestSchema.parse({
  artifactDirRelative,
  editCommand: {
    actor: { id: 'film-runtime-private-proof', kind: 'agent' },
    approval: {
      approvalClass: 'edit_apply',
      reason: 'Apply accepted canonical Film operation through production RAW preview and export rendering.',
      state: 'approved',
    },
    colorPipeline: {
      chromaticAdaptation: {
        method: 'bradford_v1',
        sourceWhitePoint: { x: 0.3457, y: 0.3585 },
        status: 'math_validated',
        targetWhitePoint: { x: 0.32168, y: 0.33767 },
        warnings: [],
      },
      inputDomain: 'camera_linear_rgb',
      operationDomain: 'acescg_linear_v1',
      renderTarget: {
        bitDepth: 16,
        embedIcc: true,
        intent: 'relative_colorimetric',
        outputProfile: 'display_p3',
        viewTransform: 'rawengine_agx_v1',
      },
      sceneToDisplayTransform: 'rawengine_agx_v1',
      workingSpace: 'acescg_linear_v1',
    },
    commandId: `command.film-runtime-private-proof.${slug}.v1`,
    commandType: 'edit.apply_film_emulation_operation',
    correlationId: `corr.film-runtime-private-proof.${slug}.v1`,
    dryRun: false,
    expectedGraphRevision: `graph-rev.film-runtime-private-proof.${slug}.v1`,
    idempotencyKey: `idem.film-runtime-private-proof.${slug}.v1`,
    parameters: {
      acceptedDryRunPlanHash: 'sha256:film-runtime-private-proof-accepted-plan-v1',
      acceptedDryRunPlanId: 'dryrun_film_runtime_private_proof_v1',
      operation: { kind: 'set_mix', mix: 0.7 },
    },
    schemaVersion: 1,
    target: { kind: 'image', variantId: `film-runtime-${slug}` },
  },
  fixtureId,
  privateRootPath: proofRoot,
  sourceMetadata: {
    cameraMake: extname(sourceName).toLowerCase() === '.arw' ? 'Sony' : 'Unknown',
    cameraModel: 'private RAW runtime fixture',
    privacySafeCameraId: `camera.film-runtime.${slug}.v1`,
    rawFormat: extname(sourceName).slice(1).toLowerCase(),
  },
  sourceRelativePath: basename(sourcePath),
  sourceRootPath: dirname(sourcePath),
});

await mkdir(proofRoot, { recursive: true });
await writeFile(requestPath, `${JSON.stringify(request, null, 2)}\n`);
await runNativeProof(requestPath);

const workflowReportPath = join(proofRoot, artifactDirRelative, `${slugFromFixtureId(fixtureId)}-workflow-report.json`);
const nativeReport = z.record(z.string(), z.unknown()).parse(JSON.parse(await readFile(workflowReportPath, 'utf8')));
const graphTrace = z
  .object({
    exportGraphFingerprint: z.string().trim().min(1),
    previewGraphFingerprint: z.string().trim().min(1),
    validationStatus: z.literal('passed'),
  })
  .passthrough()
  .parse(nativeReport.graphTrace);
const publicFinalFile = { ...z.record(z.string(), z.unknown()).parse(nativeReport.finalFile) };
delete publicFinalFile.committedSamplePixels;
const publicReport = { ...nativeReport };
delete publicReport.graphTrace;
const report = rawOpenEditExportRunReportSchema.parse({ ...publicReport, finalFile: publicFinalFile });
const changedPixels = metric(report, 'changedPixelRatio');
const previewExportDelta = metric(report, 'previewExportMeanAbsDelta');
const sourceUnchanged = metric(report, 'sourceHashUnchanged');
if (!changedPixels.passed || changedPixels.value <= 0)
  throw new Error('Film operation did not change rendered pixels.');
if (!previewExportDelta.passed) throw new Error('Film preview/export parity exceeded its production threshold.');
if (!sourceUnchanged.passed || (await sha256File(sourcePath)) !== sourceHashBefore)
  throw new Error('Private RAW source changed during Film proof.');
if (report.finalFile.bitDepth !== 16 || report.finalFile.embeddedIccProfileHash.length === 0)
  throw new Error('Film proof export did not reopen as ICC-tagged RGB16 TIFF.');
if (graphTrace.previewGraphFingerprint !== graphTrace.exportGraphFingerprint)
  throw new Error('Film preview and export render graph fingerprints diverged.');

const summaryPath = join(proofRoot, 'film-runtime-proof-summary.json');
const summary = {
  backend: report.colorManagement.runtimeEnvironment.wgpuBackend,
  commandId: report.editCommandId,
  filmProfileRef: {
    contentSha256: 'sha256:d84121641d1318f3be759fb5705f04f01721cd35a57e1b238343590bc2b988ef',
    id: 'rapidraw.reference_film.v1',
    version: '1',
  },
  limitationCodes: ['post_film_pre_view_scene_tap_unavailable'],
  metrics: { changedPixelRatio: changedPixels.value, previewExportMeanAbsDelta: previewExportDelta.value },
  proofLevel: 'native_private_raw_preview_export',
  sourceContentSha256: sourceHashBefore,
  status: 'passed_partial_receipt',
  workflowReportPath,
};
await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(`Film private RAW proof passed (changed=${changedPixels.value}; parity=${previewExportDelta.value})`);

async function runNativeProof(requestPathValue: string): Promise<void> {
  const child = Bun.spawn(
    [
      'cargo',
      '+1.95.0',
      'test',
      '--locked',
      '--no-default-features',
      '--features',
      'required-ci,validation-harness,tauri-test',
      'raw_open_edit_export_proof::tests::private_runtime_smoke_generates_raw_open_edit_export_report_when_enabled',
      '--',
      '--nocapture',
    ],
    {
      cwd: 'src-tauri',
      env: {
        ...Bun.env,
        RAWENGINE_RAW_OPEN_EDIT_EXPORT_PROOF_REQUEST: requestPathValue,
        RAWENGINE_RUN_PRIVATE_RAW_OPEN_EDIT_EXPORT_PROOF: '1',
      },
      stderr: 'pipe',
      stdout: 'pipe',
    },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    readBoundedStream(child.stdout),
    readBoundedStream(child.stderr),
    child.exited,
  ]);
  if (exitCode === 0) return;
  writeBoundedOutput('native Film proof stdout', stdout);
  writeBoundedOutput('native Film proof stderr', stderr);
  process.exit(exitCode);
}

async function findFirstRaw(root: string): Promise<string | undefined> {
  if (!(await pathExists(root))) return undefined;
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries.toSorted((left, right) => left.name.localeCompare(right.name))) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      const nested = await findFirstRaw(path);
      if (nested !== undefined) return nested;
    } else if (/\.(?:arw|cr2|cr3|dng|nef|orf|raf|rw2|sr2|srf)$/iu.test(entry.name)) {
      return path;
    }
  }
  return undefined;
}

function metric(report: typeof rawOpenEditExportRunReportSchema._output, name: string) {
  const result = report.metrics.find((candidate) => candidate.name === name);
  if (result === undefined) throw new Error(`Native Film proof report is missing ${name}.`);
  return result;
}

async function sha256File(path: string): Promise<`sha256:${string}`> {
  return `sha256:${createHash('sha256')
    .update(await readFile(path))
    .digest('hex')}`;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function slugFromFixtureId(value: string): string {
  return value.replace(/^validation\.raw-open-edit-export\./u, '').replaceAll('.', '-');
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, '-')
      .replace(/^-|-$/gu, '') || 'raw'
  );
}
