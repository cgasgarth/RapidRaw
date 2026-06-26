#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { access, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { z } from 'zod';

const REPORT_PATH = 'docs/validation/layer-mask-real-raw-proof-2026-06-18.json';
const PRIVATE_REPORT_PATH = 'private-artifacts/validation/layer-mask-real-raw/alaska-layer-mask-v1-report.json';
const FIXTURE_ID = 'validation.layer-mask-real-raw.alaska-local-adjustment.v1';
const REPORT_ID = 'layer-mask-real-raw.alaska-local-adjustment.v1';

const args = process.argv.slice(2);
const requireAssets = args.includes('--require-assets');
const outputPath = valueAfter('--output');
const rootPath = valueAfter('--root') ?? process.env.RAWENGINE_PRIVATE_RAW_ROOT;

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const privatePathSchema = z
  .string()
  .trim()
  .regex(/^(private-fixtures|private-artifacts)\//u);

const artifactSchema = z
  .object({
    hash: sha256Schema,
    kind: z.enum([
      'source_raw_private',
      'unmasked_preview_private',
      'unrefined_preview_private',
      'refined_preview_private',
      'refined_export_private',
      'workflow_report_private',
    ]),
    path: privatePathSchema,
    publicRepoAllowed: z.literal(false),
  })
  .strict();

const metricSchema = z
  .object({
    name: z.enum([
      'maskCoverageRatio',
      'maskedChangedPixelRatio',
      'refinementChangedPixelRatio',
      'boundaryFProxyImprovement',
      'areaDriftRatio',
      'haloWidthProxyReduction',
      'edgeColorContaminationProxyReduction',
      'previewExportMeanAbsDelta',
      'sourceHashUnchanged',
    ]),
    passed: z.literal(true),
    threshold: z.number().min(0),
    value: z.number().min(0),
  })
  .strict();

const proofClaimsSchema = z
  .object({
    doesNotProve: z.array(
      z.enum([
        'macos_app_ui_e2e_session',
        'manual_layer_panel_interaction',
        'annotated_hair_ground_truth_boundary_f',
        'public_raw_fixture_distribution',
      ]),
    ),
    proves: z.array(
      z.enum([
        'private_real_raw_decode',
        'layer_mask_generation',
        'masked_adjustment_changes_pixels',
        'mask_refinement_changes_pixels',
        'image_evidence_guided_refinement',
        'refined_preview_export_parity',
      ]),
    ),
  })
  .strict()
  .superRefine((claims, context) => {
    const requiredProofs = new Set([
      'private_real_raw_decode',
      'layer_mask_generation',
      'masked_adjustment_changes_pixels',
      'mask_refinement_changes_pixels',
      'image_evidence_guided_refinement',
      'refined_preview_export_parity',
    ]);
    for (const proof of requiredProofs) {
      if (!claims.proves.includes(proof)) {
        context.addIssue({ code: 'custom', message: `missing proof claim ${proof}`, path: ['proves'] });
      }
    }

    if (!claims.doesNotProve.includes('macos_app_ui_e2e_session')) {
      context.addIssue({
        code: 'custom',
        message: 'layer/mask proof must not claim macOS UI E2E without app evidence',
        path: ['doesNotProve'],
      });
    }
    if (!claims.doesNotProve.includes('annotated_hair_ground_truth_boundary_f')) {
      context.addIssue({
        code: 'custom',
        message: 'boundary-F proxy must not claim annotated hair ground truth',
        path: ['doesNotProve'],
      });
    }
  });

const runtimeProofSchema = z
  .looseObject({
    execution: z.literal('tauri_test_gpu_pipeline'),
    macosAppUiE2e: z.literal(false).optional(),
    macosAppUiE2E: z.literal(false).optional(),
    maskPath: z.literal('prepare_export_masks + generate_mask_bitmap'),
    outputArtifactCount: z.literal(4),
    previewExportParityMetric: z.literal('previewExportMeanAbsDelta'),
    rawDecodePath: z.literal('load_base_image_from_bytes'),
    renderPath: z.literal('process_image_for_export_pipeline_with_tonemapper_override'),
  })
  .superRefine((runtimeProof, context) => {
    if (runtimeProof.macosAppUiE2E !== false && runtimeProof.macosAppUiE2e !== false) {
      context.addIssue({
        code: 'custom',
        message: 'runtime proof must explicitly mark macOS app UI E2E as false',
        path: ['macosAppUiE2E'],
      });
    }
  });

const reportSchema = z
  .object({
    artifacts: z.array(artifactSchema).length(6),
    fixtureId: z.literal(FIXTURE_ID),
    generatedAt: z.iso.datetime(),
    issue: z.literal(2310),
    metrics: z.array(metricSchema).length(9),
    proofClaims: proofClaimsSchema,
    reportId: z.literal(REPORT_ID),
    runtimeProof: runtimeProofSchema,
    validationMode: z.literal('private_raw_tauri_runtime_proof'),
  })
  .strict()
  .superRefine((report, context) => {
    const artifactKinds = report.artifacts.map((artifact) => artifact.kind);
    if (new Set(artifactKinds).size !== artifactKinds.length) {
      context.addIssue({ code: 'custom', message: 'artifact kinds must be unique', path: ['artifacts'] });
    }
    const metricNames = report.metrics.map((metric) => metric.name);
    if (new Set(metricNames).size !== metricNames.length) {
      context.addIssue({ code: 'custom', message: 'metric names must be unique', path: ['metrics'] });
    }
    const metric = new Map(report.metrics.map((entry) => [entry.name, entry]));
    if ((metric.get('maskCoverageRatio')?.value ?? 0) <= 0.01) {
      context.addIssue({ code: 'custom', message: 'mask coverage must be non-trivial', path: ['metrics'] });
    }
    if ((metric.get('maskedChangedPixelRatio')?.value ?? 0) <= 0.01) {
      context.addIssue({ code: 'custom', message: 'mask must change rendered RAW pixels', path: ['metrics'] });
    }
    if ((metric.get('refinementChangedPixelRatio')?.value ?? 0) <= 0.0001) {
      context.addIssue({ code: 'custom', message: 'refinement controls must change output', path: ['metrics'] });
    }
    if ((metric.get('boundaryFProxyImprovement')?.value ?? 0) <= 0.000001) {
      context.addIssue({ code: 'custom', message: 'image-edge alignment must improve', path: ['metrics'] });
    }
    if ((metric.get('areaDriftRatio')?.value ?? Number.POSITIVE_INFINITY) > 0.05) {
      context.addIssue({ code: 'custom', message: 'refined mask area drift is too high', path: ['metrics'] });
    }
    if ((metric.get('haloWidthProxyReduction')?.value ?? 0) <= 0.000001) {
      context.addIssue({
        code: 'custom',
        message: 'refinement must reduce transition-width halo proxy',
        path: ['metrics'],
      });
    }
    if ((metric.get('edgeColorContaminationProxyReduction')?.value ?? 0) <= 0.000001) {
      context.addIssue({
        code: 'custom',
        message: 'refinement must reduce low-gradient transition contamination proxy',
        path: ['metrics'],
      });
    }
    if ((metric.get('previewExportMeanAbsDelta')?.value ?? Number.POSITIVE_INFINITY) > 0.015) {
      context.addIssue({ code: 'custom', message: 'preview/export parity exceeded threshold', path: ['metrics'] });
    }
  });

type LayerMaskRealRawProofReport = z.infer<typeof reportSchema>;

const reportSource = rootPath !== undefined ? join(rootPath, PRIVATE_REPORT_PATH) : REPORT_PATH;
if (requireAssets && rootPath === undefined) {
  fail('RAWENGINE_PRIVATE_RAW_ROOT or --root is required with --require-assets.');
}

const report = await loadReport(reportSource);
if (requireAssets && rootPath !== undefined) await verifyPrivateArtifacts(rootPath, report);
if (outputPath !== undefined) await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(`layer mask real RAW proof ok (${report.metrics.length} metrics)`);

async function verifyPrivateArtifacts(root: string, report: LayerMaskRealRawProofReport): Promise<void> {
  for (const artifact of report.artifacts) {
    const artifactPath = resolve(root, artifact.path);
    await access(artifactPath);
    const hash = `sha256:${createHash('sha256')
      .update(await readFile(artifactPath))
      .digest('hex')}`;
    if (hash !== artifact.hash) {
      fail(`${artifact.path}: expected ${artifact.hash}, got ${hash}.`);
    }
  }
}

function valueAfter(flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

async function loadReport(path: string): Promise<LayerMaskRealRawProofReport> {
  const raw = await readFile(path);
  const parsed = JSON.parse(raw.toString('utf8')) as { artifacts?: Array<{ hash?: string; kind?: string }> };
  const workflowArtifact = parsed.artifacts?.find((artifact) => artifact.kind === 'workflow_report_private');
  if (workflowArtifact !== undefined) {
    workflowArtifact.hash = `sha256:${createHash('sha256').update(raw).digest('hex')}`;
  }
  return reportSchema.parse(parsed);
}

function fail(message: string): never {
  console.error(`layer mask real RAW proof failed: ${message}`);
  process.exit(1);
}
