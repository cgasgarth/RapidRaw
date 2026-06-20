#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';

import { toneColorCommandEnvelopeV1Schema } from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import { INITIAL_ADJUSTMENTS, type Adjustments } from '../../../src/utils/adjustments.ts';
import {
  buildBasicToneCommandEnvelope,
  buildBasicToneImageCommandContext,
  type BasicToneCommandEnvelope,
} from '../../../src/utils/basicToneCommandBridge.ts';
import { pushEditHistoryEntry } from '../../../src/utils/editHistory.ts';

const pixelSchema = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1)]);
const REPORT_PATH = 'docs/validation/command-replay-render-proof-2026-06-20.json';
const UPDATE_REPORT = process.argv.includes('--update');
const renderReportSchema = z
  .object({
    afterHash: z.string().length(16),
    beforeHash: z.string().length(16),
    changedPixels: z.number().int().positive(),
    commandId: z.string().min(1),
    graphRevision: z.string().min(1),
    issue: z.literal(2322),
    previewExportMaxDelta: z.literal(0),
    schemaVersion: z.literal(1),
    runtimeStatus: z.literal('synthetic_headless_preview_export_parity'),
    validationMode: z.literal('typed_command_replay_golden_render'),
  })
  .strict()
  .superRefine((report, context) => {
    if (report.beforeHash === report.afterHash) {
      context.addIssue({ code: 'custom', message: 'Replay render must change the synthetic image hash.' });
    }
  });

const sourcePixels = z
  .array(pixelSchema)
  .min(4)
  .parse([
    [0.08, 0.1, 0.12],
    [0.25, 0.22, 0.18],
    [0.52, 0.49, 0.44],
    [0.82, 0.78, 0.7],
  ]);

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const hashPixels = (pixels: Array<z.infer<typeof pixelSchema>>) =>
  createHash('sha256').update(JSON.stringify(pixels)).digest('hex').slice(0, 16);

const renderBasicTone = (pixels: Array<z.infer<typeof pixelSchema>>, adjustments: Adjustments) =>
  pixels.map((pixel) => {
    const exposureScale = 2 ** adjustments.exposure;
    const contrastScale = 1 + adjustments.contrast / 100;
    const saturationScale = 1 + adjustments.saturation / 100;
    const lift = (adjustments.shadows - adjustments.blacks) / 500;
    const shoulder = (adjustments.whites - adjustments.highlights) / 500;
    const clarity = adjustments.clarity / 800;
    const mean = pixel.reduce((sum, channel) => sum + channel, 0) / pixel.length;

    return pixel.map((channel) => {
      const exposed = channel * exposureScale + lift + shoulder;
      const contrasted = (exposed - 0.5) * contrastScale + 0.5;
      const saturated = mean + (contrasted - mean) * saturationScale;
      return Number(clamp01(saturated + clarity * (channel - mean)).toFixed(6));
    }) as z.infer<typeof pixelSchema>;
  });

const commandToAdjustments = (command: BasicToneCommandEnvelope): Adjustments => ({
  ...structuredClone(INITIAL_ADJUSTMENTS),
  blacks: command.parameters.blackPoint,
  clarity: command.parameters.clarity,
  contrast: command.parameters.contrast,
  exposure: command.parameters.exposureEv,
  highlights: command.parameters.highlights,
  saturation: command.parameters.saturation,
  shadows: command.parameters.shadows,
  whites: command.parameters.whitePoint,
});

const editedAdjustments = {
  ...structuredClone(INITIAL_ADJUSTMENTS),
  blacks: -6,
  clarity: 10,
  contrast: 18,
  exposure: 0.45,
  highlights: -20,
  saturation: 8,
  shadows: 12,
  whites: 4,
};
const context = buildBasicToneImageCommandContext({
  expectedGraphRevision: 'graph-rev.command-replay.synthetic.v1',
  imagePath: '/synthetic/command-replay.raw',
  operationId: 'command_replay_render_001',
  sessionId: 'command-replay-render-proof',
});
const command = buildBasicToneCommandEnvelope(editedAdjustments, context, { dryRun: false });
const parsedCommand = toneColorCommandEnvelopeV1Schema.parse(command);
const pushed = pushEditHistoryEntry([structuredClone(INITIAL_ADJUSTMENTS)], 0, commandToAdjustments(parsedCommand));
const replayedAdjustments = pushed.history[pushed.historyIndex];

if (!replayedAdjustments) {
  throw new Error('Command replay did not produce a history head.');
}

const before = renderBasicTone(sourcePixels, INITIAL_ADJUSTMENTS);
const preview = renderBasicTone(sourcePixels, replayedAdjustments);
const exported = renderBasicTone(sourcePixels, commandToAdjustments(parsedCommand));
const previewExportMaxDelta = Math.max(
  ...preview.flatMap((pixel, pixelIndex) =>
    pixel.map((channel, channelIndex) => Math.abs(channel - (exported[pixelIndex]?.[channelIndex] ?? NaN))),
  ),
);
const changedPixels = preview.filter((pixel, pixelIndex) =>
  pixel.some((channel, channelIndex) => channel !== before[pixelIndex]?.[channelIndex]),
).length;

const report = renderReportSchema.parse({
  afterHash: hashPixels(preview),
  beforeHash: hashPixels(before),
  changedPixels,
  commandId: parsedCommand.commandId,
  graphRevision: parsedCommand.expectedGraphRevision,
  issue: 2322,
  previewExportMaxDelta,
  schemaVersion: 1,
  runtimeStatus: 'synthetic_headless_preview_export_parity',
  validationMode: 'typed_command_replay_golden_render',
});

const reportText = `${JSON.stringify(report, null, 2)}\n`;
if (UPDATE_REPORT) {
  await writeFile(REPORT_PATH, reportText);
} else {
  const expected = renderReportSchema.parse(JSON.parse(await readFile(REPORT_PATH, 'utf8')));
  if (JSON.stringify(expected) !== JSON.stringify(report)) {
    throw new Error(
      `${REPORT_PATH} is stale; run bun tests/integration/checks/check-command-replay-render-proof.ts --update`,
    );
  }
}

console.log(`command replay render proof ok (${changedPixels} changed pixels)`);
