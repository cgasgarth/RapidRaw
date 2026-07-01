#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { access, readFile, writeFile } from 'node:fs/promises';

import { z } from 'zod';

import {
  deriveLayerMaskExportParityReceiptState,
  layerMaskExportParityReceiptSchema,
} from '../../../../src/utils/layers/layerMaskExportParityReceipt.ts';

const REPORT_PATH = 'docs/validation/proofs/layers-masks/layer-mask-private-raw-ui-proof-2026-06-20.json';
const RUNTIME_REPORT_PATH = 'docs/validation/proofs/layers-masks/layer-mask-real-raw-proof-2026-06-18.json';
const SCREENSHOT_PATH = 'artifacts/visual-smoke/layer-mask-private-raw-ui.png';
const FIXTURE_ID = 'validation.layer-mask-real-raw.alaska-local-adjustment.v1';
const update = process.argv.includes('--update');

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const pngDimensionsSchema = z.object({ height: z.literal(960), width: z.literal(1440) }).strict();
const artifactSchema = z
  .object({
    hash: sha256Schema,
    kind: z.string().min(1),
    path: z.string().min(1),
    publicRepoAllowed: z.literal(false),
  })
  .strict();
const runtimeReportSchema = z
  .object({
    artifacts: z.array(artifactSchema).min(6),
    exportParityReceipt: layerMaskExportParityReceiptSchema,
    fixtureId: z.literal(FIXTURE_ID),
    issue: z.literal(3251),
    metrics: z.array(z.object({ name: z.string().min(1), passed: z.literal(true), value: z.number() })).min(5),
    proofClaims: z.object({
      proves: z.array(z.string().min(1)).min(5),
    }),
    validationMode: z.literal('private_raw_tauri_runtime_proof'),
  })
  .passthrough();
const proofReportSchema = z
  .object({
    doesNotProve: z.array(z.string().min(1)).min(1),
    e2eIssue: z.literal(4558),
    issue: z.literal(4558),
    predecessorIssue: z.literal(2310),
    proofBoundary: z.literal('private_raw_tauri_runtime_plus_refined_mask_export_receipt'),
    proofStatus: z.literal('private_raw_refined_mask_preview_export_parity_receipted'),
    privateRawRuntime: z
      .object({
        artifactCount: z.number().int().min(6),
        fixtureId: z.literal(FIXTURE_ID),
        metricCount: z.number().int().min(5),
        proves: z.array(z.string().min(1)).min(5),
        runtimeReportPath: z.literal(RUNTIME_REPORT_PATH),
        validationMode: z.literal('private_raw_tauri_runtime_proof'),
      })
      .strict(),
    refinedMaskExportParity: layerMaskExportParityReceiptSchema,
    schemaVersion: z.literal(1),
    staleInvalidation: z
      .object({
        parityStatus: z.literal('stale_blocked'),
        staleReasons: z.array(z.enum(['source_graph_revision_changed', 'mask_alpha_changed'])).min(1),
        staleState: z.literal('stale'),
      })
      .strict(),
    validationCommands: z
      .array(
        z.enum([
          'RAWENGINE_PRIVATE_RAW_ROOT=/tmp/rawengine-private-root bun tests/integration/checks/layers/check-layer-mask-real-raw-proof.ts -- --require-assets',
          'RAWENGINE_PRIVATE_RAW_ROOT=/tmp/rawengine-private-root bun scripts/proofs/capture-visual-smoke.ts --scenario layer-mask-private-raw-ui',
          'bun tests/integration/checks/layers/check-layer-mask-private-raw-ui-proof.ts',
        ]),
      )
      .length(3),
    visualReview: z
      .object({
        dimensions: pngDimensionsSchema,
        scenario: z.literal('layer-mask-private-raw-ui'),
        screenshotHash: sha256Schema,
        screenshotSource: z.enum(['generated_private_raw_visual_smoke', 'committed_redacted_proof_hash']),
        screenshotPath: z.literal(SCREENSHOT_PATH),
        workflowControlsExercised: z.literal(true),
      })
      .strict(),
  })
  .strict();

function runCommand(command: Array<string>, env: Record<string, string> = {}) {
  const result = Bun.spawnSync(command, { env: { ...process.env, ...env }, stderr: 'pipe', stdout: 'pipe' });
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
  if (buffer.toString('ascii', 1, 4) !== 'PNG') throw new Error(`${path} is not a PNG file.`);

  return pngDimensionsSchema.parse({
    height: buffer.readUInt32BE(20),
    width: buffer.readUInt32BE(16),
  });
}

