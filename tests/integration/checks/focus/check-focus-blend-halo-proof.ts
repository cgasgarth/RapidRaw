#!/usr/bin/env bun

import { existsSync } from 'node:fs';

import { z } from 'zod';

const REPORT_PATH = 'docs/validation/proofs/focus/focus-blend-halo-proof-2026-06-18.json';
const BLEND_ARTIFACT_PATH = 'artifacts/focus-preview-blend/focus-preview-blend-report.json';
const GENERATED_AT = '2026-06-18T00:00:00.000Z';
const MAX_REGION_MAE = 0.08;
const MAX_HALO_RISK_CELL_RATIO = 0.2;

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const commandResultSchema = z
  .object({
    code: z.number().int(),
    stderr: z.string(),
    stdout: z.string(),
  })
  .strict();

const previewBlendArtifactSchema = z
  .object({
    algorithm: z
      .object({
        id: z.string().trim().min(1),
        maxHaloRiskCellRatio: z.number().max(MAX_HALO_RISK_CELL_RATIO),
        maxRegionMeanAbsoluteError: z.number().max(MAX_REGION_MAE),
      })
      .strict()
      .passthrough(),
    doesNotProve: z.array(z.string().trim().min(1)),
    fixtures: z.array(
      z
        .object({
          artifactPath: z.string().trim().min(1),
          blockCodes: z.array(z.string().trim().min(1)),
          fixtureId: z.string().trim().min(1),
          haloRiskCellRatio: z.number().min(0).max(MAX_HALO_RISK_CELL_RATIO),
          height: z.number().int().positive(),
          lowConfidenceCellRatio: z.number().min(0).max(1),
          regionMetrics: z.array(
            z
              .object({
                meanAbsoluteError: z.number().min(0).max(MAX_REGION_MAE),
                regionId: z.string().trim().min(1),
                status: z.literal('pass'),
              })
              .strict()
              .passthrough(),
          ),
          warningCodes: z.array(z.string().trim().min(1)),
          width: z.number().int().positive(),
        })
        .strict()
        .passthrough(),
    ),
    runtimeStatus: z.literal('preview_only_synthetic_smoke'),
    schemaVersion: z.literal(1),
  })
  .strict()
  .passthrough();

const reportSchema = z
  .object({
    artifactReportHash: hashSchema,
    command: z.literal('bun tests/integration/checks/focus/check-focus-preview-blend-smoke.ts'),
    generatedAt: z.iso.datetime({ offset: true }),
    issue: z.literal(1939),
    proofHash: hashSchema,
    schemaVersion: z.literal(1),
    validationStatus: z.literal('synthetic_artifact_gate'),
    fixtures: z.array(
      z
        .object({
          blockCodes: z.array(z.string().trim().min(1)),
          fixtureId: z.string().trim().min(1),
          haloRiskCellRatio: z.number().min(0).max(MAX_HALO_RISK_CELL_RATIO),
          maxRegionMeanAbsoluteError: z.number().min(0).max(MAX_REGION_MAE),
          outputArtifactHash: hashSchema,
          outputDimensions: z
            .object({
              height: z.number().int().positive(),
              width: z.number().int().positive(),
            })
            .strict(),
          warningCodes: z.array(z.string().trim().min(1)),
        })
        .strict(),
    ),
    limits: z.array(z.string().trim().min(1)),
    previewExportParity: z.literal('same_synthetic_pgm_artifact_for_preview_and_export_gate'),
  })
  .strict();

const update = process.argv.includes('--update');
run(['bun', 'tests/integration/checks/focus/check-focus-preview-blend-smoke.ts']);
const artifactText = await Bun.file(BLEND_ARTIFACT_PATH).text();
const artifact = previewBlendArtifactSchema.parse(JSON.parse(artifactText));
const fixtures = await Promise.all(
  artifact.fixtures.map(async (fixture) => ({
    blockCodes: fixture.blockCodes,
    fixtureId: fixture.fixtureId,
    haloRiskCellRatio: fixture.haloRiskCellRatio,
    maxRegionMeanAbsoluteError: Math.max(...fixture.regionMetrics.map((metric) => metric.meanAbsoluteError)),
    outputArtifactHash: hashBytes(new Uint8Array(await Bun.file(fixture.artifactPath).arrayBuffer())),
    outputDimensions: {
      height: fixture.height,
      width: fixture.width,
    },
    warningCodes: fixture.warningCodes,
  })),
);
const proofPayload = {
  artifactReportHash: hashString(artifactText),
  fixtures,
  validationStatus: 'synthetic_artifact_gate',
};
const report = reportSchema.parse({
  artifactReportHash: proofPayload.artifactReportHash,
  command: 'bun tests/integration/checks/focus/check-focus-preview-blend-smoke.ts',
  fixtures,
  generatedAt: GENERATED_AT,
  issue: 1939,
  limits: artifact.doesNotProve,
  previewExportParity: 'same_synthetic_pgm_artifact_for_preview_and_export_gate',
  proofHash: hashString(JSON.stringify(proofPayload)),
  schemaVersion: 1,
  validationStatus: 'synthetic_artifact_gate',
});
const reportJson = `${JSON.stringify(report, null, 2)}\n`;

if (update) {
  await Bun.write(REPORT_PATH, reportJson);
  console.log('focus blend halo proof updated');
  process.exit(0);
}

if (!existsSync(REPORT_PATH)) {
  throw new Error(`Missing ${REPORT_PATH}; run bun run check:focus-blend-halo-proof:update.`);
}

const existingReport = reportSchema.parse(await Bun.file(REPORT_PATH).json());
if (JSON.stringify(existingReport) !== JSON.stringify(report)) {
  throw new Error(`${REPORT_PATH} is stale; run bun run check:focus-blend-halo-proof:update.`);
}

console.log(`focus blend halo proof ok (${report.fixtures.length} fixtures)`);

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

function hashBytes(bytes: Uint8Array): string {
  return new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
}

function hashString(value: string): string {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex');
}
