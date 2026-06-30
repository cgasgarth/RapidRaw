#!/usr/bin/env bun

import { existsSync } from 'node:fs';

import { z } from 'zod';

const REPORT_PATH =
  'docs/validation/proofs/super-resolution/super-resolution-artifact-performance-proof-2026-06-18.json';
const PERFORMANCE_FIXTURES_PATH = 'docs/validation/fixtures/super-resolution-performance-fixtures.json';
const GENERATED_AT = '2026-06-18T00:00:00.000Z';
const BYTES_PER_LINEAR_RGBA16_PIXEL = 8;
const MIN_IMPROVEMENT_RATIO = 0.65;

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const performanceFixtureSchema = z
  .object({
    budgets: z.object({
      maxEstimatedPeakMemoryBytes: z.number().int().positive(),
      maxEstimatedRuntimeMs: z.number().int().positive(),
    }),
    ciLane: z.enum(['manual', 'nightly', 'smoke']),
    expectedWarningCodes: z.array(z.string().trim().min(1)),
    finalApplyAllowed: z.boolean(),
    id: z.string().trim().min(1),
    outputDimensions: z.object({ height: z.number().int().positive(), width: z.number().int().positive() }),
  })
  .strict()
  .passthrough();
const performanceManifestSchema = z
  .object({ fixtures: z.array(performanceFixtureSchema).min(1) })
  .strict()
  .passthrough();

const runtimeResultSchema = z
  .object({
    artifactCount: z.number().int().min(2),
    improvementRatio: z.number().min(MIN_IMPROVEMENT_RATIO).max(1),
    outputArtifactContentHash: z.string().trim().min(1),
    outputSha256: hashSchema,
    outputSize: z.object({ height: z.number().int().positive(), width: z.number().int().positive() }).strict(),
  })
  .strict()
  .passthrough();

const reportSchema = z
  .object({
    artifactPolicy: z.object({
      outputArtifactContentHash: z.string().trim().min(1),
      outputSha256: hashSchema,
      previewExportParity: z.literal('runtime_output_hash_reused_as_preview_export_proxy'),
    }),
    generatedAt: z.iso.datetime({ offset: true }),
    issue: z.literal(1941),
    performance: z.object({
      fixtureCount: z.number().int().positive(),
      fixtureManifestHash: hashSchema,
      maxEstimatedPeakMemoryBytes: z.number().int().positive(),
      maxEstimatedRuntimeMs: z.number().int().positive(),
      measuredRuntimeMs: z.number().nonnegative(),
      proxyPeakMemoryBytes: z.number().int().positive(),
    }),
    proofHash: hashSchema,
    schemaVersion: z.literal(1),
    validationStatus: z.literal('synthetic_artifact_gate'),
    warnings: z.array(z.string().trim().min(1)),
  })
  .strict();

const update = process.argv.includes('--update');
run(['bun', 'tests/integration/checks/check-super-resolution-performance-fixtures.ts']);
const started = performance.now();
const runtimeOutput = run([
  'bun',
  'tests/integration/checks/check-super-resolution-runtime-plan-smoke.ts',
  '--verbose',
]);
const measuredRuntimeMs = round3(performance.now() - started);
const runtime = runtimeResultSchema.parse(JSON.parse(runtimeOutput));
const manifestText = await Bun.file(PERFORMANCE_FIXTURES_PATH).text();
const manifest = performanceManifestSchema.parse(JSON.parse(manifestText));
const smokeFixtures = manifest.fixtures.filter((fixture) => fixture.ciLane === 'smoke');
const proxyPeakMemoryBytes = Math.max(
  ...smokeFixtures.map(
    (fixture) => fixture.outputDimensions.width * fixture.outputDimensions.height * BYTES_PER_LINEAR_RGBA16_PIXEL,
  ),
);
const maxEstimatedPeakMemoryBytes = Math.max(
  ...smokeFixtures.map((fixture) => fixture.budgets.maxEstimatedPeakMemoryBytes),
);
const maxEstimatedRuntimeMs = Math.max(...smokeFixtures.map((fixture) => fixture.budgets.maxEstimatedRuntimeMs));
if (proxyPeakMemoryBytes > maxEstimatedPeakMemoryBytes) {
  throw new Error(`SR proxy peak memory ${proxyPeakMemoryBytes} exceeds smoke budget ${maxEstimatedPeakMemoryBytes}.`);
}
if (measuredRuntimeMs > maxEstimatedRuntimeMs) {
  throw new Error(`SR measured runtime ${measuredRuntimeMs}ms exceeds smoke budget ${maxEstimatedRuntimeMs}ms.`);
}

const report = reportSchema.parse({
  artifactPolicy: {
    outputArtifactContentHash: runtime.outputArtifactContentHash,
    outputSha256: runtime.outputSha256,
    previewExportParity: 'runtime_output_hash_reused_as_preview_export_proxy',
  },
  generatedAt: GENERATED_AT,
  issue: 1941,
  performance: {
    fixtureCount: manifest.fixtures.length,
    fixtureManifestHash: hashString(manifestText),
    maxEstimatedPeakMemoryBytes,
    maxEstimatedRuntimeMs,
    measuredRuntimeMs,
    proxyPeakMemoryBytes,
  },
  proofHash: hashString(JSON.stringify({ runtime, manifestHash: hashString(manifestText) })),
  schemaVersion: 1,
  validationStatus: 'synthetic_artifact_gate',
  warnings: [...new Set(manifest.fixtures.flatMap((fixture) => fixture.expectedWarningCodes))].toSorted(),
});
const reportJson = `${JSON.stringify(report, null, 2)}\n`;

if (update) {
  await Bun.write(REPORT_PATH, reportJson);
  console.log('sr artifact performance proof updated');
  process.exit(0);
}

if (!existsSync(REPORT_PATH)) {
  throw new Error(`Missing ${REPORT_PATH}; run bun run check:sr-artifact-performance-proof:update.`);
}

const existingReport = reportSchema.parse(await Bun.file(REPORT_PATH).json());
if (JSON.stringify(withCurrentMeasuredRuntime(existingReport)) !== JSON.stringify(report)) {
  throw new Error(`${REPORT_PATH} is stale; run bun run check:sr-artifact-performance-proof:update.`);
}

console.log('sr artifact performance proof ok');

function run(command: string[]): string {
  const result = Bun.spawnSync(command, { stderr: 'pipe', stdout: 'pipe' });
  const stdout = new TextDecoder().decode(result.stdout).trim();
  if (result.exitCode !== 0) {
    console.error(`${command.join(' ')} failed`);
    console.error([stdout, new TextDecoder().decode(result.stderr)].join('\n').split('\n').slice(-20).join('\n'));
    process.exit(result.exitCode);
  }
  return stdout;
}

function hashString(value: string): string {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex');
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function withCurrentMeasuredRuntime(value: z.infer<typeof reportSchema>): z.infer<typeof reportSchema> {
  return {
    ...value,
    performance: {
      ...value.performance,
      measuredRuntimeMs,
    },
  };
}
