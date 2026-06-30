#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';

import { z } from 'zod';

import { parseRawOpenEditExportRunReportCollection } from '../src/schemas/rawOpenEditExportRunReportSchemas.ts';
import { formatCommandForLog, readBoundedStream, writeBoundedOutput } from './compact-output.ts';

const FIXTURE_ID = 'validation.raw-open-edit-export.high-iso-skin-shadow.v1';
const SOURCE_RELATIVE_PATH = 'private-fixtures/detail/high-iso-skin-shadow-v1.arw';
const ARTIFACT_DIR_RELATIVE = 'private-artifacts/validation/open-edit-export';
const AGENT_REPORT_PATH = 'docs/validation/agent-real-raw-private-edit-proof-2026-06-22.json';
const AGENT_APP_SERVER_REPORT_PATH = 'docs/validation/agent-app-server-private-raw-artifacts-2026-06-20.json';
const SUMMARY_RELATIVE_PATH =
  'private-artifacts/validation/agent-real-raw-workflow/agent-real-raw-workflow-summary.json';
const RAW_EXTENSIONS = new Set(['.arw', '.cr2', '.cr3', '.dng', '.nef', '.orf', '.raf', '.rw2']);

const argsSchema = z
  .object({
    outputPath: z.string().trim().min(1).optional(),
    privateRoot: z.string().trim().min(1).optional(),
    requireAssets: z.boolean(),
    source: z.string().trim().min(1).optional(),
  })
  .strict();

const hashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const artifactSchema = z
  .object({
    hash: hashSchema,
    kind: z.string().trim().min(1),
    path: z.string().trim().min(1),
    publicRepoAllowed: z.literal(false),
  })
  .passthrough();
const summarySchema = z
  .object({
    agentAppServerReportHash: hashSchema,
    agentPrivateEditReportHash: hashSchema,
    agentReceipt: z.object({
      appliedGraphRevision: z.string().trim().min(1),
      outputHash: z.string().trim().min(1),
      prompt: z.string().trim().min(1),
      recipeKind: z.string().trim().min(1),
      selectedRawBasename: z.string().trim().min(1),
      sourceHashUnchanged: z.literal(true),
    }),
    artifactSummary: z.object({
      exportAfter: artifactSchema,
      previewAfter: artifactSchema,
      previewBefore: artifactSchema,
      sidecarAfter: artifactSchema,
      sourceRaw: artifactSchema,
    }),
    generatedAt: z.iso.datetime({ offset: true }),
    limits: z.array(z.string().trim().min(1)).min(3),
    rawRuntime: z.object({
      changedPixelRatio: z.number().gt(0),
      fixtureId: z.literal(FIXTURE_ID),
      previewExportMeanAbsDelta: z.number().min(0).max(0.015),
      reportId: z.string().trim().min(1),
      sourceHashUnchanged: z.literal(1),
    }),
    schemaVersion: z.literal(1),
    transcript: z.array(z.object({ role: z.enum(['assistant', 'system', 'tool', 'user']), text: z.string() })),
    validationMode: z.literal('agent_real_raw_private_workflow_proof'),
  })
  .strict();

interface RunOptions {
  command: Array<string>;
  cwd?: string;
  env?: Record<string, string>;
}

interface RunResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}

const args = argsSchema.parse({
  outputPath: valueAfter('--output'),
  privateRoot: valueAfter('--root') ?? process.env.RAWENGINE_PRIVATE_RAW_ROOT,
  requireAssets: process.argv.includes('--require-assets'),
  source: valueAfter('--source') ?? process.env.RAWENGINE_PRIVATE_RAW_SOURCE,
});

await runRequired('agent committed private RAW edit proof', ['bun', 'run', 'check:agent-real-raw-private-edit-proof']);
await runRequired('agent app-server private artifact schema proof', [
  'bun',
  'run',
  'check:agent-app-server-private-raw-artifacts',
]);

if (args.privateRoot === undefined) {
  if (args.requireAssets) {
    console.error('RAWENGINE_PRIVATE_RAW_ROOT or --root is required with --require-assets.');
    process.exit(1);
  }
  console.log('agent real RAW private workflow proof skipped (RAWENGINE_PRIVATE_RAW_ROOT unset)');
  process.exit(0);
}

