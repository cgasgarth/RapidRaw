#!/usr/bin/env bun

import { mkdir, readdir, readFile, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

import { z } from 'zod';

import { rawDevelopmentReportSchema } from '../../../src/schemas/imageLoaderSchemas.ts';
import { buildCameraProfileProvenanceReceipt } from '../../../src/utils/cameraProfileProvenanceReceipt.ts';
import { calculateDeltaE00, labColorSchema } from '../../../src/utils/deltaE00.ts';
import { formatCommandForLog, readBoundedStream, writeBoundedOutput } from '../../../scripts/compact-output.ts';

const FIXTURE_PATH = 'fixtures/color/dual-illuminant-profile-proof-fixture.json';
const DEFAULT_REPORT_DIR = 'src-tauri/target/dual-illuminant-profile-proof';
const RAW_EXTENSIONS = new Set(['.arw', '.cr2', '.cr3', '.dng', '.nef', '.orf', '.raf', '.rw2']);

const patchRoleSchema = z.enum(['memory_color', 'neutral']);
const fixtureSchema = z
  .object({
    $schema: z.url(),
    issue: z.literal(3244),
    patches: z
      .array(
        z
          .object({
            id: z.string().trim().min(1),
            measuredLab: labColorSchema,
            referenceLab: labColorSchema,
            role: patchRoleSchema,
          })
          .strict(),
      )
      .min(1),
    proofBoundary: z.literal('public_dual_illuminant_profile_receipt_and_metric_math'),
    rawDevelopmentReport: rawDevelopmentReportSchema,
    schemaVersion: z.literal(1),
    snapshotDate: z.iso.date(),
    thresholds: z
      .object({
        deltaE00MaxMax: z.number().positive(),
        deltaE00MeanMax: z.number().positive(),
        neutralChromaMax: z.number().nonnegative(),
      })
      .strict(),
  })
  .strict();

const rustProofReportSchema = z
  .object({
    colorimetricProof: z.literal(false),
    dimensions: z.object({ height: z.number().int().positive(), width: z.number().int().positive() }).strict(),
    elapsedMs: z.number().nonnegative(),
    issue: z.literal(3244),
    output: z
      .object({
        imageHash: z.string().regex(/^blake3:[0-9a-f]+$/u),
        tiffPath: z.string().trim().min(1),
      })
      .strict(),
    privateAssetsCommitted: z.literal(false),
    proofBoundary: z.literal('private_dual_illuminant_profile_runtime_report'),
    proofLevel: z.literal('private_raw_smoke_not_colorchecker_accuracy'),
    rawDevelopmentReport: rawDevelopmentReportSchema,
    sourcePath: z.string().trim().min(1),
  })
  .strict();

interface RunResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}

const privateRoot = valueAfter('--root') ?? process.env.RAWENGINE_PRIVATE_RAW_ROOT;
const privateSource = valueAfter('--source') ?? process.env.RAWENGINE_PRIVATE_RAW_SOURCE;
const reportDir =
  valueAfter('--report-dir') ?? process.env.RAWENGINE_DUAL_ILLUMINANT_PROFILE_REPORT_DIR ?? DEFAULT_REPORT_DIR;
const reportDirPath = resolve(reportDir);
const requireAssets = process.argv.includes('--require-assets');
const allowSmokeOnly = process.argv.includes('--allow-smoke-only');

await runPublicProof();

const sourcePath = await resolveOptionalRawSource(privateSource ?? privateRoot);
if (sourcePath === undefined) {
  if (requireAssets) {
    console.error('RAWENGINE_PRIVATE_RAW_ROOT, RAWENGINE_PRIVATE_RAW_SOURCE, --root, or --source is required.');
    process.exit(1);
  }
  console.log('dual-illuminant profile proof ok (public fixture; private RAW skipped)');
  process.exit(0);
}

if (!allowSmokeOnly && !requireAssets) {
  console.error('Use --allow-smoke-only or --require-assets when running the private RAW proof.');
  process.exit(1);
}

await mkdir(reportDirPath, { recursive: true });
await runRequired(
  'dual-illuminant private RAW Rust proof',
  [
    'cargo',
    '+1.95.0',
    'test',
    '--manifest-path',
    'src-tauri/Cargo.toml',
    '--locked',
    '--no-default-features',
    '--features',
    'required-ci,tauri-test',
    'private_dual_illuminant_profile_runtime_proof_when_enabled',
    '--',
    '--nocapture',
  ],
  {
    RAWENGINE_DUAL_ILLUMINANT_PROFILE_REPORT_DIR: reportDirPath,
    RAWENGINE_PRIVATE_RAW_SOURCE: sourcePath,
    RAWENGINE_RUN_PRIVATE_DUAL_ILLUMINANT_PROFILE_PROOF: '1',
  },
);

