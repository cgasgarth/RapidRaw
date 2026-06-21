#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

import { z } from 'zod';

import {
  BrushMaskCommandRuntime,
  renderBrushMask,
} from '../../../packages/rawengine-schema/src/brushMaskCommandRuntime.ts';
import { layerMaskCommandEnvelopeV1Schema } from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import { sampleLayerMaskRefineCommandEnvelopeV1 } from '../../../packages/rawengine-schema/src/samplePayloads.ts';

const REPORT_PATH = 'docs/validation/brush-mask-refine-workflow-e2e-2026-06-21.json';
const RUNTIME_REPORT_PATH = 'docs/validation/layer-mask-real-raw-proof-2026-06-18.json';
const SCREENSHOT_PATH = 'artifacts/visual-smoke/layer-mask-private-raw-ui.png';
const FIXTURE_ID = 'validation.layer-mask-real-raw.alaska-local-adjustment.v1';
const update = process.argv.includes('--update');

const hashSchema = z.string().regex(/^(fnv1a32:[a-f0-9]{8}|sha256:[a-f0-9]{64})$/u);
const reportSchema = z
  .object({
    brushCommandType: z.literal('layerMask.createBrushMask'),
    brushRuntime: z
      .object({
        appliedGraphRevision: z.string().min(1),
        dryRunMaskHash: hashSchema,
        mutationMaskHash: hashSchema,
        renderedMaskChanged: z.literal(true),
      })
      .strict(),
    fixtureId: z.literal(FIXTURE_ID),
    issue: z.literal(2887),
    privateRawRuntime: z
      .object({
        metricCount: z.number().int().min(5),
        provesMaskRefinementChangesPixels: z.literal(true),
        runtimeReportPath: z.literal(RUNTIME_REPORT_PATH),
      })
      .strict(),
    refineCommandType: z.literal('layerMask.refineMask'),
    refinement: z
      .object({
        density: z.number().min(0).max(1),
        edgeContrast: z.number().min(0).max(1),
        edgeShiftPx: z.number(),
        featherPx: z.number().min(0),
        smoothness: z.number().min(0).max(1),
      })
      .strict(),
    schemaVersion: z.literal(1),
    validationBoundary: z.literal('runtime_brush_refine_plus_private_raw_ui_smoke_not_manual_macos_session'),
    visualSmoke: z
      .object({
        brushCommandType: z.literal('layerMask.createBrushMask'),
        refineCommandType: z.literal('layerMask.refineMask'),
        screenshotHash: hashSchema,
        screenshotPath: z.literal(SCREENSHOT_PATH),
      })
      .strict(),
  })
  .strict();

const brushCommand = layerMaskCommandEnvelopeV1Schema.parse({
  actor: {
    id: 'rawengine-ui',
    kind: 'ui',
    sessionId: 'brush-mask-refine-e2e',
  },
  approval: {
    approvalClass: 'preview_only',
    reason: 'Preview brush mask before applying refinement.',
    state: 'not_required',
  },
  commandId: 'command_brush_mask_refine_e2e_preview',
  commandType: 'layerMask.createBrushMask',
  correlationId: 'corr_brush_mask_refine_e2e',
  dryRun: true,
  expectedGraphRevision: 'graph_rev_brush_refine_e2e',
  idempotencyKey: 'idem_brush_mask_refine_e2e_preview',
  parameters: {
    maskName: 'Refine E2E Brush Mask',
    strokes: [
      {
        flow: 0.82,
        hardness: 0.58,
        mode: 'paint',
        points: [
          { x: 0.28, y: 0.32 },
          { x: 0.54, y: 0.49 },
          { x: 0.72, y: 0.62 },
        ],
        radiusPx: 16,
        strokeId: 'stroke_brush_refine_e2e_001',
      },
    ],
  },
  schemaVersion: 1,
  target: {
    imagePath: '/private-fixtures/layers/alaska-layer-mask-v1.arw',
    kind: 'image',
  },
});

