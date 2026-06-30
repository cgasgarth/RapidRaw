#!/usr/bin/env bun

import { existsSync } from 'node:fs';

import { z } from 'zod';

const REPORT_PATH = 'docs/validation/proofs/focus/focus-alignment-sharpness-proof-2026-06-18.json';
const SHARPNESS_ARTIFACT_PATH = 'artifacts/focus-sharpness-map/focus-sharpness-map-report.json';
const GENERATED_AT = '2026-06-18T00:00:00.000Z';
const MIN_ALIGNMENT_CONFIDENCE = 0.85;
const MAX_ALIGNMENT_RESIDUAL = 0.004;
const MIN_REGION_WINNER_CELL_RATIO = 0.8;
const MIN_REGION_AGGREGATE_MARGIN = 0.16;

const commandResultSchema = z
  .object({
    code: z.number().int(),
    stderr: z.string(),
    stdout: z.string(),
  })
  .strict();

const alignmentFixtureSchema = z
  .object({
    fixtureId: z.string().trim().min(1),
    maxResidual: z.number().min(0).max(MAX_ALIGNMENT_RESIDUAL),
    minConfidence: z.number().min(MIN_ALIGNMENT_CONFIDENCE).max(1),
  })
  .strict();

const regionResultSchema = z
  .object({
    aggregateConfidenceMargin: z.number().min(MIN_REGION_AGGREGATE_MARGIN),
    regionId: z.string().trim().min(1),
    status: z.literal('pass'),
    winnerCellRatio: z.number().min(MIN_REGION_WINNER_CELL_RATIO).max(1),
  })
  .strict()
  .passthrough();

const sharpnessArtifactSchema = z
  .object({
    algorithm: z
      .object({
        id: z.string().trim().min(1),
      })
      .strict()
      .passthrough(),
    doesNotProve: z.array(z.string().trim().min(1)),
    fixtures: z.array(
      z
        .object({
          appliedTransforms: z.array(z.object({ sourceIndex: z.number().int().nonnegative() }).passthrough()).min(2),
          expectedRegionResults: z.array(regionResultSchema).min(1),
          expectedWarningCodes: z.array(z.string().trim().min(1)),
          fixtureId: z.string().trim().min(1),
          map: z
            .object({
              gridHeight: z.number().int().positive(),
              gridWidth: z.number().int().positive(),
            })
            .strict()
            .passthrough(),
        })
        .strict()
        .passthrough(),
    ),
    schemaVersion: z.literal(1),
  })
  .strict()
  .passthrough();

const reportSchema = z
  .object({
    alignment: z
      .object({
        badBracketWarningPath: z.literal('alignment_high_residual'),
        command: z.literal('bun tests/integration/checks/check-focus-translation-alignment-smoke.ts'),
        fixtures: z.array(alignmentFixtureSchema).min(1),
        outputHash: z.string().regex(/^[a-f0-9]{64}$/),
        skippedScaleVariedFixtures: z.array(z.string().trim().min(1)),
      })
      .strict(),
    generatedAt: z.iso.datetime({ offset: true }),
    issue: z.literal(1938),
    proofHash: z.string().regex(/^[a-f0-9]{64}$/),
    schemaVersion: z.literal(1),
    sharpness: z
      .object({
        artifactHash: z.string().regex(/^[a-f0-9]{64}$/),
        artifactPath: z.literal(SHARPNESS_ARTIFACT_PATH),
        command: z.literal('bun tests/integration/checks/check-focus-sharpness-map-smoke.ts'),
        doesNotProve: z.array(z.string().trim().min(1)),
        fixtures: z.array(
          z
            .object({
              fixtureId: z.string().trim().min(1),
              gridHeight: z.number().int().positive(),
              gridWidth: z.number().int().positive(),
              minAggregateConfidenceMargin: z.number().min(MIN_REGION_AGGREGATE_MARGIN),
              minWinnerCellRatio: z.number().min(MIN_REGION_WINNER_CELL_RATIO).max(1),
              transformSourceIndexes: z.array(z.number().int().nonnegative()).min(2),
              warningCodes: z.array(z.string().trim().min(1)),
            })
            .strict(),
        ),
        mapAlgorithm: z.string().trim().min(1),
      })
      .strict(),
    validationStatus: z.literal('synthetic_artifact_gate'),
  })
  .strict();

