#!/usr/bin/env bun

import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';

import { z } from 'zod';

import {
  editGraphSnapshotV1Schema,
  RAW_ENGINE_SCHEMA_VERSION,
  toneColorCommandEnvelopeV1Schema,
  toneColorDryRunResultV1Schema,
  toneColorMutationResultV1Schema,
} from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import {
  sampleEditGraphSnapshotV1,
  sampleToneColorCommandEnvelopeV1,
} from '../../../packages/rawengine-schema/src/samplePayloads.ts';
import { colorBalanceRgbSettingsSchema } from '../../../src/schemas/colorBalanceRgbSchemas.ts';
import {
  applyColorBalanceRgbToPixel,
  type ColorBalanceRgbRuntimeResult,
  type RgbPixel,
} from '../../../src/utils/color/runtime/colorBalanceRgbRuntime.ts';

const rgbPixelSchema = z
  .object({
    blue: z.number().min(0).max(1),
    green: z.number().min(0).max(1),
    red: z.number().min(0).max(1),
  })
  .strict();
const rgbOffsetSchema = z
  .object({
    blue: z.number().min(-1).max(1),
    green: z.number().min(-1).max(1),
    red: z.number().min(-1).max(1),
  })
  .strict();

const runtimeMetricsSchema = z
  .object({
    applyCommandId: z.string().min(1),
    changedPixels: z.number().int().positive(),
    commandType: z.literal('toneColor.setColorBalanceRgb'),
    dryRunCommandId: z.string().min(1),
    issue: z.literal(2331),
    midtoneRuntime: z.object({
      appliedOffset: rgbOffsetSchema,
      inputRgb: rgbPixelSchema,
      outputRgb: rgbPixelSchema,
      rangeWeights: z.object({
        highlights: z.number().min(0).max(1),
        midtones: z.number().min(0).max(1),
        shadows: z.number().min(0).max(1),
      }),
    }),
    previewExportMaxDelta: z.literal(0),
    previewHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    schemaVersion: z.literal(1),
    sidecarGraphRevision: z.string().min(1),
    sidecarSerializedHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    sourceHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    validationMode: z.literal('color_balance_rgb_command_preview_export_sidecar_proof'),
  })
  .strict();

const zeroRange = { blue: 0, green: 0, red: 0 };
const colorBalanceRgb = colorBalanceRgbSettingsSchema.parse({
  enabled: true,
  highlights: zeroRange,
  midtones: { blue: -12, green: 2, red: 16 },
  preserveLuminance: true,
  shadows: zeroRange,
});

const dryRunCommand = toneColorCommandEnvelopeV1Schema.parse({
  ...sampleToneColorCommandEnvelopeV1,
  commandId: 'command_color_balance_rgb_midtones_preview_001',
  commandType: 'toneColor.setColorBalanceRgb',
  correlationId: 'corr_color_balance_rgb_midtones_preview_001',
  dryRun: true,
  idempotencyKey: 'idem_color_balance_rgb_midtones_preview_001',
  parameters: colorBalanceRgb,
});

const applyCommand = toneColorCommandEnvelopeV1Schema.parse({
  ...dryRunCommand,
  approval: {
    approvalClass: 'edit_apply',
    reason: 'Apply accepted midtone RGB color balance to the edit graph sidecar.',
    state: 'approved',
  },
  commandId: 'command_color_balance_rgb_midtones_apply_001',
  correlationId: 'corr_color_balance_rgb_midtones_apply_001',
  dryRun: false,
  idempotencyKey: 'idem_color_balance_rgb_midtones_apply_001',
});

const sourcePixels: RgbPixel[] = [
  { blue: 0.12, green: 0.1, red: 0.08 },
  { blue: 0.34, green: 0.32, red: 0.3 },
  { blue: 0.58, green: 0.52, red: 0.48 },
  { blue: 0.82, green: 0.78, red: 0.72 },
];

const previewResults = sourcePixels.map((pixel) => applyColorBalanceRgbToPixel(pixel, dryRunCommand.parameters));
const exportResults = sourcePixels.map((pixel) => applyColorBalanceRgbToPixel(pixel, applyCommand.parameters));
const previewPixels = previewResults.map((result) => roundRgb(result.outputRgb));
const exportPixels = exportResults.map((result) => roundRgb(result.outputRgb));
const previewExportMaxDelta = maxPixelDelta(previewPixels, exportPixels);
const changedPixels = previewPixels.filter((pixel, index) => maxChannelDelta(pixel, sourcePixels[index]) > 0).length;

const sidecarGraph = editGraphSnapshotV1Schema.parse({
  ...sampleEditGraphSnapshotV1,
  activeHistoryIndex: 2,
  graphRevision: 'graph_rev_color_balance_rgb_midtones_001',
  history: [
    ...sampleEditGraphSnapshotV1.history,
    {
      actor: applyCommand.actor,
      commandId: applyCommand.commandId,
      commandType: 'editGraph.applyParameterPatch',
      createdAt: '2026-06-20T00:00:00.000Z',
      graphRevision: 'graph_rev_color_balance_rgb_midtones_001',
      label: 'Apply midtone RGB color balance',
    },
  ],
  nodes: [
    ...sampleEditGraphSnapshotV1.nodes,
    {
      createdAt: '2026-06-20T00:00:00.000Z',
      createdBy: applyCommand.actor,
      enabled: true,
      id: 'node_color_balance_rgb_midtones_001',
      inputRevision: sampleEditGraphSnapshotV1.graphRevision,
      kind: 'agent_command',
      label: 'Midtone RGB color balance',
      outputRevision: 'graph_rev_color_balance_rgb_midtones_001',
      parameters: {
        colorBalanceRgb: applyCommand.parameters,
      },
      sourceCommandId: applyCommand.commandId,
    },
  ],
});

