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

const sourcePanel = await readFile('src/components/panel/editor/ImageCanvas.tsx', 'utf8');
for (const marker of [
  'data-testid="image-canvas-brush-command-capture"',
  'data-brush-command-type={lastBrushCommandCapture?.commandType',
  'data-brush-command-coordinate-space={lastBrushCommandCapture?.coordinateSpace',
  'data-testid="image-canvas-retouch-handles"',
  'data-retouch-handle-mode-label={retouchModeLabel}',
  'data-testid="image-canvas-retouch-source-label"',
  'data-testid="image-canvas-retouch-target-label"',
  'data-testid="image-canvas-retouch-click-target"',
  'data-retouch-canvas-click-target="source-or-target"',
  'data-retouch-canvas-click-source-modifier="Alt"',
  'data-retouch-canvas-handle="sourcePoint"',
  'data-retouch-canvas-handle="targetPoint"',
  'text={`${retouchModeLabel} S`}',
  'text={`${retouchModeLabel} T`}',
  'data-testid="image-canvas-remove-handles"',
  'data-testid="image-canvas-remove-click-target"',
  'data-remove-canvas-click-target="target"',
  'getRemoveCanvasStatusColor(activeRemoveSource.status)',
  'data-remove-handle-status-color={removeStatusColor}',
  'data-remove-handle-status={activeRemoveSource.status ??',
  'data-remove-handle-status-label={removeStatusLabel}',
  'data-remove-handle-source-resolved={String(activeRemoveSource.resolvedSourcePoint !== undefined)}',
  'data-remove-handle-resolved-source-x={activeRemoveSource.resolvedSourcePoint?.x ??',
  'data-testid="image-canvas-remove-status-label"',
  'data-remove-canvas-status={removeStatus}',
  'data-remove-canvas-source-resolved={String(resolvedSourcePoint !== null)}',
  "text={`${t('editor.layers.removeSource.title')} - ${removeStatusLabel}`}",
  'handleRemoveTargetDragEnd(activeRemoveLayer.id, activeRemoveSource, event)',
  'handleRemoveTargetDragMove(activeRemoveLayer.id, activeRemoveSource, event)',
  'handleRemoveCanvasClick(activeRemoveLayer.id, activeRemoveSource, event)',
  "status: 'needs_regeneration'",
  'delete retouchRemoveSource.resolvedSourcePoint',
  'data-retouch-handle-radius-px={activeRetouchSource.radiusPx ??',
  'data-retouch-handle-feather-radius-px={activeRetouchSource.featherRadiusPx ??',
  'const retouchRadius = (activeRetouchSource.radiusPx ?? 0) * imageRenderSize.scale',
  'const retouchFeatherRadius =',
  'data-retouch-handle-source-x={activeRetouchSource.sourcePoint.x}',
  "handle === 'targetPoint'",
  'centerX: point.x * effectiveImageDimensions.width',
  'centerY: point.y * effectiveImageDimensions.height',
  "handleRetouchHandleDragEnd(activeRetouchLayer.id, 'sourcePoint', event)",
  "handleRetouchHandleDragEnd(activeRetouchLayer.id, 'targetPoint', event)",
  "handleRetouchHandleDragMove(activeRetouchLayer.id, 'sourcePoint', event)",
  "handleRetouchHandleDragMove(activeRetouchLayer.id, 'targetPoint', event)",
  'handleRetouchCanvasClick(activeRetouchLayer.id, event)',
  "event.evt.altKey ? 'sourcePoint' : 'targetPoint'",
  'updateRetouchHandlePoint(layerId, handle, point)',
  'recordBrushMaskCommandCapture(activeId, activeSubMask, nextParameters)',
  'buildBrushMaskCommandFromParameters(',
]) {
  if (!sourcePanel.includes(marker)) {
    throw new Error(`Brush command capture UI missing marker: ${marker}`);
  }
}

const capturedParameters = {
  lines: [
    {
      brushSize: 80,
      feather: 0.35,
      flow: 75,
      points: [
        { x: 256, y: 384 },
        { x: 768, y: 384 },
      ],
      tool: 'brush',
    },
  ],
};

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
if (stroke.mode !== 'paint' || stroke.radiusPx !== 40 || stroke.hardness !== 0.65 || stroke.flow !== 0.75) {
  throw new Error('Brush capture command did not preserve brush size, feather, flow, and mode.');
}
if ('pressure' in (stroke.points[0] ?? {})) {
  throw new Error('Mouse brush capture must omit pressure when the input does not provide genuine pen pressure.');
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
    'paint/erase mode, feather-derived hardness, radius, and flow are command fields',
    'mouse capture omits pressure unless real pen pressure is supplied',
    'dry-run must precede apply',
  ],
  coordinateSpace: BRUSH_MASK_COMMAND_COORDINATE_SPACE,
  dryRunMaskHash: dryRunResult.maskArtifacts[0]?.contentHash,
  issue: 2888,
  renderMaskHash: render.contentHash,
  schemaVersion: 1,
  strokeCount: dryRunCommand.parameters.strokes.length,
  uiMarkers: ['image-canvas-brush-command-capture', 'recordBrushMaskCommandCapture', 'layerMask.createBrushMask'],
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