const privateRoot = resolve(args.privateRoot);
const prepare = await runCommand({
  command: [
    'bun',
    'scripts/prepare-raw-open-edit-export-private-root.ts',
    '--root',
    privateRoot,
    ...(args.source === undefined ? [] : ['--source', args.source]),
    ...(args.requireAssets ? ['--require-assets'] : []),
  ],
});
if (prepare.exitCode !== 0) {
  if (args.source === undefined) {
    reportFailure('RAW open/edit/export private root prep', prepare, [
      'bun',
      'scripts/prepare-raw-open-edit-export-private-root.ts',
      '--root',
      privateRoot,
    ]);
  }

  await prepareFreshPrivateRawSource(privateRoot, args.source);
}
if (prepare.stdout.includes('private root skipped')) {
  if (args.requireAssets) {
    console.error('RAW open/edit/export private root unexpectedly skipped with --require-assets.');
    process.exit(1);
  }
  console.log('agent real RAW private workflow proof skipped (local RAW source unavailable)');
  process.exit(0);
}

let tempOutputDir: string | undefined;
const reportOutputPath =
  args.outputPath ??
  join(
    (tempOutputDir = await mkdtemp(join(tmpdir(), 'rawengine-agent-real-raw-private-report-'))),
    'raw-open-edit-export-run-reports.json',
  );

if (args.outputPath !== undefined) await mkdir(dirname(reportOutputPath), { recursive: true });

try {
  await runRequired(
    'RAW open/edit/export runtime proof',
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
        RAWENGINE_PRIVATE_RAW_ROOT: privateRoot,
        RAWENGINE_RUN_PRIVATE_RAW_OPEN_EDIT_EXPORT_PROOF: '1',
      },
    },
  );

  await runRequired('RAW open/edit/export private report collection', [
    'bun',
    'scripts/collect-raw-open-edit-export-private-run-reports.ts',
    '--root',
    privateRoot,
    '--require-root',
    '--output',
    reportOutputPath,
  ]);

  await runRequired(
    'RAW open/edit/export private report validation',
    [
      'bun',
      'tests/integration/checks/check-raw-open-edit-export-run-reports.ts',
      '--input',
      reportOutputPath,
      '--fixture-id',
      FIXTURE_ID,
      '--allow-fresh-hashes',
      '--require-assets',
    ],
    {
      env: {
        RAWENGINE_PRIVATE_RAW_ROOT: privateRoot,
      },
    },
  );

  const agentReportText = await readFile(AGENT_REPORT_PATH, 'utf8');
  const agentAppServerReportText = await readFile(AGENT_APP_SERVER_REPORT_PATH, 'utf8');
  const agentReport = z
    .object({
      appliedGraphRevision: z.string().trim().min(1),
      outputHash: z.string().trim().min(1),
      prompt: z.string().trim().min(1),
      recipeKind: z.string().trim().min(1),
      selectedRawBasename: z.string().trim().min(1),
      sourceHashUnchanged: z.literal(true),
    })
    .passthrough()
    .parse(JSON.parse(agentReportText));
  const rawReports = parseRawOpenEditExportRunReportCollection(JSON.parse(await readFile(reportOutputPath, 'utf8')));
  const rawReport = rawReports.reports.find((report) => report.fixtureId === FIXTURE_ID);
  if (rawReport === undefined) throw new Error(`${FIXTURE_ID}: missing collected private run report.`);
  const metrics = new Map(rawReport.metrics.map((metric) => [metric.name, metric.value]));

  const summary = summarySchema.parse({
    agentAppServerReportHash: hashText(agentAppServerReportText),
    agentPrivateEditReportHash: hashText(agentReportText),
    agentReceipt: agentReport,
    artifactSummary: {
      exportAfter: requiredArtifact(rawReport.artifacts, 'export_after_private'),
      previewAfter: requiredArtifact(rawReport.artifacts, 'preview_after_private'),
      previewBefore: requiredArtifact(rawReport.artifacts, 'preview_before_private'),
      sidecarAfter: requiredArtifact(rawReport.artifacts, 'sidecar_after_private'),
      sourceRaw: requiredArtifact(rawReport.artifacts, 'source_raw_private'),
    },
    generatedAt: new Date().toISOString(),
    limits: [
      'Runs the real RAW render/export lane locally and keeps private artifacts outside the public repo.',
      'Binds the runtime artifacts to the committed agent private-edit and app-server proof reports by content hash.',
      'Does not launch the desktop app or a live OpenAI model; UI and live-model proof remain separate validation lanes.',
    ],
    rawRuntime: {
      changedPixelRatio: requiredMetric(metrics, 'changedPixelRatio'),
      fixtureId: rawReport.fixtureId,
      previewExportMeanAbsDelta: requiredMetric(metrics, 'previewExportMeanAbsDelta'),
      reportId: rawReport.reportId,
      sourceHashUnchanged: requiredMetric(metrics, 'sourceHashUnchanged'),
    },
    schemaVersion: 1,
    transcript: [
      { role: 'user', text: agentReport.prompt },
      { role: 'assistant', text: `Planned ${agentReport.recipeKind} for ${agentReport.selectedRawBasename}.` },
      { role: 'tool', text: `Applied graph revision ${agentReport.appliedGraphRevision}.` },
      { role: 'tool', text: `Validated real RAW preview/export artifacts from ${rawReport.reportId}.` },
    ],
    validationMode: 'agent_real_raw_private_workflow_proof',
  });

  const summaryPath = resolve(privateRoot, SUMMARY_RELATIVE_PATH);
  await mkdir(dirname(summaryPath), { recursive: true });
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
} finally {
  if (tempOutputDir !== undefined) await rm(tempOutputDir, { force: true, recursive: true });
}

