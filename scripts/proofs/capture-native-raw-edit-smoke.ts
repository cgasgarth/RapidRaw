#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { access, copyFile, mkdir, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';

import { z } from 'zod';

import { rawOpenEditExportRunReportSchema } from '../../src/schemas/rawOpenEditExportRunReportSchemas.ts';
import { formatCommandForLog, readBoundedStream, writeBoundedOutput } from '../lib/ci/compact-output.ts';

const DEFAULT_ALASKA_RAW_DIR = '/Users/cgas/Pictures/Capture One/Alaska';
const OUTPUT_ROOT = 'private-artifacts/validation/native-raw-edit-smoke';
const FIXTURE_ROOT = 'private-fixtures/native-raw-edit-smoke';
const QA_APP_PATH = 'src-tauri/target/debug/bundle/macos/RawEngine QA Current.app';
const RAW_EXTENSIONS = new Set(['.arw', '.cr2', '.cr3', '.dng', '.nef', '.orf', '.raf', '.rw2']);
const MAX_DISCOVERY_DEPTH = 2;
const MAX_HTML_JSON_CHARS = 16_000;

const argsSchema = z
  .object({
    alaskaRawDir: z.string().trim().min(1).optional(),
    keepFixtureCopy: z.boolean(),
    noBuildQa: z.boolean(),
    noLaunchQa: z.boolean(),
    outputDir: z.string().trim().min(1).optional(),
    requireFixtures: z.boolean(),
  })
  .strict();

const args = argsSchema.parse({
  alaskaRawDir: valueAfter('--raw-dir') ?? process.env.RAPIDRAW_ALASKA_RAW_DIR,
  keepFixtureCopy: process.argv.includes('--copy-fixture'),
  noBuildQa: process.argv.includes('--no-build-qa'),
  noLaunchQa: process.argv.includes('--no-launch-qa'),
  outputDir: valueAfter('--output-dir'),
  requireFixtures: process.argv.includes('--require-fixtures'),
});

const alaskaRawDir = resolve(args.alaskaRawDir ?? DEFAULT_ALASKA_RAW_DIR);
const sourceRawPath = await findFirstRaw(alaskaRawDir);

if (sourceRawPath === undefined) {
  const message = `native RAW edit smoke skipped (no Alaska RAW fixtures; checked ${alaskaRawDir})`;
  if (args.requireFixtures) {
    console.error(message);
    process.exit(1);
  }
  console.log(message);
  process.exit(0);
}

const runId = new Date().toISOString().replace(/[-:.]/gu, '').replace('T', '-').replace('Z', '');
const outputDirRelative = args.outputDir ?? `${OUTPUT_ROOT}/${runId}`;
const outputDir = resolve(outputDirRelative);
const selectedRawName = basename(sourceRawPath);
const selectedRawStem = selectedRawName.slice(0, selectedRawName.length - extname(selectedRawName).length);
const fixtureSlug = slugify(selectedRawStem);
const fixtureId = `validation.raw-open-edit-export.native-raw-edit-smoke-alaska-${fixtureSlug}.v1`;
const sourceRelativePath = `${FIXTURE_ROOT}/${fixtureSlug}${extname(sourceRawPath).toLowerCase()}`;
const linkedSourcePath = resolve(sourceRelativePath);
const requestPath = join(outputDir, 'native-raw-edit-smoke-request.json');
const reportPath = join(outputDir, 'native-raw-edit-smoke-report.json');
const htmlReportPath = join(outputDir, 'native-raw-edit-smoke-report.html');

await mkdir(outputDir, { recursive: true });
await mkdir(dirname(linkedSourcePath), { recursive: true });
await linkOrCopy(sourceRawPath, linkedSourcePath, args.keepFixtureCopy);

const request = buildProofRequest({
  artifactDirRelative: outputDirRelative,
  fixtureId,
  rawExtension: extname(sourceRawPath).slice(1).toLowerCase(),
  sourceRelativePath,
});
await writeFile(requestPath, `${JSON.stringify(request, null, 2)}\n`);

const qaCommand = [
  'bun',
  'scripts/dev/start-native-qa-app.ts',
  '--validation-harness',
  ...(args.noBuildQa ? ['--no-build'] : []),
  ...(args.noLaunchQa ? ['--no-launch'] : []),
];
await runRequired('native QA app path', qaCommand);

