#!/usr/bin/env bun

import { readFile, writeFile } from 'node:fs/promises';

import { z } from 'zod';

const REPORT_PATH = 'docs/validation/layer-stack-ui-proof-2026-06-20.json';
const SCREENSHOT_PATH = 'artifacts/visual-smoke/layer-stack-workflow.png';
const PARITY_REPORT_PATH =
  'artifacts/layers/preview-export-parity/layers.synthetic.preview-export-parity.v1.report.json';
const update = process.argv.includes('--update');

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const pngDimensionsSchema = z.object({ height: z.literal(960), width: z.literal(1440) }).strict();

const parityReportSchema = z
  .object({
    coverageByLayer: z.array(z.object({ id: z.string().min(1), opacity: z.number(), touchedPixels: z.number() })),
    exportHash: sha256Schema,
    headlessHash: sha256Schema,
    previewHash: sha256Schema,
    sidecarArtifactId: z.literal('layer_stack_preview_export_parity_v1'),
  })
  .strict()
  .superRefine((report, context) => {
    if (report.previewHash !== report.exportHash || report.previewHash !== report.headlessHash) {
      context.addIssue({
        code: 'custom',
        message: 'layer preview, export, and headless hashes must match',
        path: ['previewHash'],
      });
    }
  });

const proofReportSchema = z
  .object({
    doesNotProve: z.array(z.string().min(1)).min(1),
    issue: z.literal(2310),
    layerRuntime: z
      .object({
        coverageLayerCount: z.number().int().positive(),
        previewExportHash: sha256Schema,
        sidecarArtifactId: z.literal('layer_stack_preview_export_parity_v1'),
      })
      .strict(),
    layerGrouping: z
      .object({
        collapsedGroupCount: z.literal(0),
        groupedLayerCount: z.literal(2),
        visualGroupingState: z.literal('active'),
      })
      .strict(),
    schemaVersion: z.literal(1),
    validationCommands: z
      .array(
        z.enum([
          'bun run check:layer-stack-commands',
          'bun run check:layer-preview-export-parity',
          'bun run check:layer-workflow-smoke',
          'bun run check:layer-stack-ui-proof',
        ]),
      )
      .length(4),
    visualReview: z
      .object({
        dimensions: pngDimensionsSchema,
        scenario: z.literal('layer-stack-workflow'),
        screenshotPath: z.literal(SCREENSHOT_PATH),
        workflowControlsExercised: z.literal(true),
      })
      .strict(),
  })
  .strict();

function runCommand(command: string[]) {
  const result = Bun.spawnSync(command, { stderr: 'pipe', stdout: 'pipe' });
  if (result.success) return;

  const output = [new TextDecoder().decode(result.stdout), new TextDecoder().decode(result.stderr)]
    .join('\n')
    .split('\n')
    .filter(Boolean)
    .slice(-30)
    .join('\n');
  throw new Error(`${command.join(' ')} failed:\n${output}`);
}

async function readPngDimensions(path: string) {
  const buffer = await readFile(path);
  if (buffer.toString('ascii', 1, 4) !== 'PNG') {
    throw new Error(`${path} is not a PNG file.`);
  }

  return pngDimensionsSchema.parse({
    height: buffer.readUInt32BE(20),
    width: buffer.readUInt32BE(16),
  });
}

runCommand(['bun', 'run', 'check:layer-stack-commands']);
runCommand(['bun', 'run', 'check:layer-preview-export-parity']);
runCommand(['bun', 'run', 'check:layer-workflow-smoke']);

const parityReport = parityReportSchema.parse(JSON.parse(await readFile(PARITY_REPORT_PATH, 'utf8')));
const visualSource = await readFile('src/validation/visual/VisualSmokeApp.tsx', 'utf8');
for (const marker of [
  'data-testid="layer-stack-visual-group-row"',
  'data-testid="layer-stack-visual-group-proof"',
  "data-grouping-state={groupedLayerCount > 0 ? 'active' : 'ungrouped'}",
  'data-grouped-layer-count={String(groupedLayerCount)}',
  'data-collapsed-group-count={String(collapsedGroupIds.length)}',
]) {
  if (!visualSource.includes(marker)) {
    throw new Error(`Layer stack visual smoke missing grouping marker: ${marker}`);
  }
}

const expectedReport = proofReportSchema.parse({
  doesNotProve: [
    'full_macos_app_manual_session',
    'private_raw_source_decode',
    'real_raw_export_acceptance',
    'retouch_pixel_layer_workflow',
  ],
  issue: 2310,
  layerRuntime: {
    coverageLayerCount: parityReport.coverageByLayer.length,
    previewExportHash: parityReport.previewHash,
    sidecarArtifactId: parityReport.sidecarArtifactId,
  },
  layerGrouping: {
    collapsedGroupCount: 0,
    groupedLayerCount: 2,
    visualGroupingState: 'active',
  },
  schemaVersion: 1,
  validationCommands: [
    'bun run check:layer-stack-commands',
    'bun run check:layer-preview-export-parity',
    'bun run check:layer-workflow-smoke',
    'bun run check:layer-stack-ui-proof',
  ],
  visualReview: {
    dimensions: await readPngDimensions(SCREENSHOT_PATH),
    scenario: 'layer-stack-workflow',
    screenshotPath: SCREENSHOT_PATH,
    workflowControlsExercised: true,
  },
});
const expectedJson = `${JSON.stringify(expectedReport, null, 2)}\n`;

if (update) {
  await writeFile(REPORT_PATH, expectedJson);
  console.log('layer stack UI proof updated');
  process.exit(0);
}

const committedReport = proofReportSchema.parse(JSON.parse(await readFile(REPORT_PATH, 'utf8')));
if (JSON.stringify(committedReport) !== JSON.stringify(expectedReport)) {
  throw new Error(`${REPORT_PATH} is stale; run bun tests/integration/checks/check-layer-stack-ui-proof.ts --update.`);
}

console.log(
  `layer stack UI proof ok (${expectedReport.layerRuntime.coverageLayerCount} layers, ${expectedReport.visualReview.dimensions.width}x${expectedReport.visualReview.dimensions.height})`,
);
