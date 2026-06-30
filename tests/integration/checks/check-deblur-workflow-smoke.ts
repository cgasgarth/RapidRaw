#!/usr/bin/env bun

import { mkdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

import {
  ApprovalClass,
  detailDeblurCommandEnvelopeV1Schema,
  detailDeblurDryRunResultV1Schema,
  detailDeblurRuntimeStateV1Schema,
  detailDeblurUiControlsV1Schema,
  RAW_ENGINE_SCHEMA_VERSION,
  toDetailDeblurControlsV1,
} from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import { readBoundedStream, writeBoundedOutput } from '../../../scripts/compact-output.ts';
import { parseDeblurWorkflowReport } from '../../../src/schemas/deblurWorkflowSchemas.ts';
import { INITIAL_ADJUSTMENTS, normalizeLoadedAdjustments } from '../../../src/utils/adjustments.ts';

const REPORT_PATH = resolve('src-tauri/target/rawengine-deblur-workflow-report.json');
const ARTIFACT_PATH = resolve('src-tauri/target/rawengine-deblur-workflow-preview.png');
const REQUIRED_RUST_TOOLCHAIN = '1.95.0';

export const runDeblurWorkflowSmoke = async () => {
  validateDeblurUiApiCoverage();

  await mkdir(dirname(REPORT_PATH), { recursive: true });

  const proc = Bun.spawn(['cargo', ...resolveCargoArgs()], {
    env: {
      ...process.env,
      RAWENGINE_DEBLUR_WORKFLOW_PREVIEW_ARTIFACT: ARTIFACT_PATH,
      RAWENGINE_DEBLUR_WORKFLOW_REPORT: REPORT_PATH,
    },
    stderr: 'pipe',
    stdout: 'pipe',
  });
  const stdout = readBoundedStream(proc.stdout);
  const stderr = readBoundedStream(proc.stderr);
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    writeBoundedOutput('stdout', await stdout);
    writeBoundedOutput('stderr', await stderr);
    process.exit(exitCode);
  }

  const report = parseDeblurWorkflowReport(JSON.parse(await readFile(REPORT_PATH, 'utf8')));
  const artifact = await stat(report.artifactPath);
  if (!artifact.isFile() || artifact.size < 128) {
    console.error(`Deblur workflow artifact is missing or too small: ${report.artifactPath}`);
    process.exit(1);
  }
  if (report.inputToPreviewMaxDelta <= 0.0001) {
    console.error(`Deblur workflow did not change pixels enough: ${report.inputToPreviewMaxDelta}`);
    process.exit(1);
  }

  console.log(
    `deblur workflow ok delta=${report.inputToPreviewMaxDelta.toFixed(6)} artifact=${basename(report.artifactPath)}`,
  );
};

const resolveCargoArgs = () => {
  const args = ['test', '--manifest-path', 'src-tauri/Cargo.toml', 'deblur_render', '--lib', '--', '--nocapture'];

  if (process.env.RAWENGINE_RUST_TOOLCHAIN) return [`+${process.env.RAWENGINE_RUST_TOOLCHAIN}`, ...args];

  const rustup = Bun.spawnSync(['rustup', 'toolchain', 'list'], {
    stderr: 'pipe',
    stdout: 'pipe',
  });
  if (rustup.success && new TextDecoder().decode(rustup.stdout).includes(REQUIRED_RUST_TOOLCHAIN)) {
    return [`+${REQUIRED_RUST_TOOLCHAIN}`, ...args];
  }

  return args;
};

