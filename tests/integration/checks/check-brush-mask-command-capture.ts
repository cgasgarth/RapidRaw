#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

import { z } from 'zod';

import {
  BrushMaskCommandRuntime,
  renderBrushMask,
} from '../../../packages/rawengine-schema/src/brushMaskCommandRuntime.ts';
import {
  layerMaskCommandEnvelopeV1Schema,
  layerMaskDryRunResultV1Schema,
  layerMaskMutationResultV1Schema,
} from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import { appendBrushStroke } from '../../../src/utils/brushMaskParameters.ts';
import {
  BRUSH_MASK_COMMAND_COORDINATE_SPACE,
  buildBrushMaskCommandFromParameters,
  brushMaskCommandEnvelopeSchema,
} from '../../../src/utils/brushMaskCommandBridge.ts';

const REPORT_PATH = 'docs/validation/brush-mask-command-capture-2026-06-21.json';
const UPDATE_REPORT = process.argv.includes('--update');

const reportSchema = z
  .object({
    appliedGraphRevision: z.string().min(1),
    commandHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    commandType: z.literal('layerMask.createBrushMask'),
    consultApplied: z.array(z.string().min(1)).min(1),
    coordinateSpace: z.literal(BRUSH_MASK_COMMAND_COORDINATE_SPACE),
    dryRunMaskHash: z.string().min(1),
    issue: z.literal(2888),
    renderMaskHash: z.string().min(1),
    schemaVersion: z.literal(1),
    strokeCount: z.literal(1),
    uiMarkers: z.array(z.string().min(1)).min(1),
    validationMode: z.literal('brush_mask_ui_capture_to_typed_command_runtime_proof'),
  })
  .strict();

const sourcePanel = await readFile('src/components/panel/right/MasksPanel.tsx', 'utf8');
for (const marker of [
  'data-testid="brush-mask-command-capture-status"',
  'data-testid="brush-mask-capture-stroke-command"',
  'data-command-type="layerMask.createBrushMask"',
  'data-coordinate-space={coordinateSpace}',
  'appendBrushStroke(activeSubMask.parameters',
  'buildBrushMaskCommandFromParameters(',
]) {
  if (!sourcePanel.includes(marker)) {
    throw new Error(`Brush command capture UI missing marker: ${marker}`);
  }
}

const capturedParameters = appendBrushStroke(
  { lines: [] },
  {
    feather: 35,
    points: [
      { pressure: 0.6, x: 256, y: 384 },
      { pressure: 0.9, x: 768, y: 384 },
    ],
    size: 80,
    tool: 'brush',
  },
);

const context = {
  expectedGraphRevision: 'graph_rev_brush_capture_source',
  imagePath: '/validation/brush-mask-capture-ui.raw',
  imageSize: { height: 768, width: 1024 },
  maskId: 'mask_brush_capture',
  maskName: 'Brush Capture',
  operationId: 'capture_001',
  sessionId: 'brush-capture-proof',
};

const dryRunCommand = buildBrushMaskCommandFromParameters(capturedParameters, context, { dryRun: true });
const applyCommand = buildBrushMaskCommandFromParameters(capturedParameters, context, { dryRun: false });
brushMaskCommandEnvelopeSchema.parse(dryRunCommand);
layerMaskCommandEnvelopeV1Schema.parse(dryRunCommand);
layerMaskCommandEnvelopeV1Schema.parse(applyCommand);

const stroke = dryRunCommand.parameters.strokes[0];
if (stroke === undefined) throw new Error('Brush capture command requires one stroke.');
if (stroke.points[0]?.x !== 0.25 || stroke.points[1]?.x !== 0.75 || stroke.points[0]?.y !== 0.5) {
  throw new Error('Brush capture command did not normalize image coordinates.');
}
if (stroke.mode !== 'paint' || stroke.radiusPx !== 40 || stroke.hardness !== 0.65) {
  throw new Error('Brush capture command did not preserve brush size, feather, and mode.');
}
if (stroke.points[0]?.pressure !== 0.6 || stroke.points[1]?.pressure !== 0.9) {
  throw new Error('Brush capture command did not preserve pressure values.');
}

const runtime = new BrushMaskCommandRuntime();
const baseMask = {
  alpha: new Array<number>(15).fill(0),
  height: 3,
  maskId: context.maskId,
  width: 5,
};
const renderRequest = { baseMask, height: 3, width: 5 };
const render = renderBrushMask({ ...renderRequest, command: dryRunCommand });
const dryRunResult = layerMaskDryRunResultV1Schema.parse(runtime.dispatch(dryRunCommand, renderRequest));
const applyResult = layerMaskMutationResultV1Schema.parse(runtime.dispatch(applyCommand, renderRequest));

const report = reportSchema.parse({
  appliedGraphRevision: applyResult.appliedGraphRevision,
  commandHash: hashJson(dryRunCommand),
  commandType: dryRunCommand.commandType,
  consultApplied: [
    'captured points normalize into image-relative command coordinates',
    'paint/erase mode, feather-derived hardness, radius, flow, and pressure are command fields',
    'dry-run must precede apply',
  ],
  coordinateSpace: BRUSH_MASK_COMMAND_COORDINATE_SPACE,
  dryRunMaskHash: dryRunResult.maskArtifacts[0]?.contentHash,
  issue: 2888,
  renderMaskHash: render.contentHash,
  schemaVersion: 1,
  strokeCount: dryRunCommand.parameters.strokes.length,
  uiMarkers: ['brush-mask-command-capture-status', 'brush-mask-capture-stroke-command', 'layerMask.createBrushMask'],
  validationMode: 'brush_mask_ui_capture_to_typed_command_runtime_proof',
});

if (report.dryRunMaskHash !== report.renderMaskHash) {
  throw new Error('Brush dry-run artifact hash does not match rendered mask hash.');
}
if (!applyResult.changedMaskIds.includes(render.maskId)) {
  throw new Error('Brush apply did not mutate the rendered mask id.');
}

const reportText = `${JSON.stringify(report, null, 2)}\n`;
if (UPDATE_REPORT) {
  await writeFile(REPORT_PATH, reportText);
} else {
  const expected = reportSchema.parse(JSON.parse(await readFile(REPORT_PATH, 'utf8')));
  if (JSON.stringify(expected) !== JSON.stringify(report)) {
    throw new Error(`${REPORT_PATH} is stale; run bun run check:brush-mask-command-capture:update.`);
  }
}

console.log('brush mask command capture ok (ui -> command -> runtime)');

function hashJson(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}
