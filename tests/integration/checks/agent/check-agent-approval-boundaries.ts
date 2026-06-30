#!/usr/bin/env bun

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  aiAppServerToolManifestV1Schema,
  negativeLabAppServerToolManifestV1Schema,
  rawEngineAgentReplayFixtureV1Schema,
  rawEngineAppServerToolCallValidationV1Schema,
  rawEngineToolRegistryV1Schema,
} from '../../../../packages/rawengine-schema/src/rawEngineSchemas.ts';

const ROOT = process.cwd();
const SAMPLES_DIR = 'packages/rawengine-schema/samples';

const ApprovalClass = {
  BatchApply: 'batch_apply',
  EditApply: 'edit_apply',
  ExternalModel: 'external_model',
  FileMutation: 'file_mutation',
  GenerativeEdit: 'generative_edit',
  PreviewOnly: 'preview_only',
  SafeRead: 'safe_read',
};

const nonMutatingApprovalClasses = new Set([
  ApprovalClass.SafeRead,
  ApprovalClass.PreviewOnly,
  ApprovalClass.ExternalModel,
]);

const mutatingApprovalClasses = new Set([
  ApprovalClass.EditApply,
  ApprovalClass.BatchApply,
  ApprovalClass.FileMutation,
  ApprovalClass.GenerativeEdit,
]);

const expectedToolKindApprovalClasses = {
  apply: mutatingApprovalClasses,
  dry_run: new Set([ApprovalClass.PreviewOnly, ApprovalClass.ExternalModel]),
  export: new Set([ApprovalClass.FileMutation, ApprovalClass.BatchApply]),
  job: new Set([ApprovalClass.BatchApply, ApprovalClass.ExternalModel]),
  preview: new Set([ApprovalClass.PreviewOnly]),
  read: new Set([ApprovalClass.SafeRead]),
};

const toAbsolutePath = (repoPath) => join(ROOT, repoPath);

const readJson = (repoPath) => JSON.parse(readFileSync(toAbsolutePath(repoPath), 'utf8'));

const pushFailure = (failures, source, message) => {
  failures.push(`${source}: ${message}`);
};

const validateRegisteredTool = (tool, source, failures) => {
  const allowedApprovalClasses = expectedToolKindApprovalClasses[tool.toolKind];

  if (!allowedApprovalClasses.has(tool.approvalClass)) {
    pushFailure(
      failures,
      source,
      `${tool.toolName} uses ${tool.approvalClass} for ${tool.toolKind}; expected one of ${[
        ...allowedApprovalClasses,
      ].join(', ')}`,
    );
  }

  if (tool.mutates && nonMutatingApprovalClasses.has(tool.approvalClass)) {
    pushFailure(failures, source, `${tool.toolName} mutates but uses non-mutating approval ${tool.approvalClass}`);
  }

  if (!tool.mutates && mutatingApprovalClasses.has(tool.approvalClass)) {
    pushFailure(failures, source, `${tool.toolName} is non-mutating but uses apply approval ${tool.approvalClass}`);
  }

  if ((tool.toolKind === 'read' || tool.toolKind === 'preview' || tool.toolKind === 'dry_run') && tool.mutates) {
    pushFailure(failures, source, `${tool.toolName} is ${tool.toolKind} but is marked mutating`);
  }

  if ((tool.toolKind === 'apply' || tool.toolKind === 'export') && !tool.mutates) {
    pushFailure(failures, source, `${tool.toolName} is ${tool.toolKind} but is not marked mutating`);
  }

  if (tool.toolKind === 'apply' && tool.approvalClass === ApprovalClass.ExternalModel) {
    pushFailure(
      failures,
      source,
      `${tool.toolName} applies state with external-model approval instead of apply approval`,
    );
  }
};

const validateAppServerTool = (tool, source, failures) => {
  const toolKind =
    tool.executionMode === 'apply_dry_run_plan'
      ? 'apply'
      : tool.executionMode === 'capability_read'
        ? 'read'
        : 'dry_run';

  validateRegisteredTool(
    {
      approvalClass: tool.approvalClass,
      mutates: tool.mutates,
      requiresDryRun: tool.requiresDryRunPlan,
      returnsArtifactHandles: tool.returnsArtifactHandles,
      toolKind,
      toolName: tool.toolName,
    },
    source,
    failures,
  );

  if (tool.executionMode === 'apply_dry_run_plan' && !tool.requiresDryRunPlan) {
    pushFailure(failures, source, `${tool.toolName} applies an app-server plan without requiring a dry-run plan`);
  }

  if (tool.executionMode === 'dry_run_command' && tool.requiresDryRunPlan) {
    pushFailure(failures, source, `${tool.toolName} is a dry-run tool but requires an existing dry-run plan`);
  }

  if (tool.mutates && !tool.recordsProvenance) {
    pushFailure(failures, source, `${tool.toolName} mutates without recording provenance`);
  }
};

