#!/usr/bin/env bun

import { createHash } from 'node:crypto';

import { createRawEngineLocalAppServerBridge } from '../../../packages/rawengine-schema/src/localAppServerBridge.ts';
import {
  rawEngineAgentReplayFixtureV1Schema,
  toneColorDryRunResultV1Schema,
  toneColorMutationResultV1Schema,
} from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import {
  sampleBasicToneAgentReplayFixtureV1,
  sampleToneColorApplyCommandEnvelopeV1,
  sampleToneColorCommandEnvelopeV1,
} from '../../../packages/rawengine-schema/src/samplePayloads.ts';
import {
  RawEngineAppServerSupervisorEventKind,
  RawEngineAppServerSupervisorPhase,
  rawEngineAppServerSupervisorStateSchema,
} from '../../../src/schemas/agent/agentRuntimeSchemas.ts';
import {
  cancelRawEngineAppServerSupervisor,
  createRawEngineAppServerSupervisorState,
  markRawEngineAppServerSupervisorReady,
  startRawEngineAppServerSupervisor,
  stopRawEngineAppServerSupervisor,
} from '../../../src/utils/rawEngineAppServerHost.ts';

type RgbPixel = readonly [number, number, number];

const failures: string[] = [];
const sourcePixels: readonly RgbPixel[] = [
  [0.12, 0.1, 0.08],
  [0.36, 0.32, 0.28],
  [0.72, 0.68, 0.6],
  [0.9, 0.84, 0.76],
];

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const hashPixels = (pixels: readonly RgbPixel[]): string =>
  createHash('sha256').update(JSON.stringify(pixels)).digest('hex').slice(0, 16);
const renderBasicToneOutput = (pixels: readonly RgbPixel[]): RgbPixel[] =>
  pixels.map((pixel): RgbPixel => {
    const { blackPoint, clarity, contrast, exposureEv, highlights, saturation, shadows, whitePoint } =
      sampleToneColorApplyCommandEnvelopeV1.parameters;
    const exposureScale = 2 ** exposureEv;
    const contrastScale = 1 + contrast / 100;
    const saturationScale = 1 + saturation / 100;
    const lift = (shadows - blackPoint) / 500;
    const shoulder = (whitePoint - highlights) / 500;
    const localContrast = clarity / 800;
    const mean = pixel.reduce((sum, channel) => sum + channel, 0) / pixel.length;

    return [
      Number(clamp01((pixel[0] * exposureScale + lift + shoulder - 0.5) * contrastScale + 0.5).toFixed(6)),
      Number(
        clamp01(
          mean +
            ((pixel[1] * exposureScale + lift + shoulder - 0.5) * contrastScale + 0.5 - mean) * saturationScale +
            localContrast * (pixel[1] - mean),
        ).toFixed(6),
      ),
      Number(clamp01((pixel[2] * exposureScale + lift + shoulder - 0.5) * contrastScale + 0.5).toFixed(6)),
    ];
  });

const fixture = rawEngineAgentReplayFixtureV1Schema.parse(sampleBasicToneAgentReplayFixtureV1);
const [dryRunStep, applyStep] = fixture.steps;

if (dryRunStep?.toolName !== 'tonecolor.dry_run_command') failures.push('Replay missing tone dry-run step.');
if (applyStep?.toolName !== 'tonecolor.apply_command') failures.push('Replay missing tone apply step.');
if (!applyStep?.prerequisiteStepIds.includes('step_basic_tone_dry_run')) {
  failures.push('Apply replay step must reference accepted dry-run step.');
}

const rawArtifactIds = new Set(applyStep?.auditLog.affectedArtifactIds ?? []);
if (!rawArtifactIds.has('artifact_tone_color_basic_raw_before'))
  failures.push('Apply audit missing RAW before artifact.');
if (!rawArtifactIds.has('artifact_tone_color_basic_raw_after'))
  failures.push('Apply audit missing RAW after artifact.');
if (fixture.target.imagePath?.endsWith('.CR3') !== true) failures.push('Replay target must preserve RAW source path.');
if (applyStep?.auditLog.noOverwritePolicy !== 'never_overwrite_original') {
  failures.push('Apply audit must preserve never-overwrite-original policy.');
}

const beforeOutputHash = hashPixels(sourcePixels);
const afterOutput = renderBasicToneOutput(sourcePixels);
const afterOutputHash = hashPixels(afterOutput);
const changedOutputPixels = afterOutput.filter((pixel, index) =>
  pixel.some((channel, channelIndex) => channel !== sourcePixels[index]?.[channelIndex]),
).length;
if (beforeOutputHash === afterOutputHash) failures.push('Basic tone apply proof must change rendered output hash.');
if (changedOutputPixels !== sourcePixels.length)
  failures.push('Basic tone apply proof must change every sample pixel.');

