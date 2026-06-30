#!/usr/bin/env bun

import { existsSync } from 'node:fs';

import { z } from 'zod';

const PROJECTION_REPORT_PATH = 'docs/validation/proofs/panorama/panorama-projection-crop-proof-2026-06-18.json';
const PERFORMANCE_FIXTURES_PATH = 'fixtures/panorama/panorama-performance-fixtures.json';
const REPORT_PATH = 'docs/validation/proofs/panorama/panorama-projection-memory-proof-2026-06-18.json';
const GENERATED_AT = '2026-06-18T00:00:00.000Z';
const BYTES_PER_RGBA16_PIXEL = 8;

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const projectionReportSchema = z
  .object({
    cases: z.array(
      z.object({
        autoCrop: z.object({ height: z.number().int().positive(), width: z.number().int().positive() }),
        fullCanvas: z.object({ height: z.number().int().positive(), width: z.number().int().positive() }),
        projection: z.object({ effectiveProjection: z.string(), requestedProjection: z.string(), support: z.string() }),
      }),
    ),
  })
  .strict()
  .passthrough();
const performanceManifestSchema = z.object({
  performanceFixtures: z.array(
    z
      .object({
        ciMode: z.enum(['manual-local', 'required-pr-metadata', 'scheduled-nightly']),
        fixtureId: z.string().trim().min(1),
        memoryBudgetBytes: z.number().int().positive(),
        runtimeBudgetMs: z.number().int().positive(),
      })
      .strict()
      .passthrough(),
  ),
});
const reportSchema = z
  .object({
    generatedAt: z.iso.datetime({ offset: true }),
    issue: z.literal(1930),
    performance: z.object({
      fixtureCount: z.number().int().positive(),
      maxRequiredPrMemoryBudgetBytes: z.number().int().positive(),
      maxRequiredPrRuntimeBudgetMs: z.number().int().positive(),
      performanceManifestHash: hashSchema,
      projectionProxyMemoryBytes: z.number().int().positive(),
    }),
    projection: z.object({
      cropPixelCount: z.number().int().positive(),
      effectiveProjection: z.string().trim().min(1),
      fullCanvasPixelCount: z.number().int().positive(),
      requestedProjection: z.string().trim().min(1),
      support: z.string().trim().min(1),
    }),
    proofHash: hashSchema,
    schemaVersion: z.literal(1),
    sourceReportHash: hashSchema,
    validationStatus: z.literal('synthetic_artifact_gate'),
  })
  .strict();

const update = process.argv.includes('--update');
run(['bun', 'tests/integration/checks/check-panorama-projection-crop.ts']);
run(['bun', 'tests/integration/checks/check-panorama-performance-fixtures.ts']);
const projectionText = await Bun.file(PROJECTION_REPORT_PATH).text();
const projectionReport = projectionReportSchema.parse(JSON.parse(projectionText));
const performanceText = await Bun.file(PERFORMANCE_FIXTURES_PATH).text();
const performance = performanceManifestSchema.parse(JSON.parse(performanceText));
const [projectionCase] = projectionReport.cases;
if (projectionCase === undefined) throw new Error('Panorama projection proof requires at least one case.');
const requiredPrFixtures = performance.performanceFixtures.filter(
  (fixture) => fixture.ciMode === 'required-pr-metadata',
);
const projectionProxyMemoryBytes =
  projectionCase.fullCanvas.width * projectionCase.fullCanvas.height * BYTES_PER_RGBA16_PIXEL;
const maxRequiredPrMemoryBudgetBytes = Math.max(...requiredPrFixtures.map((fixture) => fixture.memoryBudgetBytes));
if (projectionProxyMemoryBytes > maxRequiredPrMemoryBudgetBytes) {
  throw new Error(
    `Panorama projection proxy memory ${projectionProxyMemoryBytes} exceeds PR budget ${maxRequiredPrMemoryBudgetBytes}.`,
  );
}
const projection = {
  cropPixelCount: projectionCase.autoCrop.width * projectionCase.autoCrop.height,
  effectiveProjection: projectionCase.projection.effectiveProjection,
  fullCanvasPixelCount: projectionCase.fullCanvas.width * projectionCase.fullCanvas.height,
  requestedProjection: projectionCase.projection.requestedProjection,
  support: projectionCase.projection.support,
};
const performanceSummary = {
  fixtureCount: performance.performanceFixtures.length,
  maxRequiredPrMemoryBudgetBytes,
  maxRequiredPrRuntimeBudgetMs: Math.max(...requiredPrFixtures.map((fixture) => fixture.runtimeBudgetMs)),
  performanceManifestHash: hashString(performanceText),
  projectionProxyMemoryBytes,
};
const sourceReportHash = hashString(projectionText);
const report = reportSchema.parse({
  generatedAt: GENERATED_AT,
  issue: 1930,
  performance: performanceSummary,
  projection,
  proofHash: hashString(JSON.stringify({ performanceSummary, projection, sourceReportHash })),
  schemaVersion: 1,
  sourceReportHash,
  validationStatus: 'synthetic_artifact_gate',
});
const reportJson = `${JSON.stringify(report, null, 2)}\n`;

if (update) {
  await Bun.write(REPORT_PATH, reportJson);
  console.log('panorama projection memory proof updated');
  process.exit(0);
}

if (!existsSync(REPORT_PATH)) {
  throw new Error(`Missing ${REPORT_PATH}; run bun run check:panorama-projection-memory-proof:update.`);
}

const existingReport = reportSchema.parse(await Bun.file(REPORT_PATH).json());
if (JSON.stringify(existingReport) !== JSON.stringify(report)) {
  throw new Error(`${REPORT_PATH} is stale; run bun run check:panorama-projection-memory-proof:update.`);
}

console.log('panorama projection memory proof ok');

function run(command: string[]): void {
  const result = Bun.spawnSync(command, { stderr: 'pipe', stdout: 'pipe' });
  if (result.exitCode !== 0) {
    console.error(`${command.join(' ')} failed`);
    console.error(
      [new TextDecoder().decode(result.stdout), new TextDecoder().decode(result.stderr)]
        .join('\n')
        .split('\n')
        .slice(-20)
        .join('\n'),
    );
    process.exit(result.exitCode);
  }
}

function hashString(value: string): string {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex');
}
