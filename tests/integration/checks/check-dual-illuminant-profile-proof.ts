#!/usr/bin/env bun

import { mkdir, readdir, readFile, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

import { z } from 'zod';
import { formatCommandForLog, readBoundedStream, writeBoundedOutput } from '../../../scripts/lib/ci/compact-output.ts';
import { rawDevelopmentReportSchema } from '../../../src/schemas/imageLoaderSchemas.ts';
import { buildCameraProfileProvenanceReceipt } from '../../../src/utils/cameraProfileProvenanceReceipt.ts';
import { calculateDeltaE00, labColorSchema } from '../../../src/utils/deltaE00.ts';

const FIXTURE_PATH = 'fixtures/color/proofs/dual-illuminant-profile-proof-fixture.json';
const DEFAULT_REPORT_DIR = 'src-tauri/target/dual-illuminant-profile-proof';
const RAW_EXTENSIONS = new Set(['.arw', '.cr2', '.cr3', '.dng', '.nef', '.orf', '.raf', '.rw2']);

const patchRoleSchema = z.enum(['foliage', 'memory_color', 'neutral', 'skin']);
const colorCheckerThresholdSchema = z
  .object({
    deltaE00MaxMax: z.number().positive(),
    deltaE00MeanMax: z.number().positive(),
    deltaE00P95Max: z.number().positive(),
    neutralChromaMax: z.number().nonnegative(),
  })
  .strict();
const colorCheckerPatchMetricSchema = z
  .object({
    id: z.string().trim().min(1),
    measuredLab: labColorSchema,
    neutralChroma: z.number().nonnegative().nullable(),
    referenceLab: labColorSchema,
    role: patchRoleSchema,
  })
  .passthrough();
const colorCheckerProofSchema = z
  .object({
    runtimeSampling: z
      .object({
        artifacts: z
          .object({
            overlayPath: z.string().trim().min(1),
            patchCsvPath: z.string().trim().min(1),
            summaryCsvPath: z.string().trim().min(1),
          })
          .strict(),
        captureId: z.string().trim().min(1),
        colorimetricProof: z.literal(true),
        illuminantLabel: z.string().trim().min(1),
        imageDimensions: z.object({ height: z.number().int().positive(), width: z.number().int().positive() }).strict(),
        measuredCctKelvin: z.number().positive().nullable(),
        patchCount: z.number().int().positive(),
        patches: z.array(colorCheckerPatchMetricSchema).min(1),
        proofBoundary: z.literal('private_dual_illuminant_colorchecker_runtime_sampling'),
      })
      .strict(),
    thresholds: colorCheckerThresholdSchema,
  })
  .strict();
const fixtureSchema = z
  .object({
    $schema: z.url(),
    issue: z.literal(3824),
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
    thresholds: colorCheckerThresholdSchema,
  })
  .strict();

const rustProofBaseSchema = z.object({
  dimensions: z.object({ height: z.number().int().positive(), width: z.number().int().positive() }).strict(),
  elapsedMs: z.number().nonnegative(),
  issue: z.literal(3824),
  output: z
    .object({
      imageHash: z.string().regex(/^blake3:[0-9a-f]+$/u),
      tiffPath: z.string().trim().min(1),
    })
    .strict(),
  privateAssetsCommitted: z.literal(false),
  proofBoundary: z.literal('private_dual_illuminant_profile_runtime_report'),
  rawDevelopmentReport: rawDevelopmentReportSchema,
  sourcePath: z.string().trim().min(1),
});
const rustSmokeProofReportSchema = rustProofBaseSchema
  .extend({
    colorCheckerProof: z.null(),
    colorimetricProof: z.literal(false),
    proofLevel: z.literal('private_raw_smoke_not_colorchecker_accuracy'),
  })
  .strict();
const rustColorCheckerProofReportSchema = rustProofBaseSchema
  .extend({
    colorCheckerProof: colorCheckerProofSchema,
    colorimetricProof: z.literal(true),
    proofLevel: z.literal('private_raw_colorchecker_runtime_sampling'),
  })
  .strict();
const rustProofReportSchema = z.union([rustSmokeProofReportSchema, rustColorCheckerProofReportSchema]);

interface RunResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}

const privateRoot = valueAfter('--root') ?? process.env.RAWENGINE_PRIVATE_RAW_ROOT;
const privateSource = valueAfter('--source') ?? process.env.RAWENGINE_PRIVATE_RAW_SOURCE;
const privateColorCheckerManifest =
  valueAfter('--colorchecker-manifest') ?? process.env.RAWENGINE_DUAL_ILLUMINANT_COLORCHECKER_MANIFEST;
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
    ...(privateColorCheckerManifest === undefined
      ? {}
      : { RAWENGINE_DUAL_ILLUMINANT_COLORCHECKER_MANIFEST: resolve(privateColorCheckerManifest) }),
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
if (requireAssets && privateColorCheckerManifest === undefined) {
  console.error('A private ColorChecker manifest is required with --require-assets.');
  process.exit(1);
}
if (privateReport.colorimetricProof) {
  validateColorCheckerMetrics(
    'private ColorChecker',
    privateReport.colorCheckerProof.runtimeSampling.patches,
    privateReport.colorCheckerProof.thresholds,
  );
  await assertPrivateArtifactPaths(privateReport.colorCheckerProof.runtimeSampling.artifacts);
}

