#!/usr/bin/env bun

import { sampleRawEngineAgentReplayFixtureV1 } from '../../../packages/rawengine-schema/src/samplePayloads.ts';
import { rawEngineAgentReplayFixtureV1Schema } from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';

const fixture = rawEngineAgentReplayFixtureV1Schema.parse(sampleRawEngineAgentReplayFixtureV1);

const fail = (message) => {
  throw new Error(message);
};

const findStep = (stepId) => fixture.steps.find((step) => step.stepId === stepId) ?? fail(`Missing ${stepId}.`);

const dryRunStep = findStep('step_edit_graph_dry_run');
const applyStep = findStep('step_edit_graph_apply');
const rollbackStep = findStep('step_edit_graph_rollback');

if (!dryRunStep.dryRun || dryRunStep.mutates) {
  fail('Dry-run step must be non-mutating.');
}

if (!applyStep.prerequisiteStepIds.includes(dryRunStep.stepId)) {
  fail('Apply step must depend on the accepted dry-run step.');
}

if (!rollbackStep.prerequisiteStepIds.includes(applyStep.stepId)) {
  fail('Rollback step must depend on the applied mutation step.');
}

for (const step of fixture.steps) {
  if (step.auditLog.noOverwritePolicy !== 'never_overwrite_original') {
    fail(`${step.stepId} does not preserve originals by default.`);
  }

  if (step.auditLog.affectedImageIds.length === 0 || step.auditLog.parameterDiff.length === 0) {
    fail(`${step.stepId} audit log is missing affected images or parameter diffs.`);
  }

  if (step.auditLog.toolCall.toolName !== step.toolName || step.auditLog.toolCall.toolKind !== step.toolKind) {
    fail(`${step.stepId} audit log does not identify the executed tool call.`);
  }
}

if (applyStep.auditLog.rollbackPoint?.graphRevision !== fixture.initialGraphRevision) {
  fail('Apply audit log must preserve the pre-apply rollback graph revision.');
}

if (rollbackStep.input.commandType !== 'editGraph.revertToRevision') {
  fail('Rollback step must invoke editGraph.revertToRevision.');
}

if (rollbackStep.input.parameters.graphRevision !== fixture.initialGraphRevision) {
  fail('Rollback command must target the initial graph revision.');
}

if (rollbackStep.output.appliedGraphRevision !== fixture.initialGraphRevision) {
  fail('Rollback output must restore the initial graph revision.');
}

if (fixture.finalGraphRevision !== fixture.initialGraphRevision) {
  fail('Replay final graph revision must prove rollback completion.');
}

console.log('agent rollback proof ok');