if (brushCommand.commandType !== 'layerMask.createBrushMask') {
  throw new Error(`Expected brush mask command, received ${brushCommand.commandType}`);
}

const runtime = new BrushMaskCommandRuntime();
const dryRun = runtime.dispatch(brushCommand, { height: 96, width: 128 });
if (!('maskArtifacts' in dryRun)) {
  throw new Error(`Expected brush dry-run artifacts, received ${dryRun.status}`);
}
const applyCommand = layerMaskCommandEnvelopeV1Schema.parse({
  ...brushCommand,
  approval: {
    approvalClass: 'edit_apply',
    reason: 'Apply brush mask after preview acceptance.',
    state: 'approved',
  },
  commandId: 'command_brush_mask_refine_e2e_apply',
  dryRun: false,
  idempotencyKey: 'idem_brush_mask_refine_e2e_apply',
});
if (applyCommand.commandType !== 'layerMask.createBrushMask') {
  throw new Error(`Expected brush apply command, received ${applyCommand.commandType}`);
}
const mutation = runtime.dispatch(applyCommand, { height: 96, width: 128 });
if (!('appliedGraphRevision' in mutation)) {
  throw new Error(`Expected brush apply mutation, received ${mutation.status}`);
}
const renderedMask = renderBrushMask({ command: brushCommand, height: 96, width: 128 });
const runtimeReport = z
  .object({
    metrics: z.array(z.object({ name: z.string(), passed: z.literal(true), value: z.number() })).min(5),
    proofClaims: z.object({ proves: z.array(z.string()) }),
  })
  .passthrough()
  .parse(JSON.parse(await readFile(RUNTIME_REPORT_PATH, 'utf8')));
const screenshotHash = `sha256:${createHash('sha256')
  .update(await readFile(SCREENSHOT_PATH))
  .digest('hex')}`;
const refineCommand = layerMaskCommandEnvelopeV1Schema.parse(sampleLayerMaskRefineCommandEnvelopeV1);
if (refineCommand.commandType !== 'layerMask.refineMask') {
  throw new Error(`Expected refine mask command, received ${refineCommand.commandType}`);
}

const expectedReport = reportSchema.parse({
  brushCommandType: brushCommand.commandType,
  brushRuntime: {
    appliedGraphRevision: mutation.appliedGraphRevision,
    dryRunMaskHash: dryRun.maskArtifacts[0]?.contentHash ?? '',
    mutationMaskHash: renderedMask.contentHash,
    renderedMaskChanged: renderedMask.alpha.some((value) => value > 0),
  },
  fixtureId: FIXTURE_ID,
  issue: 2887,
  privateRawRuntime: {
    metricCount: runtimeReport.metrics.length,
    provesMaskRefinementChangesPixels: runtimeReport.proofClaims.proves.includes('mask_refinement_changes_pixels'),
    runtimeReportPath: RUNTIME_REPORT_PATH,
  },
  refineCommandType: refineCommand.commandType,
  refinement: refineCommand.parameters.refinement,
  schemaVersion: 1,
  validationBoundary: 'runtime_brush_refine_plus_private_raw_ui_smoke_not_manual_macos_session',
  visualSmoke: {
    brushCommandType: 'layerMask.createBrushMask',
    refineCommandType: 'layerMask.refineMask',
    screenshotHash,
    screenshotPath: SCREENSHOT_PATH,
  },
});

if (update) {
  await writeFile(REPORT_PATH, `${JSON.stringify(expectedReport, null, 2)}\n`);
  console.log('brush mask refine workflow e2e updated');
  process.exit(0);
}

const actualReport = reportSchema.parse(JSON.parse(await readFile(REPORT_PATH, 'utf8')));
if (JSON.stringify(actualReport) !== JSON.stringify(expectedReport)) {
  throw new Error(`${REPORT_PATH} is stale; run bun ${import.meta.path} --update`);
}

console.log(`brush mask refine workflow e2e ok (${expectedReport.brushRuntime.mutationMaskHash})`);