const update = process.argv.includes('--update');
const alignmentResult = run(['bun', 'tests/integration/checks/check-focus-translation-alignment-smoke.ts']);
run(['bun', 'tests/integration/checks/check-focus-sharpness-map-smoke.ts']);
const sharpnessArtifactText = await Bun.file(SHARPNESS_ARTIFACT_PATH).text();
const sharpnessArtifact = sharpnessArtifactSchema.parse(JSON.parse(sharpnessArtifactText));
const alignmentFixtures = parseAlignmentFixtures(alignmentResult.stdout);
const skippedScaleVariedFixtures = parseSkippedFixtures(alignmentResult.stdout);
const alignment = {
  badBracketWarningPath: 'alignment_high_residual' as const,
  command: 'bun tests/integration/checks/check-focus-translation-alignment-smoke.ts' as const,
  fixtures: alignmentFixtures,
  outputHash: hashString(JSON.stringify({ alignmentFixtures, skippedScaleVariedFixtures })),
  skippedScaleVariedFixtures,
};
const sharpness = {
  artifactHash: hashString(sharpnessArtifactText),
  artifactPath: SHARPNESS_ARTIFACT_PATH,
  command: 'bun tests/integration/checks/check-focus-sharpness-map-smoke.ts' as const,
  doesNotProve: sharpnessArtifact.doesNotProve,
  fixtures: sharpnessArtifact.fixtures.map((fixture) => ({
    fixtureId: fixture.fixtureId,
    gridHeight: fixture.map.gridHeight,
    gridWidth: fixture.map.gridWidth,
    minAggregateConfidenceMargin: Math.min(
      ...fixture.expectedRegionResults.map((result) => result.aggregateConfidenceMargin),
    ),
    minWinnerCellRatio: Math.min(...fixture.expectedRegionResults.map((result) => result.winnerCellRatio)),
    transformSourceIndexes: fixture.appliedTransforms.map((transform) => transform.sourceIndex),
    warningCodes: fixture.expectedWarningCodes,
  })),
  mapAlgorithm: sharpnessArtifact.algorithm.id,
};
const proofPayload = { alignment, sharpness, validationStatus: 'synthetic_artifact_gate' };
const report = reportSchema.parse({
  alignment,
  generatedAt: GENERATED_AT,
  issue: 1938,
  proofHash: hashString(JSON.stringify(proofPayload)),
  schemaVersion: 1,
  sharpness,
  validationStatus: 'synthetic_artifact_gate',
});
const reportJson = `${JSON.stringify(report, null, 2)}\n`;

if (update) {
  await Bun.write(REPORT_PATH, reportJson);
  console.log('focus alignment sharpness proof updated');
  process.exit(0);
}

if (!existsSync(REPORT_PATH)) {
  throw new Error(`Missing ${REPORT_PATH}; run bun run check:focus-alignment-sharpness-proof:update.`);
}

const existingReport = reportSchema.parse(await Bun.file(REPORT_PATH).json());
if (JSON.stringify(existingReport) !== JSON.stringify(report)) {
  throw new Error(`${REPORT_PATH} is stale; run bun run check:focus-alignment-sharpness-proof:update.`);
}

console.log(`focus alignment sharpness proof ok (${report.sharpness.fixtures.length} fixtures)`);

function run(command: string[]): z.infer<typeof commandResultSchema> {
  const result = Bun.spawnSync(command, {
    stderr: 'pipe',
    stdout: 'pipe',
  });
  const parsed = commandResultSchema.parse({
    code: result.exitCode,
    stderr: new TextDecoder().decode(result.stderr),
    stdout: new TextDecoder().decode(result.stdout),
  });
  if (parsed.code !== 0) {
    console.error(`${command.join(' ')} failed`);
    console.error([parsed.stdout, parsed.stderr].join('\n').split('\n').slice(-20).join('\n'));
    process.exit(parsed.code);
  }
  return parsed;
}

function parseAlignmentFixtures(output: string): Array<z.infer<typeof alignmentFixtureSchema>> {
  return output
    .split('\n')
    .map((line) => /^([^:\s]+): minConfidence=([0-9.]+) maxResidual=([0-9.]+)$/u.exec(line.trim()))
    .filter((match) => match !== null)
    .map((match) =>
      alignmentFixtureSchema.parse({
        fixtureId: match[1],
        maxResidual: Number(match[3]),
        minConfidence: Number(match[2]),
      }),
    );
}

function parseSkippedFixtures(output: string): string[] {
  const match = /Skipped [0-9]+ scale-varied fixtures: (.+)$/mu.exec(output);
  if (match === null) return [];
  return match[1].split(',').map((fixtureId) => fixtureId.trim());
}

function hashString(value: string): string {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex');
}