const sidecarPayload = {
  adjustments: {
    colorBalanceRgb: applyCommand.parameters,
  },
  editGraph: sidecarGraph,
  rating: 0,
  schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
  version: 1,
};

toneColorDryRunResultV1Schema.parse({
  colorPipeline: dryRunCommand.colorPipeline,
  commandId: dryRunCommand.commandId,
  commandType: dryRunCommand.commandType,
  correlationId: dryRunCommand.correlationId,
  dryRun: true,
  mutates: false,
  parameterDiff: [
    {
      module: 'color_balance_rgb',
      path: '/parameters/midtones',
      previousValue: zeroRange,
      value: colorBalanceRgb.midtones,
    },
  ],
  predictedGraphRevision: sidecarGraph.graphRevision,
  previewArtifacts: [
    {
      artifactId: 'artifact_color_balance_rgb_midtones_preview_001',
      contentHash: hashJson(previewPixels),
      dimensions: { height: 1, width: sourcePixels.length },
      kind: 'preview',
      storage: 'temp_cache',
    },
  ],
  schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
  sourceGraphRevision: dryRunCommand.expectedGraphRevision,
  warnings: [],
});

toneColorMutationResultV1Schema.parse({
  appliedGraphRevision: sidecarGraph.graphRevision,
  changedNodeIds: ['node_color_balance_rgb_midtones_001'],
  colorPipeline: applyCommand.colorPipeline,
  commandId: applyCommand.commandId,
  commandType: applyCommand.commandType,
  correlationId: applyCommand.correlationId,
  dryRun: false,
  mutates: true,
  schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
  sourceGraphRevision: applyCommand.expectedGraphRevision,
  undoRevision: applyCommand.expectedGraphRevision,
  warnings: [],
});

const midtoneRuntime = pickMidtoneRuntime(previewResults);
const runtimeMetrics = runtimeMetricsSchema.parse({
  applyCommandId: applyCommand.commandId,
  changedPixels,
  commandType: applyCommand.commandType,
  dryRunCommandId: dryRunCommand.commandId,
  issue: 2331,
  midtoneRuntime: {
    appliedOffset: roundRgb(midtoneRuntime.appliedOffset),
    inputRgb: sourcePixels[1],
    outputRgb: roundRgb(midtoneRuntime.outputRgb),
    rangeWeights: roundRangeWeights(midtoneRuntime.rangeWeights),
  },
  previewExportMaxDelta,
  previewHash: hashJson(previewPixels),
  schemaVersion: 1,
  sidecarGraphRevision: sidecarGraph.graphRevision,
  sidecarSerializedHash: hashJson(sidecarPayload),
  sourceHash: hashJson(sourcePixels),
  validationMode: 'color_balance_rgb_command_preview_export_sidecar_proof',
});

assert.deepEqual(runtimeMetrics, {
  applyCommandId: 'command_color_balance_rgb_midtones_apply_001',
  changedPixels: 4,
  commandType: 'toneColor.setColorBalanceRgb',
  dryRunCommandId: 'command_color_balance_rgb_midtones_preview_001',
  issue: 2331,
  midtoneRuntime: {
    appliedOffset: {
      blue: -0.017993794944,
      green: 0.002998965824,
      red: 0.023991726592,
    },
    inputRgb: {
      blue: 0.34,
      green: 0.32,
      red: 0.3,
    },
    outputRgb: {
      blue: 0.316080689192,
      green: 0.317055181307,
      red: 0.318029673422,
    },
    rangeWeights: {
      highlights: 0,
      midtones: 0.599793164812,
      shadows: 0.400206835188,
    },
  },
  previewExportMaxDelta: 0,
  previewHash: 'sha256:6c7b7fc6eb2a0d17bcac34b0e8b678bae95cdd5f0ddb075f2d203335d64a738e',
  schemaVersion: 1,
  sidecarGraphRevision: 'graph_rev_color_balance_rgb_midtones_001',
  sidecarSerializedHash: 'sha256:29483f82f94709ce6672177b3a6b3a7ecd9cffc847c3cb079aaa6af9c5e1dd18',
  sourceHash: 'sha256:fe7507b3f51ff8c1edab97dc05c75a0b90a5ef8a36949c02ce1045c7c96fb678',
  validationMode: 'color_balance_rgb_command_preview_export_sidecar_proof',
});

console.log(`color balance command proof ok (${runtimeMetrics.changedPixels} changed pixels; runtime metrics)`);

function pickMidtoneRuntime(results: ColorBalanceRgbRuntimeResult[]): ColorBalanceRgbRuntimeResult {
  const result = results[1];
  if (result === undefined) throw new Error('Color balance proof requires a midtone sample.');
  return result;
}

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

function roundRgb(value: RgbPixel): RgbPixel {
  return {
    blue: roundMetric(value.blue),
    green: roundMetric(value.green),
    red: roundMetric(value.red),
  };
}

function roundRangeWeights(value: ColorBalanceRgbRuntimeResult['rangeWeights']) {
  return {
    highlights: roundMetric(value.highlights),
    midtones: roundMetric(value.midtones),
    shadows: roundMetric(value.shadows),
  };
}