const privateReportPath = join(reportDirPath, 'dual-illuminant-profile-private-proof.json');
const privateReport = rustProofReportSchema.parse(JSON.parse(await readFile(privateReportPath, 'utf8')));
const privateReceipt = buildCameraProfileProvenanceReceipt(privateReport.rawDevelopmentReport);
if (privateReceipt.algorithmId !== 'dual_illuminant_mired_v1') {
  console.error(`unexpected private proof algorithm: ${privateReceipt.algorithmId}`);
  process.exit(1);
}

console.log(
  `dual-illuminant profile proof ok (private smoke ${privateReport.dimensions.width}x${privateReport.dimensions.height})`,
);

async function runPublicProof(): Promise<void> {
  const fixture = fixtureSchema.parse(JSON.parse(await readFile(FIXTURE_PATH, 'utf8')));
  const receipt = buildCameraProfileProvenanceReceipt(fixture.rawDevelopmentReport);
  const patchMetrics = fixture.patches.map((patch) => ({
    deltaE00: calculateDeltaE00(patch.referenceLab, patch.measuredLab),
    id: patch.id,
    neutralChroma: patch.role === 'neutral' ? Math.hypot(patch.measuredLab.a, patch.measuredLab.b) : null,
    role: patch.role,
  }));
  const deltaValues = patchMetrics.map((patch) => patch.deltaE00);
  const meanDeltaE00 = mean(deltaValues);
  const maxDeltaE00 = Math.max(...deltaValues);
  const maxNeutralChroma = Math.max(
    0,
    ...patchMetrics.map((patch) => patch.neutralChroma).filter((value): value is number => value !== null),
  );

  const failures = [
    receipt.status === 'interpolated' ? null : `expected interpolated receipt, got ${receipt.status}`,
    receipt.matrixHash === null ? 'expected matrix hash in receipt' : null,
    meanDeltaE00 <= fixture.thresholds.deltaE00MeanMax
      ? null
      : `mean DeltaE00 ${round(meanDeltaE00)} exceeds ${fixture.thresholds.deltaE00MeanMax}`,
    maxDeltaE00 <= fixture.thresholds.deltaE00MaxMax
      ? null
      : `max DeltaE00 ${round(maxDeltaE00)} exceeds ${fixture.thresholds.deltaE00MaxMax}`,
    maxNeutralChroma <= fixture.thresholds.neutralChromaMax
      ? null
      : `neutral chroma ${round(maxNeutralChroma)} exceeds ${fixture.thresholds.neutralChromaMax}`,
  ].filter((failure): failure is string => failure !== null);

  if (failures.length > 0) {
    console.error(`dual-illuminant public proof failed: ${failures.join('; ')}`);
    process.exit(1);
  }
}

async function resolveOptionalRawSource(source: string | undefined): Promise<string | undefined> {
  if (source === undefined) return undefined;
  const sourcePath = resolve(source);
  const sourceStat = await stat(sourcePath);
  if (sourceStat.isFile()) return sourcePath;

  const names = (await readdir(sourcePath)).toSorted();
  const rawName = names.find((name) => RAW_EXTENSIONS.has(extname(name).toLowerCase()));
  return rawName === undefined ? undefined : join(sourcePath, rawName);
}

async function runRequired(label: string, command: Array<string>, env: Record<string, string>): Promise<void> {
  const result = await runCommand(command, env);
  if (result.exitCode === 0) return;
  console.error(`${label} failed`);
  console.error(`$ ${formatCommandForLog(command[0] ?? '', command.slice(1))}`);
  writeBoundedOutput('stdout', result.stdout);
  writeBoundedOutput('stderr', result.stderr);
  process.exit(result.exitCode);
}

async function runCommand(command: Array<string>, env: Record<string, string>): Promise<RunResult> {
  const proc = Bun.spawn(command, {
    env: { ...process.env, ...env },
    stderr: 'pipe',
    stdout: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    readBoundedStream(proc.stdout),
    readBoundedStream(proc.stderr),
    proc.exited,
  ]);
  return { exitCode, stderr, stdout };
}

function mean(values: Array<number>): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

function valueAfter(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}