const proofCommand = [
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
];
await runRequired('native RAW edit runtime proof', proofCommand, {
  cwd: 'src-tauri',
  env: {
    RAWENGINE_PRIVATE_RAW_ROOT: process.cwd(),
    RAWENGINE_RAW_OPEN_EDIT_EXPORT_PROOF_REQUEST: requestPath,
    RAWENGINE_RUN_PRIVATE_RAW_OPEN_EDIT_EXPORT_PROOF: '1',
  },
});

const workflowReportPath = join(outputDir, `${slugFromFixtureId(fixtureId)}-workflow-report.json`);
const workflowReport = rawOpenEditExportRunReportSchema.parse(JSON.parse(await readFile(workflowReportPath, 'utf8')));
const outputMetadata = await readOutputMetadata(workflowReport.artifacts);
const sourceRawHash = await sha256File(linkedSourcePath);
const scenarioReport = {
  $schema: 'https://rawengine.dev/schemas/native-raw-edit-smoke-report-v1.json',
  app: {
    bundlePath: QA_APP_PATH,
    launchMode: args.noLaunchQa ? 'built_not_launched' : 'launched',
    validationHarness: true,
  },
  edit: {
    commandId: workflowReport.editCommandId,
    fixtureId: workflowReport.fixtureId,
    parameters: request.editCommand.parameters,
  },
  generatedAt: new Date().toISOString(),
  outputMetadata,
  privateArtifacts: {
    htmlReportPath: relative(process.cwd(), htmlReportPath),
    reportPath: relative(process.cwd(), reportPath),
    requestPath: relative(process.cwd(), requestPath),
    workflowReportPath: relative(process.cwd(), workflowReportPath),
  },
  screenshotRefs: workflowReport.artifacts
    .filter((artifact) => artifact.kind === 'preview_before_private' || artifact.kind === 'preview_after_private')
    .map((artifact) => ({ hash: artifact.hash, kind: artifact.kind, path: artifact.path })),
  sourceRaw: {
    discoveredFrom: alaskaRawDir,
    hash: sourceRawHash,
    linkedPath: sourceRelativePath,
    localName: selectedRawName,
    publicRepoAllowed: false,
  },
  status: 'passed',
  validationMode: 'native_qa_raw_edit_smoke',
  workflowReport,
};

await writeFile(reportPath, `${JSON.stringify(scenarioReport, null, 2)}\n`);
await writeFile(htmlReportPath, renderHtmlReport(scenarioReport));

console.log(
  `native RAW edit smoke ok (fixture=${selectedRawName}; report=${relative(process.cwd(), reportPath)}; html=${relative(
    process.cwd(),
    htmlReportPath,
  )})`,
);

interface RunOptions {
  cwd?: string;
  env?: Record<string, string>;
}

async function findFirstRaw(root: string): Promise<string | undefined> {
  if (!(await pathExists(root))) return undefined;

  const candidates: string[] = [];
  await collectRawCandidates(root, 0, candidates);
  return candidates.toSorted((left, right) => left.localeCompare(right))[0];
}

async function collectRawCandidates(root: string, depth: number, candidates: string[]): Promise<void> {
  if (depth > MAX_DISCOVERY_DEPTH) return;

  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      await collectRawCandidates(path, depth + 1, candidates);
      continue;
    }
    if (entry.isFile() && RAW_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      candidates.push(path);
    }
  }
}

async function linkOrCopy(sourcePath: string, targetPath: string, copyMode: boolean): Promise<void> {
  await rm(targetPath, { force: true });
  if (copyMode) {
    await copyFile(sourcePath, targetPath);
    return;
  }
  await symlink(sourcePath, targetPath);
}

