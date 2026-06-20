#!/usr/bin/env bun

import { createRawEngineLocalAppServerBridge } from '../../../packages/rawengine-schema/src/localAppServerBridge.ts';
import {
  sampleBasicToneAgentReplayFixtureV1,
  sampleToneColorApplyCommandEnvelopeV1,
  sampleToneColorCommandEnvelopeV1,
} from '../../../packages/rawengine-schema/src/samplePayloads.ts';
import {
  rawEngineAgentReplayFixtureV1Schema,
  toneColorDryRunResultV1Schema,
  toneColorMutationResultV1Schema,
} from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';

const failures: string[] = [];
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

const bridge = createRawEngineLocalAppServerBridge();
const rejectedApply = await createRawEngineLocalAppServerBridge().dispatch(sampleToneColorApplyCommandEnvelopeV1);
if (rejectedApply.ok || rejectedApply.reason !== 'handler_failed') {
  failures.push('Bridge must reject tone apply before matching dry-run.');
}

const dryRun = await bridge.dispatch(sampleToneColorCommandEnvelopeV1);
if (!dryRun.ok) {
  failures.push(`Bridge tone dry-run failed: ${dryRun.message}`);
} else {
  const parsedDryRun = toneColorDryRunResultV1Schema.parse(dryRun.result);
  if (parsedDryRun.mutates) failures.push('Bridge tone dry-run must be non-mutating.');
  if (!parsedDryRun.parameterDiff.some((diff) => diff.path === '/parameters/exposureEv')) {
    failures.push('Bridge tone dry-run must include exposure diff.');
  }
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

if (failures.length > 0) {
  console.error('Agent basic tone apply proof failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('agent basic tone apply proof ok (bridge+audit+raw metadata)');