console.log(`agent real RAW private workflow proof ok (${SUMMARY_RELATIVE_PATH})`);

async function runRequired(
  label: string,
  command: Array<string>,
  options: Omit<RunOptions, 'command'> = {},
): Promise<void> {
  const result = await runCommand({ ...options, command });
  if (result.exitCode === 0) return;
  reportFailure(label, result, command);
}

async function runCommand(options: RunOptions): Promise<RunResult> {
  const proc = Bun.spawn(options.command, {
    cwd: options.cwd ?? process.cwd(),
    env: { ...process.env, ...options.env },
    stderr: 'pipe',
    stdout: 'pipe',
  });
  const stdout = readBoundedStream(proc.stdout);
  const stderr = readBoundedStream(proc.stderr);
  const exitCode = await proc.exited;

  return { exitCode, stderr: await stderr, stdout: await stdout };
}

function reportFailure(label: string, result: RunResult, command: Array<string>): never {
  console.error(`${label} failed`);
  console.error(`$ ${formatCommandForLog(command[0] ?? '', command.slice(1))}`);
  writeBoundedOutput('stdout', result.stdout);
  writeBoundedOutput('stderr', result.stderr);
  process.exit(result.exitCode);
}

function hashText(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function requiredArtifact(artifacts: ReadonlyArray<z.infer<typeof artifactSchema>>, kind: string) {
  const artifact = artifacts.find((candidate) => candidate.kind === kind);
  if (artifact === undefined) throw new Error(`missing private artifact ${kind}`);
  return artifact;
}

function requiredMetric(metrics: ReadonlyMap<string, number>, name: string): number {
  const value = metrics.get(name);
  if (value === undefined) throw new Error(`missing workflow metric ${name}`);
  return value;
}

async function prepareFreshPrivateRawSource(privateRoot: string, source: string): Promise<void> {
  const sourcePath = await resolveSourceRaw(source);
  const destinationPath = resolve(privateRoot, SOURCE_RELATIVE_PATH);
  await mkdir(dirname(destinationPath), { recursive: true });
  await copyFile(sourcePath, destinationPath);
  await mkdir(resolve(privateRoot, ARTIFACT_DIR_RELATIVE), { recursive: true });
}

async function resolveSourceRaw(source: string): Promise<string> {
  const sourcePath = resolve(source);
  const sourceStat = await stat(sourcePath);
  if (sourceStat.isFile()) return sourcePath;

  const names = (await readdir(sourcePath)).toSorted();
  const rawName = names.find((name) => RAW_EXTENSIONS.has(extname(name).toLowerCase()));
  if (rawName === undefined) throw new Error(`No RAW files found in ${sourcePath}.`);
  return resolve(sourcePath, rawName);
}

function valueAfter(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