const validateToolCall = (validation, source, failures) => {
  const { toolCall } = validation;
  const registryTool = validation.registry.tools.find((tool) => tool.toolName === toolCall.toolName);

  if (registryTool === undefined) {
    pushFailure(failures, source, `${toolCall.toolName} is not present in its registry`);
    return;
  }

  if (toolCall.approval.approvalClass !== registryTool.approvalClass) {
    pushFailure(
      failures,
      source,
      `${toolCall.toolName} call uses ${toolCall.approval.approvalClass}; registry requires ${registryTool.approvalClass}`,
    );
  }

  if (registryTool.mutates && toolCall.approval.state !== 'approved') {
    pushFailure(failures, source, `${toolCall.toolName} mutates without approved approval state`);
  }

  if (
    !registryTool.mutates &&
    toolCall.approval.state === 'approved' &&
    registryTool.approvalClass !== ApprovalClass.ExternalModel
  ) {
    pushFailure(failures, source, `${toolCall.toolName} has unnecessary approved state for non-mutating execution`);
  }
};

const validateReplayFixture = (fixture, source, failures) => {
  let sawInpaintEnhancementCommand = false;

  for (const step of fixture.steps) {
    if (step.inputSchemaName === 'AiEnhancementCommandEnvelopeV1' && step.input?.parameters?.capability === 'inpaint') {
      sawInpaintEnhancementCommand = true;
    }

    if (step.mutates && step.approval.state !== 'approved') {
      pushFailure(failures, source, `${step.stepId} mutates without approved approval state`);
    }

    if (step.mutates && !mutatingApprovalClasses.has(step.approval.approvalClass)) {
      pushFailure(failures, source, `${step.stepId} mutates with non-apply approval ${step.approval.approvalClass}`);
    }

    if (!step.mutates && mutatingApprovalClasses.has(step.approval.approvalClass)) {
      pushFailure(
        failures,
        source,
        `${step.stepId} is non-mutating with apply approval ${step.approval.approvalClass}`,
      );
    }
  }

  if (source.endsWith('ai-enhancement-agent-replay-fixture-v1.json') && !sawInpaintEnhancementCommand) {
    pushFailure(failures, source, 'AI enhancement replay fixture must cover inpaint capability.');
  }
};

const samplePathsMatching = (predicate) =>
  readdirSync(toAbsolutePath(SAMPLES_DIR))
    .filter((fileName) => fileName.endsWith('.json') && predicate(fileName))
    .map((fileName) => `${SAMPLES_DIR}/${fileName}`)
    .sort((a, b) => a.localeCompare(b));

const failures = [];

const registryPath = `${SAMPLES_DIR}/core/tool-registry-v1.json`;
const registry = rawEngineToolRegistryV1Schema.parse(readJson(registryPath));
for (const tool of registry.tools) {
  validateRegisteredTool(tool, registryPath, failures);
}

const aiManifestPath = `${SAMPLES_DIR}/ai-app-server-tool-manifest-v1.json`;
if (existsSync(toAbsolutePath(aiManifestPath))) {
  const manifest = aiAppServerToolManifestV1Schema.parse(readJson(aiManifestPath));
  for (const tool of manifest.tools) {
    validateAppServerTool(tool, aiManifestPath, failures);
  }
}

const negativeLabManifestPath = `${SAMPLES_DIR}/negative-lab-app-server-tool-manifest-v1.json`;
if (existsSync(toAbsolutePath(negativeLabManifestPath))) {
  const manifest = negativeLabAppServerToolManifestV1Schema.parse(readJson(negativeLabManifestPath));
  for (const tool of manifest.tools) {
    validateAppServerTool(tool, negativeLabManifestPath, failures);
  }
}

for (const samplePath of samplePathsMatching((fileName) =>
  fileName.endsWith('app-server-tool-call-validation-v1.json'),
)) {
  const validation = rawEngineAppServerToolCallValidationV1Schema.parse(readJson(samplePath));
  validateToolCall(validation, samplePath, failures);
}

for (const samplePath of samplePathsMatching((fileName) => fileName.endsWith('agent-replay-fixture-v1.json'))) {
  const fixture = rawEngineAgentReplayFixtureV1Schema.parse(readJson(samplePath));
  validateReplayFixture(fixture, samplePath, failures);
}

if (failures.length > 0) {
  console.error('Agent approval boundary validation failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(
  `Agent approval boundary validation passed for ${registry.tools.length} registry tools, ` +
    `${samplePathsMatching((fileName) => fileName.endsWith('app-server-tool-call-validation-v1.json')).length} tool call fixture(s), ` +
    `and ${samplePathsMatching((fileName) => fileName.endsWith('agent-replay-fixture-v1.json')).length} replay fixture(s).`,
);
