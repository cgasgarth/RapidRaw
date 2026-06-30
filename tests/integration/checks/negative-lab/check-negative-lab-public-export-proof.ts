#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { z } from 'zod';

const GENERATED_REPORT_PATH = resolve('src-tauri/target/rawengine-negative-lab-public-export-report.json');
const COMMITTED_REPORT_PATH = 'docs/validation/proofs/negative-lab/negative-lab-public-export-proof-2026-06-20.json';
const update = process.argv.includes('--update');

const fnvHashSchema = z.string().regex(/^fnv1a64:[a-f0-9]{16}$/u);
const fnv32HashSchema = z.string().regex(/^fnv1a32:[a-f0-9]{8}$/u);
const f32Literal = (expected: number) =>
  z.number().refine((actual) => Math.abs(actual - expected) < 0.000001, {
    message: `Expected approximately ${expected}.`,
  });
const baseFogSampleRectSchema = z
  .object({
    height: z.number().positive().max(1),
    width: z.number().positive().max(1),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
  })
  .strict();
const baseFogCandidateSchema = z
  .object({
    baseDensity: z.array(z.number().nonnegative()).length(3),
    baseRgb: z.array(z.number().min(0).max(1)).length(3),
    blueWeight: z.number().min(0.5).max(2),
    channelCastRatio: z.number().min(1).max(1.5),
    confidence: z.number().min(0.01).max(1),
    greenWeight: z.number().min(0.5).max(2),
    redWeight: z.number().min(0.5).max(2),
    sampleRect: baseFogSampleRectSchema,
    score: z.number(),
    source: z.enum(['left_edge_border', 'right_edge_border', 'top_edge_border', 'bottom_edge_border']),
    warnings: z.array(z.enum(['low_base_estimate_confidence', 'strong_channel_cast_candidate'])),
  })
  .strict();
const appliedProfileSchema = z
  .object({
    claimLevel: z.literal('generic_starting_point_only'),
    claimPolicy: z.literal('generic_starting_point_no_stock_claim'),
    displayName: z.literal('C-41 Portrait'),
    doesNotProve: z
      .array(
        z.enum([
          'no_named_stock_emulation_claim',
          'no_colorimetric_match_claim',
          'not_measured_from_manufacturer_profile',
        ]),
      )
      .length(3),
    params: z
      .object({
        base_fog_sample: baseFogSampleRectSchema,
        base_fog_strength: f32Literal(1),
        blue_weight: z.number().min(0.5).max(2),
        contrast: f32Literal(0.95),
        exposure: f32Literal(0.05),
        green_weight: z.number().min(0.5).max(2),
        red_weight: z.number().min(0.5).max(2),
      })
      .strict(),
    presetId: z.literal('negative_lab.generic.c41.portrait.v1'),
    processFamily: z.literal('c41_color_negative'),
    profileProvenanceHash: fnv32HashSchema,
    runtimeStatus: z.literal('runtime_parameter_applied'),
    stockFamilyDescriptor: z.literal('Soft portrait color negative'),
  })
  .strict();

const reportSchema = z
  .object({
    algorithm: z.literal('density_rgb_v1'),
    appliedProfile: appliedProfileSchema,
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
    controlSurface: z
      .object({
        baseFog: z
          .object({
            sampleRect: baseFogSampleRectSchema,
            strength: f32Literal(1),
          })
          .strict(),
        density: z
          .object({
            blueWeight: z.number().min(0.5).max(2),
            contrast: f32Literal(0.95),
            exposure: f32Literal(0.05),
            greenWeight: z.number().min(0.5).max(2),
            redWeight: z.number().min(0.5).max(2),
          })
          .strict(),
        export: z
          .object({
            acceptedDryRunPlanHash: z.literal('fnv1a32:2f4a91bc'),
            acceptedDryRunPlanId: z.literal('negative_lab_batch_plan_2f4a91bc'),
            conversionBundle: z.literal(true),
            outputFormat: z.literal('jpeg_proof'),
            profileProvenanceHash: fnv32HashSchema,
            suffix: z.literal('Positive'),
          })
          .strict(),
        preset: z
          .object({
            claimPolicy: z.literal('generic_starting_point_no_stock_claim'),
            displayName: z.literal('C-41 Portrait'),
            presetId: z.literal('negative_lab.generic.c41.portrait.v1'),
            processFamily: z.literal('c41_color_negative'),
          })
          .strict(),
      })
      .strict(),
    inputToOutputMeanAbsDelta: z.number().gt(0.01),
    issue: z.literal(4398),
    metrics: z
      .object({
        autoBaseConfidence: z.number().gt(0.01).max(1),
        baseFogSampleSource: z.enum(['left_edge_border', 'right_edge_border', 'top_edge_border', 'bottom_edge_border']),
        channelCastRatio: z.number().min(1).max(1.5),
        changedPixelRatio: z.number().gt(0.05),
        inputToOutputMeanAbsDelta: z.number().gt(0.01),
        meanInputOutputDelta: z.number().gt(0.01),
        previewAfterHash: fnvHashSchema,
        previewBeforeHash: fnvHashSchema,
        previewChanged: z.literal(true),
        rankedBaseFogCandidates: z.array(baseFogCandidateSchema).min(4),
        sampleRect: baseFogSampleRectSchema,
        sampleSource: z.enum(['left_edge_border', 'right_edge_border', 'top_edge_border', 'bottom_edge_border']),
        savedOutputExists: z.literal(true),
        savedOutputPath: z.literal(
          'src-tauri/target/negative-lab-public-export-proof/110-format-ericht-negative-cc0-320-Positive.jpg',
        ),
        warnings: z.array(z.enum(['low_base_estimate_confidence', 'strong_channel_cast_candidate'])),
      })
      .strict()
      .superRefine((metrics, context) => {
        if (metrics.previewBeforeHash === metrics.previewAfterHash) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Preview hash must change after auto base estimation.',
          });
        }
        if (metrics.baseFogSampleSource !== metrics.sampleSource) {
          context.addIssue({ code: z.ZodIssueCode.custom, message: 'Base fog sample source aliases must match.' });
        }
        const selected = metrics.rankedBaseFogCandidates[0];
        if (selected.source !== metrics.sampleSource) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Top ranked base fog candidate must be the saved sample source.',
          });
        }
      }),
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
    conversionBundle: z
      .object({
        contentHash: fnvHashSchema,
        path: z.literal(
          'src-tauri/target/negative-lab-public-export-proof/110-format-ericht-negative-cc0-320-Positive.jpg.conversion-bundle.json',
        ),
        schemaVersion: z.literal(1),
      })
      .strict(),
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
    'Negative Lab public export proof is stale. Run bun tests/integration/checks/negative-lab/check-negative-lab-public-export-proof.ts --update',
  );
}

console.log(`negative lab public export ok (${report.output.format}, ${report.output.contentHash})`);
