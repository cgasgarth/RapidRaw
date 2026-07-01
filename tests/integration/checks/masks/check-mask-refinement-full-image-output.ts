#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { z } from 'zod';

const GENERATED_REPORT_PATH = resolve('src-tauri/target/rawengine-mask-refinement-full-image-output-report.json');
const COMMITTED_REPORT_PATH =
  'docs/validation/proofs/layers-masks/mask-refinement-full-image-output-proof-2026-07-01.json';
const update = process.argv.includes('--update');

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const boolMetricSchema = z.object({ passed: z.boolean(), threshold: z.number(), value: z.number() }).strict();

const refinementSchema = z
  .object({
    density: z.number().min(0).max(1),
    edgeContrast: z.number().min(0).max(1),
    edgeShiftPx: z.number().min(-512).max(512),
    featherPx: z.number().min(0).max(4096),
    hairDetail: z.number().min(0).max(1),
    smoothness: z.number().min(0).max(1),
  })
  .strict();

const variantSchema = z
  .object({
    affectedPixelRatio: z.number().gt(0),
    alphaDecisiveness: z.number().min(0).max(1),
    edgeSpread: z.number().min(0).max(1),
    finiteMetrics: z.literal(true),
    id: z.string().min(1),
    maskCoverageRatio: z.number().gt(0).max(1),
    maskHash: sha256Schema,
    maskKind: z.enum(['brush', 'radial']),
    outputHash: sha256Schema,
    outputMeanAbsDelta: z.number().gt(0),
    outputPath: z.nullable(z.string()),
    parameterFocus: z.string().min(1),
    refinement: refinementSchema,
  })
  .strict();

const reportSchema = z
  .object({
    artifacts: z.array(
      z
        .object({
          hash: sha256Schema,
          kind: z.string().min(1),
          path: z.string().min(1),
          publicRepoAllowed: z.boolean(),
        })
        .strict(),
    ),
    fixtureId: z.literal('validation.mask-refinement.full-image.synthetic.v1'),
    generatedAt: z.iso.datetime(),
    issue: z.literal(4661),
    proofClaims: z
      .object({
        doesNotProve: z.array(z.string().min(1)).min(3),
        proves: z.array(z.string().min(1)).min(4),
      })
      .strict(),
    reportId: z.literal('mask-refinement.full-image.synthetic.v1'),
    runtimeProof: z
      .object({
        execution: z.literal('tauri_test_gpu_pipeline'),
        maskPath: z.literal('prepare_export_masks + generate_mask_bitmap'),
        outputArtifactCount: z.number().int().positive(),
        rawDecodePath: z.literal('synthetic_fixture_builder'),
        renderPath: z.literal('process_image_for_export_pipeline_with_tonemapper_override'),
      })
      .strict(),
    source: z
      .object({
        hash: sha256Schema,
        isRaw: z.literal(false),
        kind: z.literal('synthetic_composite_fixture_v1'),
        path: z.literal('synthetic://mask-refinement/full-image/v1'),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      })
      .strict(),
    summary: z
      .object({
        baselineBrushOutputHash: sha256Schema,
        baselineRadialOutputHash: sha256Schema,
        baselineUnmaskedOutputHash: sha256Schema,
        densityResponseRatio: boolMetricSchema,
        edgeContrastResponse: boolMetricSchema,
        edgeShiftDirection: z
          .object({
            erodeCoverageDelta: z.number(),
            erodePassed: z.literal(true),
            expandCoverageDelta: z.number(),
            expandPassed: z.literal(true),
          })
          .strict(),
        featherEdgeSpreadGain: boolMetricSchema,
        noNanOrInfInvariant: z.literal(true),
        sourceHashUnchanged: z.literal(true),
        staticFallbackChangedPixelRatio: boolMetricSchema,
        smoothnessResponse: boolMetricSchema,
        uniqueOutputHashCount: z.number().int().min(8),
      })
      .strict(),
    validationMode: z.literal('synthetic_mask_refinement_full_image_output_runtime_proof'),
    variants: z.array(variantSchema).length(9),
  })
  .strict()
  .superRefine((report, context) => {
    const ids = new Set(report.variants.map((variant) => variant.id));
    for (const expectedId of [
      'brush-baseline',
      'brush-feather',
      'brush-density',
      'brush-edge-shift-expand',
      'brush-edge-shift-erode',
      'brush-smoothness',
      'brush-edge-contrast',
      'radial-baseline',
      'radial-feather',
    ]) {
      if (!ids.has(expectedId)) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: `Missing variant ${expectedId}.` });
      }
    }

    if (!report.proofClaims.proves.includes('refinement_control_directionality')) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Missing refinement directionality proof claim.' });
    }
    if (!report.proofClaims.proves.includes('static_mask_refinement_fallback_changes_pixels')) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Missing static fallback proof claim.' });
    }

    const baselineBrush = report.variants.find((variant) => variant.id === 'brush-baseline');
    const density = report.variants.find((variant) => variant.id === 'brush-density');
    const feather = report.variants.find((variant) => variant.id === 'brush-feather');
    const smooth = report.variants.find((variant) => variant.id === 'brush-smoothness');
    const contrast = report.variants.find((variant) => variant.id === 'brush-edge-contrast');
    const radial = report.variants.find((variant) => variant.id === 'radial-baseline');
    if (!baselineBrush || !density || !feather || !smooth || !contrast || !radial) return;

    if (density.outputMeanAbsDelta >= baselineBrush.outputMeanAbsDelta) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Lower density must reduce output delta.' });
    }
    if (feather.edgeSpread <= baselineBrush.edgeSpread) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Feathering must increase edge spread.' });
    }
    if (smooth.alphaDecisiveness <= baselineBrush.alphaDecisiveness) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Smoothness must increase alpha decisiveness.' });
    }
    if (contrast.edgeSpread >= baselineBrush.edgeSpread) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Edge contrast must reduce transition spread.' });
    }
    if (radial.affectedPixelRatio <= 0.01) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Static fallback must change rendered pixels.' });
    }
  });

