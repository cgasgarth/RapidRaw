#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

import { z } from 'zod';

import {
  createRawEngineLocalAppServerBridge,
  rawEngineLocalAppServerBridgeCapabilities,
} from '../../../packages/rawengine-schema/src/localAppServerBridge.ts';
import {
  editGraphSnapshotV1Schema,
  RAW_ENGINE_SCHEMA_VERSION,
  toneColorDryRunResultV1Schema,
  toneColorMutationResultV1Schema,
} from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import { sampleEditGraphSnapshotV1 } from '../../../packages/rawengine-schema/src/samplePayloads.ts';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments.ts';
import {
  applySelectiveColorCommandEnvelopeToAdjustments,
  buildSelectiveColorCommandEnvelope,
  buildSelectiveColorImageCommandContext,
} from '../../../src/utils/selectiveColorCommandBridge.ts';
import { applySelectiveColorToRgbPixel, type RgbPixel } from '../../../src/utils/selectiveColorRuntime.ts';

const REPORT_PATH = 'docs/validation/selective-color-command-proof-2026-06-20.json';
const UPDATE_REPORT = process.argv.includes('--update');

const rgbPixelSchema = z
  .object({
    blue: z.number().min(0).max(1),
    green: z.number().min(0).max(1),
    red: z.number().min(0).max(1),
  })
  .strict();

const reportSchema = z
  .object({
    applyCommandId: z.string().min(1),
    changedPixels: z.number().int().positive(),
    commandType: z.literal('toneColor.adjustHsl'),
    doesNotProve: z.array(z.enum(['real_raw_decode', 'gpu_parity', 'local_app_ui_e2e'])).min(1),
    dryRunCommandId: z.string().min(1),
    issue: z.literal(2329),
    previewExportMaxDelta: z.literal(0),
    previewHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    schemaVersion: z.literal(1),
    sidecarGraphRevision: z.string().min(1),
    sidecarSerializedHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    sourceHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    targetedRuntime: z.object({
      influence: z.number().min(0).max(1),
      inputRgb: rgbPixelSchema,
      outputRgb: rgbPixelSchema,
      rangeKey: z.literal('oranges'),
    }),
    validationMode: z.literal('selective_color_command_preview_export_sidecar_synthetic_proof'),
  })
  .strict();

const adjustment = {
  hue: 8,
  luminance: -11,
  saturation: 22,
};

const commandContext = buildSelectiveColorImageCommandContext({
  expectedGraphRevision: sampleEditGraphSnapshotV1.graphRevision,
  imagePath: '/validation/selective-color-orange.CR3',
  operationId: 'orange_001',
  sessionId: 'selective-color-command-proof',
});

const dryRunCommand = buildSelectiveColorCommandEnvelope(
  { adjustment, rangeKey: 'oranges' },
  {
    ...commandContext,
    commandId: 'command_selective_color_orange_preview_001',
    correlationId: 'corr_selective_color_orange_preview_001',
    idempotencyKey: 'idem_selective_color_orange_preview_001',
  },
  { dryRun: true },
);

const applyCommand = buildSelectiveColorCommandEnvelope(
  { adjustment, rangeKey: 'oranges' },
  {
    ...commandContext,
    commandId: 'command_selective_color_orange_apply_001',
    correlationId: 'corr_selective_color_orange_apply_001',
    idempotencyKey: 'idem_selective_color_orange_apply_001',
  },
  {
    dryRun: false,
    reason: 'Apply accepted orange selective color adjustment to the edit graph sidecar.',
  },
);

const bridge = createRawEngineLocalAppServerBridge();
const rejectedApply = await createRawEngineLocalAppServerBridge().dispatch(applyCommand);
if (rejectedApply.ok || rejectedApply.reason !== 'handler_failed') {
  throw new Error('Selective color apply must be rejected before a matching dry-run.');
}

if (!rawEngineLocalAppServerBridgeCapabilities.commandTypes.includes('toneColor.adjustHsl')) {
  throw new Error('Local app-server bridge must advertise toneColor.adjustHsl support.');
}

const dryRunResult = await bridge.dispatch(dryRunCommand);
if (!dryRunResult.ok) throw new Error(`Selective color dry-run failed: ${dryRunResult.message}`);
const parsedDryRunResult = toneColorDryRunResultV1Schema.parse(dryRunResult.result);
if (!parsedDryRunResult.parameterDiff.some((diff) => diff.path === '/parameters/orange/saturation')) {
  throw new Error('Selective color dry-run must include an orange saturation diff.');
}

const applyResult = await bridge.dispatch(applyCommand);
if (!applyResult.ok) throw new Error(`Selective color apply failed after matching dry-run: ${applyResult.message}`);
const parsedApplyResult = toneColorMutationResultV1Schema.parse(applyResult.result);

const replayedAdjustments = applySelectiveColorCommandEnvelopeToAdjustments(INITIAL_ADJUSTMENTS, applyCommand);
if (replayedAdjustments.hsl.oranges.hue !== adjustment.hue) {
  throw new Error('Selective color command replay did not update orange hue.');
}

