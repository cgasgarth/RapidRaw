#!/usr/bin/env bun

import { existsSync } from 'node:fs';

import { z } from 'zod';

const REPORT_PATH = 'docs/validation/proofs/super-resolution/super-resolution-alignment-detail-proof-2026-06-18.json';
const SMOKE_REPORT_PATH = 'artifacts/super-resolution-synthetic-smoke/super-resolution-synthetic-smoke-report.json';
const RUNTIME_REPORT_PATH =
  'artifacts/super-resolution-runtime-plan-smoke/super-resolution-runtime-plan-smoke-report.json';
const GENERATED_AT = '2026-06-20T00:00:00.000Z';
const MIN_CHANGED_PIXEL_RATIO = 0.35;
const MIN_IMPROVEMENT_RATIO = 0.65;
const MAX_SR_MAE = 0.01;

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const smokeReportSchema = z
  .object({
    baselineMae: z.number().positive(),
    changedPixelRatio: z.number().min(MIN_CHANGED_PIXEL_RATIO).max(1),
    fixtureId: z.literal('sr.synthetic.pixel-shift-chart.v1'),
    highResolutionDimensions: z.object({ height: z.number().int().positive(), width: z.number().int().positive() }),
    improvementRatio: z.number().min(MIN_IMPROVEMENT_RATIO).max(1),
    outputScale: z.literal(2),
    sourceFrames: z.array(z.object({ shiftX: z.number().int(), shiftY: z.number().int() }).strict()).length(4),
    srMae: z.number().min(0).max(MAX_SR_MAE),
  })
  .strict();
const alignmentDiagnosticsSchema = z
  .object({
    algorithmId: z.literal('declared_pixel_shift_lattice_diagnostics_v1'),
    confidence: z.literal(1),
    expectedShiftPhases: smokeReportSchema.shape.sourceFrames,
    frameCount: z.literal(4),
    geometryConsistent: z.literal(true),
    limitations: z
      .array(
        z.enum([
          'declared_integer_offsets_only',
          'no_rotation_scale_or_perspective_estimation',
          'no_optical_flow_or_local_warp_estimation',
          'no_photometric_normalization',
        ]),
      )
      .length(4),
    phaseCoverageRatio: z.literal(1),
    referenceSourceIndex: z.literal(0),
    status: z.literal('complete_declared_lattice'),
    uniqueShiftPhaseCount: z.literal(4),
  })
  .strict();
const runtimeReportSchema = z
  .object({
    alignmentDiagnostics: alignmentDiagnosticsSchema,
    fixture: z.literal('synthetic_sr_runtime_plan_v1'),
    frameRegistrations: z.array(
      z
        .object({
          confidence: z.literal(1),
          shiftX: z.number().int(),
          shiftY: z.number().int(),
          sourceIndex: z.number().int(),
        })
        .strict(),
    ),
    improvementRatio: z.number().min(MIN_IMPROVEMENT_RATIO).max(1),
    outputSha256: hashSchema,
    runtimeStatus: z.literal('apply_rendered'),
  })
  .passthrough();

const reportSchema = z
  .object({
    alignment: z
      .object({
        algorithmId: z.literal('declared_pixel_shift_lattice_diagnostics_v1'),
        confidence: z.literal(1),
        evidencePath: z.literal(RUNTIME_REPORT_PATH),
        expectedFrameCount: z.literal(4),
        expectedShiftPhases: smokeReportSchema.shape.sourceFrames,
        limitations: alignmentDiagnosticsSchema.shape.limitations,
        phaseCoverageRatio: z.literal(1),
        referenceSourceIndex: z.literal(0),
        sourceFrames: smokeReportSchema.shape.sourceFrames,
        sourceReportHash: hashSchema,
        status: z.literal('complete_declared_lattice'),
      })
      .strict(),
    detail: z
      .object({
        baselineMae: z.number().positive(),
        changedPixelRatio: z.number().min(MIN_CHANGED_PIXEL_RATIO).max(1),
        improvementRatio: z.number().min(MIN_IMPROVEMENT_RATIO).max(1),
        srMae: z.number().min(0).max(MAX_SR_MAE),
      })
      .strict(),
    generatedAt: z.iso.datetime({ offset: true }),
    issue: z.literal(2357),
    output: z
      .object({
        dimensions: smokeReportSchema.shape.highResolutionDimensions,
        scale: z.literal(2),
        sourceReportHash: hashSchema,
      })
      .strict(),
    proofHash: hashSchema,
    schemaVersion: z.literal(1),
    validationStatus: z.literal('synthetic_artifact_gate'),
  })
  .strict();

const update = process.argv.includes('--update');
run(['bun', 'tests/integration/checks/super-resolution/check-super-resolution-synthetic-smoke.ts']);
run(['bun', 'tests/integration/checks/super-resolution/check-super-resolution-runtime-plan-smoke.ts']);
const smokeReportText = await Bun.file(SMOKE_REPORT_PATH).text();
const smokeReport = smokeReportSchema.parse(JSON.parse(smokeReportText));
const runtimeReportText = await Bun.file(RUNTIME_REPORT_PATH).text();
const runtimeReport = runtimeReportSchema.parse(JSON.parse(runtimeReportText));
const output = {
  dimensions: smokeReport.highResolutionDimensions,
  scale: smokeReport.outputScale,
  sourceReportHash: hashString(smokeReportText),
};
const report = reportSchema.parse({
  alignment: {
    algorithmId: runtimeReport.alignmentDiagnostics.algorithmId,
    confidence: runtimeReport.alignmentDiagnostics.confidence,
    evidencePath: RUNTIME_REPORT_PATH,
    expectedFrameCount: 4,
    expectedShiftPhases: runtimeReport.alignmentDiagnostics.expectedShiftPhases,
    limitations: runtimeReport.alignmentDiagnostics.limitations,
    phaseCoverageRatio: runtimeReport.alignmentDiagnostics.phaseCoverageRatio,
    referenceSourceIndex: runtimeReport.alignmentDiagnostics.referenceSourceIndex,
    sourceFrames: smokeReport.sourceFrames,
    sourceReportHash: hashString(runtimeReportText),
    status: runtimeReport.alignmentDiagnostics.status,
  },
  detail: {
    baselineMae: smokeReport.baselineMae,
    changedPixelRatio: smokeReport.changedPixelRatio,
    improvementRatio: smokeReport.improvementRatio,
    srMae: smokeReport.srMae,
  },
  generatedAt: GENERATED_AT,
  issue: 2357,
  output,
  proofHash: hashString(JSON.stringify({ detail: smokeReport, output, runtime: runtimeReport })),
  schemaVersion: 1,
  validationStatus: 'synthetic_artifact_gate',
});
const reportJson = `${JSON.stringify(report, null, 2)}\n`;

if (update) {
  await Bun.write(REPORT_PATH, reportJson);
  console.log('sr alignment detail proof updated');
  process.exit(0);
}

if (!existsSync(REPORT_PATH)) {
  throw new Error(`Missing ${REPORT_PATH}; run bun run check:sr-alignment-detail-proof:update.`);
}

const existingReport = reportSchema.parse(await Bun.file(REPORT_PATH).json());
if (JSON.stringify(existingReport) !== JSON.stringify(report)) {
  throw new Error(`${REPORT_PATH} is stale; run bun run check:sr-alignment-detail-proof:update.`);
}

console.log('sr alignment detail proof ok');

function run(command: string[]): void {
  const result = Bun.spawnSync(command, {
    stderr: 'pipe',
    stdout: 'pipe',
  });
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