const result = Bun.spawnSync(
  [
    'rustup',
    'run',
    '1.95.0',
    'cargo',
    'test',
    'synthetic_runtime_generates_mask_refinement_full_image_output_report_when_enabled',
    '--locked',
    '--no-default-features',
    '--features',
    'required-ci,tauri-test',
    '--quiet',
  ],
  {
    cwd: 'src-tauri',
    env: {
      ...process.env,
      RAWENGINE_MASK_REFINEMENT_FULL_IMAGE_REPORT: GENERATED_REPORT_PATH,
      RAWENGINE_RUN_MASK_REFINEMENT_FULL_IMAGE_PROOF: '1',
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
    .slice(-40)
    .join('\n');
  throw new Error(`Mask refinement full-image Rust proof failed:\n${output}`);
}

const report = reportSchema.parse(JSON.parse(await readFile(GENERATED_REPORT_PATH, 'utf8')));
const reportJson = `${JSON.stringify(report, null, 2)}\n`;

if (update) {
  await Bun.write(COMMITTED_REPORT_PATH, reportJson);
  console.log('mask refinement full-image output proof updated');
  process.exit(0);
}

const committedReport = reportSchema.parse(JSON.parse(await readFile(COMMITTED_REPORT_PATH, 'utf8')));
if (JSON.stringify(normalizeReport(committedReport)) !== JSON.stringify(normalizeReport(report))) {
  throw new Error(
    'Mask refinement full-image output proof is stale. Run bun tests/integration/checks/masks/check-mask-refinement-full-image-output.ts --update',
  );
}

console.log(`mask refinement full-image output proof ok (${report.summary.uniqueOutputHashCount} unique outputs)`);

function normalizeReport(value: z.infer<typeof reportSchema>) {
  return {
    ...value,
    generatedAt: '<normalized>',
  };
}