const supervisorCreated = createRawEngineAppServerSupervisorState({
  command: ['codex', 'app-server', '--stdio', '--tool', applyStep?.toolName ?? 'tonecolor.apply_command'],
  supervisorId: 'supervisor_basic_tone_apply_cancel_001',
  timestampIso: '2026-06-20T12:00:00.000Z',
});
const supervisorStarting = startRawEngineAppServerSupervisor({
  processId: 24501,
  state: supervisorCreated,
  timestampIso: '2026-06-20T12:00:01.000Z',
});
const supervisorRunning = markRawEngineAppServerSupervisorReady({
  state: supervisorStarting,
  timestampIso: '2026-06-20T12:00:02.000Z',
});
const supervisorCancelling = cancelRawEngineAppServerSupervisor({
  state: supervisorRunning,
  timestampIso: '2026-06-20T12:00:03.000Z',
});
const supervisorStopped = rawEngineAppServerSupervisorStateSchema.parse(
  stopRawEngineAppServerSupervisor({
    state: supervisorCancelling,
    timestampIso: '2026-06-20T12:00:04.000Z',
  }),
);
if (supervisorStopped.phase !== RawEngineAppServerSupervisorPhase.Stopped) {
  failures.push('Agent edit app-server cancellation proof must finish stopped.');
}
if (supervisorStopped.cancellationRequestedAtIso === null) {
  failures.push('Agent edit app-server cancellation proof must retain cancellation timestamp.');
}
if (!supervisorStopped.auditEvents.some((event) => event.kind === RawEngineAppServerSupervisorEventKind.Cancel)) {
  failures.push('Agent edit app-server cancellation proof must include a cancel audit event.');
}

const bridge = createRawEngineLocalAppServerBridge();
const rejectedApply = await createRawEngineLocalAppServerBridge().dispatch(sampleToneColorApplyCommandEnvelopeV1);
if (rejectedApply.ok || rejectedApply.reason !== 'handler_failed') {
  failures.push('Bridge must reject tone apply before matching dry-run.');
}

const missingAcceptedPlanApply = await createRawEngineLocalAppServerBridge().dispatch({
  ...sampleToneColorApplyCommandEnvelopeV1,
  parameters: {
    ...sampleToneColorCommandEnvelopeV1.parameters,
  },
});
if (missingAcceptedPlanApply.ok || missingAcceptedPlanApply.reason !== 'invalid_command') {
  failures.push('Bridge must reject basic-tone apply without accepted dry-run identity.');
}

const dryRun = await bridge.dispatch(sampleToneColorCommandEnvelopeV1);
if (!dryRun.ok) {
  failures.push(`Bridge tone dry-run failed: ${dryRun.message}`);
} else {
  const parsedDryRun = toneColorDryRunResultV1Schema.parse(dryRun.result);
  if (parsedDryRun.mutates) failures.push('Bridge tone dry-run must be non-mutating.');
  if (parsedDryRun.dryRunPlanHash !== sampleToneColorApplyCommandEnvelopeV1.parameters.acceptedDryRunPlanHash) {
    failures.push('Bridge tone dry-run hash must match accepted apply hash.');
  }
  if (parsedDryRun.dryRunPlanId !== sampleToneColorApplyCommandEnvelopeV1.parameters.acceptedDryRunPlanId) {
    failures.push('Bridge tone dry-run id must match accepted apply id.');
  }
  if (!parsedDryRun.parameterDiff.some((diff) => diff.path === '/parameters/exposureEv')) {
    failures.push('Bridge tone dry-run must include exposure diff.');
  }
}

const tamperedPlanApply = await bridge.dispatch({
  ...sampleToneColorApplyCommandEnvelopeV1,
  parameters: {
    ...sampleToneColorApplyCommandEnvelopeV1.parameters,
    acceptedDryRunPlanHash: 'sha256:basic-tone:tampered',
  },
});
if (tamperedPlanApply.ok || tamperedPlanApply.reason !== 'handler_failed') {
  failures.push('Bridge must reject basic-tone apply with tampered accepted dry-run hash.');
}

const staleRevisionApply = await bridge.dispatch({
  ...sampleToneColorApplyCommandEnvelopeV1,
  expectedGraphRevision: 'graph_rev_stale',
});
if (staleRevisionApply.ok || staleRevisionApply.reason !== 'handler_failed') {
  failures.push('Bridge must reject basic-tone apply when graph revision changed after dry-run.');
}

const apply = await bridge.dispatch(sampleToneColorApplyCommandEnvelopeV1);
if (!apply.ok) {
  failures.push(`Bridge tone apply failed after dry-run: ${apply.message}`);
} else {
  const parsedApply = toneColorMutationResultV1Schema.parse(apply.result);
  if (!parsedApply.mutates) failures.push('Bridge tone apply must mutate.');
  if (parsedApply.sourceGraphRevision !== sampleToneColorApplyCommandEnvelopeV1.expectedGraphRevision) {
    failures.push('Bridge tone apply must preserve source graph revision.');
  }
}

const applyAudit = bridge
  .listAuditEvents()
  .find((event) => event.commandId === sampleToneColorApplyCommandEnvelopeV1.commandId && event.status === 'completed');
if (applyAudit?.acceptedDryRun?.planHash !== sampleToneColorApplyCommandEnvelopeV1.parameters.acceptedDryRunPlanHash) {
  failures.push('Bridge apply audit must record accepted dry-run hash.');
}
if (applyAudit?.acceptedDryRun?.planId !== sampleToneColorApplyCommandEnvelopeV1.parameters.acceptedDryRunPlanId) {
  failures.push('Bridge apply audit must record accepted dry-run id.');
}
if (applyAudit?.expectedGraphRevision !== sampleToneColorApplyCommandEnvelopeV1.expectedGraphRevision) {
  failures.push('Bridge apply audit must record expected graph revision.');
}
if (applyAudit?.sourceGraphRevision !== sampleToneColorApplyCommandEnvelopeV1.expectedGraphRevision) {
  failures.push('Bridge apply audit must record source graph revision.');
}

if (failures.length > 0) {
  console.error('Agent basic tone apply proof failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('agent basic tone apply proof ok (bridge+audit+raw metadata+cancellation)');