function validateDeblurUiApiCoverage() {
  const uiControls = detailDeblurUiControlsV1Schema.parse({
    deblurEnabled: true,
    deblurSigmaPx: 0.8,
    deblurStrength: 25,
  });
  const apiControls = toDetailDeblurControlsV1(uiControls);
  assertEqual(apiControls.enabled, true, 'enabled conversion');
  assertEqual(apiControls.psf, 'gaussian', 'PSF conversion');
  assertEqual(apiControls.strength, 0.25, 'strength conversion');
  assertEqual(apiControls.sigmaPx, 0.8, 'sigma conversion');

  const legacyLoaded = normalizeLoadedAdjustments({ sharpness: 12 });
  assertEqual(legacyLoaded.deblurEnabled, INITIAL_ADJUSTMENTS.deblurEnabled, 'legacy enabled default');
  assertEqual(legacyLoaded.deblurStrength, INITIAL_ADJUSTMENTS.deblurStrength, 'legacy strength default');
  assertEqual(legacyLoaded.deblurSigmaPx, INITIAL_ADJUSTMENTS.deblurSigmaPx, 'legacy sigma default');

  const dryRunCommand = detailDeblurCommandEnvelopeV1Schema.parse({
    actor: {
      id: 'codex-app-server',
      kind: 'agent',
      sessionId: 'session_detail_deblur_sample',
    },
    approval: {
      approvalClass: ApprovalClass.PreviewOnly,
      reason: 'Deblur dry-run validates controls without mutating preview, export, or sidecars.',
      state: 'not_required',
    },
    commandId: 'command_detail_deblur_dry_run_sample',
    commandType: 'detailDeblur.dryRunControls',
    correlationId: 'corr_detail_deblur_dry_run_sample',
    dryRun: true,
    expectedGraphRevision: 'graph_rev_1181',
    parameters: apiControls,
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    target: {
      imagePath: '/photos/session/IMG_0001.CR3',
      kind: 'image',
      virtualCopyId: null,
    },
  });

  const invalidApply = detailDeblurCommandEnvelopeV1Schema.safeParse({
    ...dryRunCommand,
    approval: {
      approvalClass: ApprovalClass.PreviewOnly,
      reason: 'Invalid applied deblur command should not pass without edit approval.',
      state: 'not_required',
    },
    commandId: 'command_detail_deblur_apply_invalid',
    commandType: 'detailDeblur.applyControls',
    correlationId: 'corr_detail_deblur_apply_invalid',
    dryRun: false,
  });
  if (invalidApply.success) {
    fail('Expected applied deblur command without edit approval to fail.');
  }

  const runtime = detailDeblurRuntimeStateV1Schema.parse({
    applyStatus: 'applied',
    doesNotProve: ['real_raw_quality', 'gpu_parity', 'e2e_workflow'],
    effectiveControls: apiControls,
    orderedAfter: 'scene_linear_denoise',
    orderedBefore: 'capture_sharpen',
    runtimeStatus: 'preview_export_parity',
    stage: 'scene_linear_post_denoise',
    warnings: ['Synthetic workflow proof exists; real RAW quality remains tracked separately.'],
  });

  detailDeblurDryRunResultV1Schema.parse({
    commandId: dryRunCommand.commandId,
    commandType: 'detailDeblur.dryRunControls',
    correlationId: dryRunCommand.correlationId,
    dryRun: true,
    mutates: false,
    parameterDiff: [
      {
        nodeId: null,
        path: '/details/deblurStrength',
        previousValue: 0,
        value: 25,
      },
    ],
    predictedGraphRevision: 'graph_rev_1181_preview',
    previewArtifacts: [],
    runtime,
    schemaVersion: 1,
    sourceGraphRevision: dryRunCommand.expectedGraphRevision,
    warnings: ['UI/API wired; runtime preview/export parity is validated by check:deblur-workflow-smoke.'],
  });

  const overclaim = detailDeblurRuntimeStateV1Schema.safeParse({
    applyStatus: 'not_executed',
    doesNotProve: ['real_raw_quality', 'gpu_parity', 'e2e_workflow'],
    effectiveControls: apiControls,
    orderedAfter: 'scene_linear_denoise',
    orderedBefore: 'capture_sharpen',
    runtimeStatus: 'ui_api_wired',
    skipReason: 'preview_export_not_proven',
    stage: 'scene_linear_post_denoise',
    warnings: ['UI/API coverage should not overclaim preview/export parity.'],
  });
  if (overclaim.success) {
    fail('Expected ui_api_wired runtime state to require preview/export parity to remain unproven.');
  }
}

function fail(message: string) {
  console.error(message);
  process.exit(1);
}

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) {
    fail(`${label}: expected ${String(expected)}, received ${String(actual)}`);
  }
}

if (import.meta.main) {
  await runDeblurWorkflowSmoke();
}
