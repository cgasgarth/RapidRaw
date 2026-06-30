#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { z } from 'zod';

import {
  LinearGradientMaskCommandRuntime,
  renderLinearGradientMask,
} from '../../../packages/rawengine-schema/src/linearGradientMaskCommandRuntime.ts';
import {
  layerMaskDryRunResultV1Schema,
  layerMaskMutationResultV1Schema,
} from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import {
  buildLinearGradientMaskCommandFromParameters,
  LINEAR_GRADIENT_MASK_COMMAND_COORDINATE_SPACE,
} from '../../../src/utils/linearGradientMaskCommandBridge.ts';

const REPORT_PATH = 'docs/validation/proofs/layers-masks/linear-gradient-mask-apply-slice-2026-06-21.json';
const ARTIFACT_PATH = 'artifacts/validation/linear-gradient-mask-apply-slice.svg';
const update = process.argv.includes('--update');

const hashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const reportSchema = z
  .object({
    appliedGraphRevision: z.string().min(1),
    artifactHash: hashSchema,
    artifactPath: z.literal(ARTIFACT_PATH),
    commandType: z.literal('layerMask.createGradientMask'),
    coordinateSpace: z.literal(LINEAR_GRADIENT_MASK_COMMAND_COORDINATE_SPACE),
    dryRunMaskHash: z.string().regex(/^fnv1a32:[a-f0-9]{8}$/u),
    issue: z.literal(2877),
    localAdjustment: z
      .object({
        bottomMeanDelta: z.number().positive(),
        provesGradientWeightedEdit: z.literal(true),
        topMeanDelta: z.number().min(0),
      })
      .strict(),
    schemaVersion: z.literal(1),
    uiMarkers: z.array(z.string().min(1)).min(4),
    validationMode: z.literal('linear_gradient_mask_apply_ui_runtime_render_slice'),
  })
  .strict();

const sourcePanel = await readFile('src/components/panel/right/MasksPanel.tsx', 'utf8');
const sourceSubMaskFactory = await readFile('src/utils/editorSubMaskFactory.ts', 'utf8');
const uiMarkers = [
  'data-testid="linear-gradient-mask-controls"',
  'data-gradient-command-type="layerMask.createGradientMask"',
  'LINEAR_MASK_START_Y_FRACTION = 0.12',
  'LINEAR_MASK_END_Y_FRACTION = 0.72',
  'buildLinearGradientMaskCommandFromParameters',
];
for (const marker of uiMarkers) {
  const source =
    marker === 'buildLinearGradientMaskCommandFromParameters'
      ? await readFile('src/utils/linearGradientMaskCommandBridge.ts', 'utf8')
      : marker.startsWith('LINEAR_MASK_')
        ? sourceSubMaskFactory
        : sourcePanel;
  if (!source.includes(marker)) throw new Error(`Linear gradient UI marker missing: ${marker}`);
}

const imageSize = { height: 480, width: 640 };
const parameters = {
  endX: 320,
  endY: 346,
  imageHeight: imageSize.height,
  imageWidth: imageSize.width,
  range: 96,
  startX: 320,
  startY: 58,
};
const context = {
  expectedGraphRevision: 'graph_rev_linear_gradient_apply_slice',
  imagePath: '/private-fixtures/layers/alaska-layer-mask-v1.arw',
  imageSize,
  maskName: 'Linear Sky Balance',
  operationId: 'linear_gradient_apply_2877',
  sessionId: 'linear-gradient-mask-apply-slice',
};
const dryRunCommand = buildLinearGradientMaskCommandFromParameters(parameters, context, { dryRun: true });
const applyCommand = buildLinearGradientMaskCommandFromParameters(parameters, context, { dryRun: false });
const render = renderLinearGradientMask({ command: dryRunCommand, height: 48, width: 64 });
const runtime = new LinearGradientMaskCommandRuntime({ height: 48, width: 64 });
const dryRun = layerMaskDryRunResultV1Schema.parse(runtime.dispatch(dryRunCommand));
const mutation = layerMaskMutationResultV1Schema.parse(runtime.dispatch(applyCommand));

const deltas = render.alpha.map((alpha, index) => {
  const x = index % render.width;
  const y = Math.floor(index / render.width);
  const base = 0.18 + x / render.width / 5 + y / render.height / 8;
  return Math.min(1, base + alpha * 0.22) - base;
});
const topMeanDelta = average(deltas.slice(0, render.width * 12));
const bottomMeanDelta = average(deltas.slice(render.width * 36));
if (bottomMeanDelta <= topMeanDelta * 2) {
  throw new Error(`Expected gradient-weighted edit; top=${topMeanDelta}, bottom=${bottomMeanDelta}`);
}

await mkdir(dirname(ARTIFACT_PATH), { recursive: true });
const artifactSvg = renderSvg(render.alpha, render.width, render.height);
await writeFile(ARTIFACT_PATH, artifactSvg);
const artifactHash = hashText(artifactSvg);

const expectedReport = reportSchema.parse({
  appliedGraphRevision: mutation.appliedGraphRevision,
  artifactHash,
  artifactPath: ARTIFACT_PATH,
  commandType: dryRunCommand.commandType,
  coordinateSpace: LINEAR_GRADIENT_MASK_COMMAND_COORDINATE_SPACE,
  dryRunMaskHash: dryRun.maskArtifacts[0]?.contentHash,
  issue: 2877,
  localAdjustment: {
    bottomMeanDelta,
    provesGradientWeightedEdit: true,
    topMeanDelta,
  },
  schemaVersion: 1,
  uiMarkers,
  validationMode: 'linear_gradient_mask_apply_ui_runtime_render_slice',
});

if (update) {
  await writeFile(REPORT_PATH, `${JSON.stringify(expectedReport, null, 2)}\n`);
  console.log('linear gradient mask apply slice updated');
  process.exit(0);
}

const actualReport = reportSchema.parse(JSON.parse(await readFile(REPORT_PATH, 'utf8')));
if (JSON.stringify(actualReport) !== JSON.stringify(expectedReport)) {
  throw new Error(`${REPORT_PATH} is stale; run bun ${import.meta.path} --update`);
}

console.log(`linear gradient mask apply slice ok (${expectedReport.dryRunMaskHash})`);

function average(values: Array<number>): number {
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(6));
}

function hashText(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function renderSvg(alpha: Array<number>, width: number, height: number): string {
  const cells = alpha
    .map((value, index) => {
      const x = index % width;
      const y = Math.floor(index / width);
      const lightness = Math.round(value * 100);
      return `<rect x="${x}" y="${y}" width="1" height="1" fill="hsl(205 95% ${lightness}%)"/>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width * 4}" height="${height * 4}" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges">${cells}</svg>\n`;
}
