#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { z } from 'zod';

const GENERATED_REPORT_PATH = resolve('src-tauri/target/rawengine-negative-lab-public-export-report.json');
const COMMITTED_REPORT_PATH = 'docs/validation/negative-lab-public-export-proof-2026-06-20.json';
const update = process.argv.includes('--update');

const fnvHashSchema = z.string().regex(/^fnv1a64:[a-f0-9]{16}$/u);

const reportSchema = z
  .object({
    algorithm: z.literal('density_rgb_v1'),
    doesNotProve: z
      .array(
        z.enum([
          'camera_raw_decode_path',
          'capture_one_class_quality',
          'commercial_converter_parity',
          'full_macos_app_manual_session',
          'icc_colorimetric_accuracy',
          'raw_scan_input',
          'stock_library_maturity',
        ]),
      )
      .min(7),
    fixtureId: z.literal('negative_lab.real.public.cc0_110_ericht_negative_001'),
    inputToOutputMeanAbsDelta: z.number().gt(0.01),
    issue: z.literal(2311),
    metrics: z
      .object({
        changedPixelRatio: z.number().gt(0.05),
        inputToOutputMeanAbsDelta: z.number().gt(0.01),
      })
      .strict(),
    output: z
      .object({
        contentHash: fnvHashSchema,
        dimensions: z.object({ height: z.number().int().positive(), width: z.number().int().positive() }).strict(),
        format: z.literal('jpeg_proof'),
        path: z.literal(
          'src-tauri/target/negative-lab-public-export-proof/110-format-ericht-negative-cc0-320-Positive.jpg',
        ),
      })
      .strict(),
    runtimeStatus: z.literal('public_negative_scan_positive_export_rendered'),
    schemaVersion: z.literal(1),
    sidecar: z
      .object({
        containsNegativeLabArtifact: z.literal(true),
        path: z.literal(
          'src-tauri/target/negative-lab-public-export-proof/110-format-ericht-negative-cc0-320-Positive.jpg.rrdata',
        ),
        runtimeGeneratedIds: z.literal(true),
      })
      .strict(),
    source: z
      .object({
        license: z.literal('CC0 public fixture'),
        manifest: z.literal('fixtures/negative-lab/public/110-format-ericht-negative-cc0-samples.json'),
        path: z.literal('fixtures/negative-lab/public/110-format-ericht-negative-cc0-320.jpg'),
        sha256: z.literal('sha256:f0913770ce2ec72f2261d6cc0948091e3224d11904049727a42beb864ef5673b'),
      })
      .strict(),
  })
  .strict();

const result = Bun.spawnSync(
  [
    'rustup',
    'run',
    '1.95.0',
    'cargo',
    'test',
    'negative_lab_public_scan_exports_positive_report_when_enabled',
    '--quiet',
  ],
  {
    cwd: 'src-tauri',
    env: {
      ...process.env,
      RAWENGINE_NEGATIVE_LAB_PUBLIC_EXPORT_REPORT: GENERATED_REPORT_PATH,
      RAWENGINE_RUN_NEGATIVE_LAB_PUBLIC_EXPORT_PROOF: '1',
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
  throw new Error(`Negative Lab public export Rust proof failed:\n${output}`);
}

const report = reportSchema.parse(JSON.parse(await readFile(GENERATED_REPORT_PATH, 'utf8')));
const reportJson = `${JSON.stringify(report, null, 2)}\n`;

if (update) {
  await Bun.write(COMMITTED_REPORT_PATH, reportJson);
  console.log('negative lab public export proof updated');
  process.exit(0);
}

const committedReport = reportSchema.parse(JSON.parse(await readFile(COMMITTED_REPORT_PATH, 'utf8')));
if (JSON.stringify(committedReport) !== JSON.stringify(report)) {
  throw new Error(
    'Negative Lab public export proof is stale. Run bun tests/integration/checks/check-negative-lab-public-export-proof.ts --update',
  );
}

console.log(`negative lab public export ok (${report.output.format}, ${report.output.contentHash})`);
