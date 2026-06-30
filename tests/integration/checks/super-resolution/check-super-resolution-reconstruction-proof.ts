#!/usr/bin/env bun

import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { format, resolveConfig } from 'prettier';
import { z } from 'zod';

import { superResolutionReconstructionDiagnosticsV1Schema } from '../../../../packages/rawengine-schema/src/super-resolution/superResolutionReconstructionDiagnostics.ts';

const REPORT_PATH = 'artifacts/validation/super-resolution-reconstruction-proof-2026-06-20.json';
const RUNTIME_REPORT_PATH =
  'artifacts/super-resolution-runtime-plan-smoke/super-resolution-runtime-plan-smoke-report.json';
const GENERATED_AT = '2026-06-20T00:00:00.000Z';

const runtimeReportSchema = z
  .object({
    alignmentDiagnostics: z.object({ status: z.literal('complete_declared_lattice') }).passthrough(),
    fixture: z.literal('synthetic_sr_runtime_plan_v1'),
    improvementRatio: z.number().min(0.65).max(1),
    outputSize: z.object({ height: z.number().int().positive(), width: z.number().int().positive() }).strict(),
    performanceEstimate: z
      .object({
        estimatedPeakMemoryBytes: z.number().int().positive(),
        estimatedRuntimeMs: z.number().nonnegative(),
        requiresBackgroundJob: z.boolean(),
      })
      .strict(),
    quality: z
      .object({
        reconstructionDiagnostics: superResolutionReconstructionDiagnosticsV1Schema,
      })
      .passthrough(),
    runtimeStatus: z.literal('apply_rendered'),
  })
  .passthrough();

const proofReportSchema = z
  .object({
    acceptedConsultRecommendations: z.array(z.string().trim().min(1)).min(1),
    doesNotProve: z.array(
      z.enum(['real_raw_e2e', 'preview_export_parity', 'motion_robustness', 'final_detail_quality']),
    ),
    generatedAt: z.iso.datetime({ offset: true }),
    issue: z.literal(2358),
    performanceEstimate: runtimeReportSchema.shape.performanceEstimate,
    reconstructionDiagnostics: superResolutionReconstructionDiagnosticsV1Schema,
    runtimeFixture: z.literal('synthetic_sr_runtime_plan_v1'),
    runtimeStatus: z.literal('runtime_apply_capable_first_pass'),
    schemaVersion: z.literal(1),
    validationMode: z.literal('synthetic_sr_x2_reconstruction_runtime_proof'),
  })
  .strict();

const update = process.argv.includes('--update');
run(['bun', 'tests/integration/checks/super-resolution/check-super-resolution-runtime-plan-smoke.ts']);
const runtimeReport = runtimeReportSchema.parse(JSON.parse(await readFile(RUNTIME_REPORT_PATH, 'utf8')));
const diagnostics = runtimeReport.quality.reconstructionDiagnostics;
if (diagnostics.outputPixelCount !== runtimeReport.outputSize.width * runtimeReport.outputSize.height) {
  throw new Error('SR reconstruction diagnostics output pixel count does not match runtime dimensions.');
}

const report = proofReportSchema.parse({
  acceptedConsultRecommendations: [
    'Use conservative integer pixel-shift interleave for the first x2 runtime proof.',
    'Gate claims on complete unique declared x2 lattice, finite output, and filled output pixels.',
    'Defer motion robustness, photometric normalization, demosaic-aware detail claims, and final quality claims.',
  ],
  doesNotProve: ['real_raw_e2e', 'preview_export_parity', 'motion_robustness', 'final_detail_quality'],
  generatedAt: GENERATED_AT,
  issue: 2358,
  performanceEstimate: runtimeReport.performanceEstimate,
  reconstructionDiagnostics: diagnostics,
  runtimeFixture: runtimeReport.fixture,
  runtimeStatus: 'runtime_apply_capable_first_pass',
  schemaVersion: 1,
  validationMode: 'synthetic_sr_x2_reconstruction_runtime_proof',
});

const reportJson = await format(JSON.stringify(report), {
  ...((await resolveConfig('package.json')) ?? {}),
  parser: 'json',
});

if (update) {
  await mkdir(dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, reportJson);
  console.log(`sr reconstruction proof artifact wrote ${REPORT_PATH}`);
  process.exit(0);
}

console.log(`sr reconstruction proof ok (${diagnostics.reconstructionMethod})`);

function run(command: string[]): void {
  const result = spawnSync(command[0], command.slice(1), { encoding: 'utf8' });
  if (result.status !== 0) {
    if (result.stdout.length > 0) process.stderr.write(result.stdout.slice(-4000));
    if (result.stderr.length > 0) process.stderr.write(result.stderr.slice(-4000));
    throw new Error(`${command.join(' ')} failed.`);
  }
}
