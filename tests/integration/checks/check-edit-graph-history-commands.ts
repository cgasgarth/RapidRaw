#!/usr/bin/env bun

import {
  ApprovalClass,
  editGraphCommandEnvelopeV1Schema,
  editGraphDryRunResultV1Schema,
  editGraphMutationResultV1Schema,
  RAW_ENGINE_SCHEMA_VERSION,
} from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import {
  sampleEditGraphCommandEnvelopeV1,
  sampleEditGraphSnapshotV1,
} from '../../../packages/rawengine-schema/src/samplePayloads.ts';

const failures = [];

const expectValid = (name, schema, value) => {
  const result = schema.safeParse(value);
  if (!result.success) failures.push(`${name}: expected valid payload.`);
};

const expectInvalid = (name, schema, value) => {
  const result = schema.safeParse(value);
  if (result.success) failures.push(`${name}: expected invalid payload.`);
};

const historyCommand = (commandType, overrides = {}) => ({
  ...sampleEditGraphCommandEnvelopeV1,
  approval: {
    approvalClass: ApprovalClass.PreviewOnly,
    reason: `Preview ${commandType} history movement before mutating the edit graph.`,
    state: 'not_required',
  },
  commandId: `command_${commandType.replaceAll('.', '_')}_sample`,
  commandType,
  correlationId: `corr_${commandType.replaceAll('.', '_')}_sample`,
  dryRun: true,
  expectedGraphRevision: sampleEditGraphSnapshotV1.graphRevision,
  idempotencyKey: `idem_${commandType.replaceAll('.', '_')}_sample`,
  parameters: {
    steps: 1,
  },
  ...overrides,
});

const undoDryRunCommand = historyCommand('editGraph.undo');
const redoDryRunCommand = historyCommand('editGraph.redo');
const undoApplyCommand = historyCommand('editGraph.undo', {
  approval: {
    approvalClass: ApprovalClass.EditApply,
    reason: 'Apply an accepted undo command to move the edit graph history cursor back.',
    state: 'approved',
  },
  commandId: 'command_editGraph_undo_apply_sample',
  correlationId: 'corr_editGraph_undo_apply_sample',
  dryRun: false,
  idempotencyKey: 'idem_editGraph_undo_apply_sample',
});
const redoApplyCommand = historyCommand('editGraph.redo', {
  approval: {
    approvalClass: ApprovalClass.EditApply,
    reason: 'Apply an accepted redo command to move the edit graph history cursor forward.',
    state: 'approved',
  },
  commandId: 'command_editGraph_redo_apply_sample',
  correlationId: 'corr_editGraph_redo_apply_sample',
  dryRun: false,
  idempotencyKey: 'idem_editGraph_redo_apply_sample',
});

expectValid('undo dry-run command', editGraphCommandEnvelopeV1Schema, undoDryRunCommand);
expectValid('redo dry-run command', editGraphCommandEnvelopeV1Schema, redoDryRunCommand);
expectValid('undo apply command', editGraphCommandEnvelopeV1Schema, undoApplyCommand);
expectValid('redo apply command', editGraphCommandEnvelopeV1Schema, redoApplyCommand);

expectInvalid('undo with zero steps', editGraphCommandEnvelopeV1Schema, {
  ...undoDryRunCommand,
  parameters: { steps: 0 },
});
expectInvalid('redo above step limit', editGraphCommandEnvelopeV1Schema, {
  ...redoDryRunCommand,
  parameters: { steps: 101 },
});
expectInvalid('undo apply without approved state', editGraphCommandEnvelopeV1Schema, {
  ...undoApplyCommand,
  approval: {
    ...undoApplyCommand.approval,
    state: 'pending',
  },
});
expectInvalid('redo dry-run with edit apply approval', editGraphCommandEnvelopeV1Schema, {
  ...redoDryRunCommand,
  approval: {
    ...redoDryRunCommand.approval,
    approvalClass: ApprovalClass.EditApply,
  },
});

expectValid('undo dry-run result', editGraphDryRunResultV1Schema, {
  commandId: undoDryRunCommand.commandId,
  commandType: undoDryRunCommand.commandType,
  correlationId: undoDryRunCommand.correlationId,
  dryRun: true,
  mutates: false,
  parameterDiff: [],
  predictedGraphRevision: sampleEditGraphSnapshotV1.history[0]?.graphRevision ?? 'graph_rev_43',
  previewArtifacts: [],
  schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
  sourceGraphRevision: sampleEditGraphSnapshotV1.graphRevision,
  warnings: [],
});
expectValid('redo mutation result', editGraphMutationResultV1Schema, {
  appliedGraphRevision: 'graph_rev_45',
  changedNodeIds: ['node_agent_refinement'],
  commandId: redoApplyCommand.commandId,
  commandType: redoApplyCommand.commandType,
  correlationId: redoApplyCommand.correlationId,
  dryRun: false,
  mutates: true,
  schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
  sourceGraphRevision: sampleEditGraphSnapshotV1.history[0]?.graphRevision ?? 'graph_rev_43',
  undoRevision: sampleEditGraphSnapshotV1.graphRevision,
  warnings: [],
});

if (failures.length > 0) {
  console.error('Edit graph history command validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Edit graph undo/redo command validation ok.');