function buildProofRequest({
  artifactDirRelative,
  fixtureId,
  rawExtension,
  sourceRelativePath,
}: {
  artifactDirRelative: string;
  fixtureId: string;
  rawExtension: string;
  sourceRelativePath: string;
}) {
  return {
    $schema: 'https://rawengine.dev/schemas/raw-open-edit-export-proof-request-v1.json',
    artifactDirRelative,
    editCommand: {
      actor: {
        id: 'native-qa.raw-edit-smoke',
        kind: 'validation',
        sessionId: 'native-raw-edit-smoke',
      },
      approval: {
        approvalClass: 'edit_apply',
        reason: 'Apply accepted exposure/color/effect edit through the native QA validation affordance.',
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
      commandId: 'command.native-raw-edit-smoke.exposure-color-effect.v1',
      commandType: 'toneColor.setBasicTone',
      correlationId: `corr.native-raw-edit-smoke.${fixtureSlug}.v1`,
      dryRun: false,
      expectedGraphRevision: `graph-rev.native-raw-edit-smoke.${fixtureSlug}.v1`,
      idempotencyKey: `idem.native-raw-edit-smoke.${fixtureSlug}.v1`,
      parameters: {
        acceptedDryRunPlanHash: 'sha256:native-raw-edit-smoke-accepted-plan-v1',
        acceptedDryRunPlanId: 'dryrun_native_raw_edit_smoke_v1',
        blackPoint: -1,
        clarity: 3,
        contrast: 6,
        exposureEv: 0.2,
        highlights: -8,
        saturation: 4,
        shadows: 5,
        whitePoint: 2,
      },
      schemaVersion: 1,
      target: {
        imagePath: sourceRelativePath,
        kind: 'image',
      },
    },
    fixtureId,
    privateRootPath: process.cwd(),
    sourceMetadata: {
      cameraMake: rawExtension === 'arw' ? 'Sony' : 'Unknown',
      cameraModel: rawExtension === 'arw' ? 'Alaska RAW fixture' : 'Native RAW edit smoke fixture',
      privacySafeCameraId: `camera.native-raw-edit-smoke.${fixtureSlug}.v1`,
      rawFormat: rawExtension,
    },
    sourceRelativePath,
  };
}

async function readOutputMetadata(artifacts: Array<{ kind: string; path: string }>) {
  return Promise.all(
    artifacts
      .filter((artifact) => artifact.kind !== 'source_raw_private')
      .map(async (artifact) => {
        const path = resolve(artifact.path);
        const fileStat = await stat(path);
        return {
          byteSize: fileStat.size,
          kind: artifact.kind,
          path: artifact.path,
        };
      }),
  );
}

async function runRequired(label: string, command: Array<string>, options: RunOptions = {}): Promise<void> {
  const proc = Bun.spawn(command, {
    cwd: options.cwd ?? process.cwd(),
    env: { ...process.env, ...options.env },
    stderr: 'pipe',
    stdout: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    readBoundedStream(proc.stdout),
    readBoundedStream(proc.stderr),
    proc.exited,
  ]);

  if (exitCode === 0) return;

  console.error(`${label} failed`);
  console.error(`$ ${formatCommandForLog(command[0] ?? '', command.slice(1))}`);
  writeBoundedOutput('stdout', stdout);
  writeBoundedOutput('stderr', stderr);
  process.exit(exitCode);
}

async function sha256File(path: string): Promise<string> {
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

function renderHtmlReport(report: Record<string, unknown>): string {
  const json = escapeHtml(JSON.stringify(report, null, 2).slice(0, MAX_HTML_JSON_CHARS));
  const screenshotRefs = z
    .array(z.object({ hash: z.string(), kind: z.string(), path: z.string() }))
    .parse(report.screenshotRefs);
  const screenshotList = screenshotRefs
    .map(
      (ref) =>
        `<li><strong>${escapeHtml(ref.kind)}</strong>: <code>${escapeHtml(ref.path)}</code><br><small>${escapeHtml(
          ref.hash,
        )}</small></li>`,
    )
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Native RAW Edit Smoke</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 24px; color: #18202a; }
    code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    pre { background: #f4f6f8; border: 1px solid #d8dee6; padding: 12px; overflow: auto; }
  </style>
</head>
<body>
  <h1>Native RAW Edit Smoke</h1>
  <p>Status: <strong>${escapeHtml(String(report.status))}</strong></p>
  <h2>Screenshot refs</h2>
  <ul>${screenshotList}</ul>
  <h2>Report JSON</h2>
  <pre>${json}</pre>
</body>
</html>
`;
}

function slugFromFixtureId(fixtureId: string): string {
  return fixtureId.replace(/^validation\.raw-open-edit-export\./u, '').replaceAll('.', '-');
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, '-')
      .replace(/^-|-$/gu, '') || 'raw'
  );
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function valueAfter(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
