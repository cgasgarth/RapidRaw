#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { z } from 'zod';

const REPORT_PATH = resolve('src-tauri/target/rawengine-negative-lab-density-cpu-report.json');
const COMMITTED_REPORT_PATH = 'docs/validation/negative-lab-density-cpu-proof-2026-06-19.json';
const shouldUpdate = process.argv.includes('--update');

const reportSchema = z
  .object({
    algorithm: z.literal('density_rgb_v1'),
    artifactHash: z.string().regex(/^fnv1a64:[a-f0-9]{16}$/u),
    changedPixelCount: z.number().int().positive(),
    doesNotProve: z.array(z.string().trim().min(1)).min(8),
    inputContract: z.literal('declared_linear_scan_rgb'),
    inputToOutputMeanAbsDelta: z.number().min(0.05),
    issue: z.literal(2343),
    monotonicLuma: z.literal(true),
    outputDimensions: z.object({ height: z.literal(2), width: z.literal(4) }).strict(),
    runtimeStatus: z.literal('cpu_apply_capable_fixture_path'),
    warningMode: z.literal('synthetic_linear_fixture_only'),
  })
  .strict()
  .superRefine((report, context) => {
    for (const requiredNonClaim of [
      'camera_raw_decode_path',
      'automatic_base_fog_estimation',
      'display_referred_input_accuracy',
      'neutralization_accuracy',
      'colorimetric_scene_reconstruction',
      'roll_batch_execution',
      'ui_app_server_e2e',
      'commercial_converter_parity',
    ]) {
      if (!report.doesNotProve.includes(requiredNonClaim)) {
        context.addIssue({
          code: 'custom',
          message: `Negative Lab density CPU proof missing non-claim ${requiredNonClaim}.`,
          path: ['doesNotProve'],
        });
      }
    }
  });

const result = Bun.spawnSync(
  [
    'rustup',
    'run',
    '1.95.0',
    'cargo',
    'test',
    'negative_density_cpu_report_proves_apply_capable_fixture_path',
    '--quiet',
  ],
  {
    cwd: 'src-tauri',
    env: {
      ...process.env,
      RAWENGINE_NEGATIVE_LAB_DENSITY_CPU_REPORT: REPORT_PATH,
    },
    stderr: 'pipe',
    stdout: 'pipe',
  },
);

if (!result.success) {
  const output = [new TextDecoder().decode(result.stdout), new TextDecoder().decode(result.stderr)]
    .join('\n')
    .split('\n')
    .filter(Boolean)
    .slice(-30)
    .join('\n');
  throw new Error(`Negative Lab density CPU Rust proof failed:\n${output}`);
}

const report = reportSchema.parse(JSON.parse(await readFile(REPORT_PATH, 'utf8')));
const reportJson = `${JSON.stringify(report, null, 2)}\n`;

if (shouldUpdate) {
  await Bun.write(COMMITTED_REPORT_PATH, reportJson);
  console.log('negative lab density cpu proof updated');
  process.exit(0);
}

const committedReport = reportSchema.parse(JSON.parse(await readFile(COMMITTED_REPORT_PATH, 'utf8')));
if (JSON.stringify(committedReport) !== JSON.stringify(report)) {
  throw new Error(
    `Negative Lab density CPU proof is stale. Run bun scripts/check-negative-lab-density-cpu.ts --update`,
  );
}

console.log(`negative lab density cpu ok (${report.changedPixelCount} pixels, ${report.artifactHash})`);