async function fileHash(path: string): Promise<string> {
  return `sha256:${createHash('sha256')
    .update(await readFile(path))
    .digest('hex')}`;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

const privateRoot = process.env.RAWENGINE_PRIVATE_RAW_ROOT;
if (privateRoot === undefined) {
  runCommand(['bun', 'run', 'check:layer-mask-real-raw-proof']);
} else {
  runCommand(['bun', 'run', 'check:layer-mask-real-raw-proof', '--', '--require-assets'], {
    RAWENGINE_PRIVATE_RAW_ROOT: privateRoot,
  });
  runCommand(['bun', 'run', 'check:layer-mask-private-raw-ui-smoke'], {
    RAWENGINE_PRIVATE_RAW_ROOT: privateRoot,
  });
}

const runtimeReport = runtimeReportSchema.parse(JSON.parse(await readFile(RUNTIME_REPORT_PATH, 'utf8')));
const committedReport = proofReportSchema.parse(JSON.parse(await readFile(REPORT_PATH, 'utf8')));
const screenshotAvailable = await pathExists(SCREENSHOT_PATH);
const staleReceipt = deriveLayerMaskExportParityReceiptState({
  current: {
    ...runtimeReport.exportParityReceipt,
    refinedMaskContentHash: `${runtimeReport.exportParityReceipt.refinedMaskContentHash.slice(0, -1)}0`,
    sourceGraphRevision: `${runtimeReport.exportParityReceipt.sourceGraphRevision}_stale`,
  },
  receipt: runtimeReport.exportParityReceipt,
});
const expectedReport = proofReportSchema.parse({
  doesNotProve: ['full_macos_app_manual_session', 'manual_layer_panel_interaction'],
  e2eIssue: 4558,
  issue: 4558,
  predecessorIssue: 2310,
  proofBoundary: 'private_raw_tauri_runtime_plus_refined_mask_export_receipt',
  proofStatus: 'private_raw_refined_mask_preview_export_parity_receipted',
  privateRawRuntime: {
    artifactCount: runtimeReport.artifacts.length,
    fixtureId: runtimeReport.fixtureId,
    metricCount: runtimeReport.metrics.length,
    proves: runtimeReport.proofClaims.proves,
    runtimeReportPath: RUNTIME_REPORT_PATH,
    validationMode: runtimeReport.validationMode,
  },
  refinedMaskExportParity: runtimeReport.exportParityReceipt,
  schemaVersion: 1,
  staleInvalidation: {
    parityStatus: staleReceipt.parityStatus,
    staleReasons: staleReceipt.staleReasons,
    staleState: staleReceipt.staleState,
  },
  validationCommands: [
    'RAWENGINE_PRIVATE_RAW_ROOT=/tmp/rawengine-private-root bun tests/integration/checks/layers/check-layer-mask-real-raw-proof.ts -- --require-assets',
    'RAWENGINE_PRIVATE_RAW_ROOT=/tmp/rawengine-private-root bun scripts/proofs/capture-visual-smoke.ts --scenario layer-mask-private-raw-ui',
    'bun tests/integration/checks/layers/check-layer-mask-private-raw-ui-proof.ts',
  ],
  visualReview: {
    dimensions: screenshotAvailable
      ? await readPngDimensions(SCREENSHOT_PATH)
      : committedReport.visualReview.dimensions,
    scenario: 'layer-mask-private-raw-ui',
    screenshotHash: screenshotAvailable ? await fileHash(SCREENSHOT_PATH) : committedReport.visualReview.screenshotHash,
    screenshotSource: screenshotAvailable ? 'generated_private_raw_visual_smoke' : 'committed_redacted_proof_hash',
    screenshotPath: SCREENSHOT_PATH,
    workflowControlsExercised: true,
  },
});
const expectedJson = `${JSON.stringify(expectedReport, null, 2)}\n`;

if (update) {
  await writeFile(REPORT_PATH, expectedJson);
  console.log('layer mask private RAW UI proof updated');
  process.exit(0);
}

if (JSON.stringify(committedReport) !== JSON.stringify(expectedReport)) {
  throw new Error(
    `${REPORT_PATH} is stale; run bun tests/integration/checks/layers/check-layer-mask-private-raw-ui-proof.ts --update.`,
  );
}

console.log(
  `layer mask private RAW UI proof ok (${expectedReport.privateRawRuntime.metricCount} metrics, ${expectedReport.visualReview.dimensions.width}x${expectedReport.visualReview.dimensions.height})`,
);