const sourcePixels: RgbPixel[] = [
  { blue: 0.08, green: 0.26, red: 0.88 },
  { blue: 0.12, green: 0.38, red: 0.92 },
  { blue: 0.62, green: 0.52, red: 0.32 },
  { blue: 0.8, green: 0.16, red: 0.12 },
];

const previewResults = sourcePixels.map((pixel) => applySelectiveColorToRgbPixel(pixel, 'oranges', adjustment));
const exportResults = sourcePixels.map((pixel) => applySelectiveColorToRgbPixel(pixel, 'oranges', adjustment));
const previewPixels = previewResults.map((result) => roundRgb(result.outputRgb));
const exportPixels = exportResults.map((result) => roundRgb(result.outputRgb));
const previewExportMaxDelta = maxPixelDelta(previewPixels, exportPixels);
const changedPixels = previewPixels.filter((pixel, index) => maxChannelDelta(pixel, sourcePixels[index]) > 0).length;

const sidecarGraph = editGraphSnapshotV1Schema.parse({
  ...sampleEditGraphSnapshotV1,
  activeHistoryIndex: 2,
  graphRevision: 'graph_rev_selective_color_orange_001',
  history: [
    ...sampleEditGraphSnapshotV1.history,
    {
      actor: applyCommand.actor,
      commandId: applyCommand.commandId,
      commandType: 'editGraph.applyParameterPatch',
      createdAt: '2026-06-20T00:00:00.000Z',
      graphRevision: 'graph_rev_selective_color_orange_001',
      label: 'Apply orange selective color',
    },
  ],
  nodes: [
    ...sampleEditGraphSnapshotV1.nodes,
    {
      createdAt: '2026-06-20T00:00:00.000Z',
      createdBy: applyCommand.actor,
      enabled: true,
      id: 'node_selective_color_orange_001',
      inputRevision: sampleEditGraphSnapshotV1.graphRevision,
      kind: 'agent_command',
      label: 'Orange selective color',
      outputRevision: 'graph_rev_selective_color_orange_001',
      parameters: {
        hsl: {
          oranges: adjustment,
        },
      },
      sourceCommandId: applyCommand.commandId,
    },
  ],
});

const sidecarPayload = {
  adjustments: {
    hsl: {
      oranges: adjustment,
    },
  },
  editGraph: sidecarGraph,
  rating: 0,
  schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
  version: 1,
};

if (parsedDryRunResult.sourceGraphRevision !== sampleEditGraphSnapshotV1.graphRevision) {
  throw new Error('Selective color dry-run did not preserve the source graph revision.');
}
if (!parsedApplyResult.changedNodeIds.includes('tone_color_hsl:orange:image')) {
  throw new Error('Selective color apply result did not report the orange HSL node.');
}

const targetedRuntime = previewResults[1];
if (targetedRuntime === undefined) throw new Error('Selective color proof requires a targeted orange sample.');

const report = reportSchema.parse({
  applyCommandId: applyCommand.commandId,
  changedPixels,
  commandType: applyCommand.commandType,
  doesNotProve: ['real_raw_decode', 'gpu_parity', 'local_app_ui_e2e'],
  dryRunCommandId: dryRunCommand.commandId,
  issue: 2329,
  previewExportMaxDelta,
  previewHash: hashJson(previewPixels),
  schemaVersion: 1,
  sidecarGraphRevision: sidecarGraph.graphRevision,
  sidecarSerializedHash: hashJson(sidecarPayload),
  sourceHash: hashJson(sourcePixels),
  targetedRuntime: {
    influence: roundMetric(targetedRuntime.influence),
    inputRgb: sourcePixels[1],
    outputRgb: roundRgb(targetedRuntime.outputRgb),
    rangeKey: 'oranges',
  },
  validationMode: 'selective_color_command_preview_export_sidecar_synthetic_proof',
});

const reportText = `${JSON.stringify(report, null, 2)}\n`;
if (UPDATE_REPORT) {
  await writeFile(REPORT_PATH, reportText);
} else {
  const expected = reportSchema.parse(JSON.parse(await readFile(REPORT_PATH, 'utf8')));
  if (JSON.stringify(expected) !== JSON.stringify(report)) {
    throw new Error(`${REPORT_PATH} is stale; run bun run check:selective-color-command-proof:update.`);
  }
}

console.log(`selective color command proof ok (${changedPixels} changed pixels; synthetic)`);

function hashJson(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function maxPixelDelta(left: RgbPixel[], right: RgbPixel[]): number {
  return Math.max(...left.map((pixel, index) => maxChannelDelta(pixel, right[index])));
}

function maxChannelDelta(left: RgbPixel, right: RgbPixel | undefined): number {
  if (right === undefined) return Number.POSITIVE_INFINITY;
  return Math.max(Math.abs(left.red - right.red), Math.abs(left.green - right.green), Math.abs(left.blue - right.blue));
}

function roundMetric(value: number): number {
  return Number(value.toFixed(12));
}

function roundRgb(pixel: RgbPixel): RgbPixel {
  return {
    blue: roundMetric(pixel.blue),
    green: roundMetric(pixel.green),
    red: roundMetric(pixel.red),
  };
}