console.log(
  privateReport.colorimetricProof
    ? `dual-illuminant profile proof ok (private ColorChecker ${privateReport.colorCheckerProof.runtimeSampling.patchCount} patches)`
    : `dual-illuminant profile proof ok (private smoke ${privateReport.dimensions.width}x${privateReport.dimensions.height})`,
);

async function runPublicProof(): Promise<void> {
  const fixture = fixtureSchema.parse(JSON.parse(await readFile(FIXTURE_PATH, 'utf8')));
  const receipt = buildCameraProfileProvenanceReceipt(fixture.rawDevelopmentReport);
  const failures = [
    receipt.status === 'interpolated' ? null : `expected interpolated receipt, got ${receipt.status}`,
    receipt.matrixHash === null ? 'expected matrix hash in receipt' : null,
  ].filter((failure): failure is string => failure !== null);

  if (failures.length > 0) {
    console.error(`dual-illuminant public proof failed: ${failures.join('; ')}`);
    process.exit(1);
  }
  validateColorCheckerMetrics('public fixture', fixture.patches, fixture.thresholds);
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

async function assertPrivateArtifactPaths(artifacts: {
  overlayPath: string;
  patchCsvPath: string;
  summaryCsvPath: string;
}): Promise<void> {
  const missing: Array<string> = [];
  for (const path of [artifacts.overlayPath, artifacts.patchCsvPath, artifacts.summaryCsvPath]) {
    try {
      const artifactStat = await stat(path);
      if (!artifactStat.isFile() || artifactStat.size === 0) missing.push(path);
    } catch {
      missing.push(path);
    }
  }
  if (missing.length > 0) {
    console.error(`private ColorChecker artifact missing or empty: ${missing.join(', ')}`);
    process.exit(1);
  }
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

function validateColorCheckerMetrics(
  label: string,
  patches: Array<z.infer<typeof colorCheckerPatchMetricSchema>>,
  thresholds: z.infer<typeof colorCheckerThresholdSchema>,
): void {
  const patchMetrics = patches.map((patch) => ({
    deltaE00: calculateDeltaE00(patch.referenceLab, patch.measuredLab),
    id: patch.id,
    neutralChroma:
      patch.role === 'neutral' ? Math.hypot(patch.measuredLab.a, patch.measuredLab.b) : patch.neutralChroma,
    role: patch.role,
  }));
  const deltaValues = patchMetrics.map((patch) => patch.deltaE00).toSorted((left, right) => left - right);
  const meanDeltaE00 = mean(deltaValues);
  const medianDeltaE00 = percentile(deltaValues, 0.5);
  const p95DeltaE00 = percentile(deltaValues, 0.95);
  const maxDeltaE00 = Math.max(...deltaValues);
  const maxNeutralChroma = Math.max(
    0,
    ...patchMetrics.map((patch) => patch.neutralChroma).filter((value): value is number => typeof value === 'number'),
  );
  const hasSkinPatch = patchMetrics.some((patch) => patch.role === 'skin' || patch.id.toLowerCase().includes('skin'));
  const hasFoliagePatch = patchMetrics.some(
    (patch) => patch.role === 'foliage' || patch.id.toLowerCase().includes('foliage'),
  );

  const failures = [
    patches.length >= 3 ? null : 'expected at least three ColorChecker patches',
    hasSkinPatch ? null : 'expected a selected skin patch',
    hasFoliagePatch ? null : 'expected a selected foliage patch',
    meanDeltaE00 <= thresholds.deltaE00MeanMax
      ? null
      : `mean DeltaE00 ${round(meanDeltaE00)} exceeds ${thresholds.deltaE00MeanMax}`,
    p95DeltaE00 <= thresholds.deltaE00P95Max
      ? null
      : `p95 DeltaE00 ${round(p95DeltaE00)} exceeds ${thresholds.deltaE00P95Max}`,
    maxDeltaE00 <= thresholds.deltaE00MaxMax
      ? null
      : `max DeltaE00 ${round(maxDeltaE00)} exceeds ${thresholds.deltaE00MaxMax}`,
    maxNeutralChroma <= thresholds.neutralChromaMax
      ? null
      : `neutral chroma ${round(maxNeutralChroma)} exceeds ${thresholds.neutralChromaMax}`,
  ].filter((failure): failure is string => failure !== null);

  if (failures.length > 0) {
    console.error(`${label} dual-illuminant proof failed: ${failures.join('; ')}`);
    process.exit(1);
  }

  console.log(
    `${label} ColorChecker metrics ok (mean ${round(meanDeltaE00)}, median ${round(medianDeltaE00)}, p95 ${round(
      p95DeltaE00,
    )}, max ${round(maxDeltaE00)})`,
  );
}

function percentile(sortedValues: Array<number>, fraction: number): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(sortedValues.length - 1, Math.ceil(sortedValues.length * fraction) - 1);
  return sortedValues[index] ?? 0;
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

function valueAfter(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}
