import { z } from 'zod';

import {
  computationalMergeCommandEnvelopeV1Schema,
  computationalMergeMutationResultV1Schema,
  hdrMergeArtifactV1Schema,
  RAW_ENGINE_SCHEMA_VERSION,
  type ComputationalMergeCommandEnvelopeV1,
  type ComputationalMergeMutationResultV1,
  type HdrMergeArtifactV1,
} from './rawEngineSchemas.js';

export const hdrEditableSourceMutationOptionsV1Schema = z
  .object({
    appliedGraphRevision: z.string().trim().min(1),
    changedNodeId: z.string().trim().min(1),
    undoRevision: z.string().trim().min(1),
  })
  .strict();

export type HdrEditableSourceMutationOptionsV1 = z.infer<typeof hdrEditableSourceMutationOptionsV1Schema>;

export const createHdrEditableSourceMutationResultV1 = (
  commandValue: unknown,
  artifactValue: unknown,
  optionsValue: unknown,
): ComputationalMergeMutationResultV1 => {
  const command = computationalMergeCommandEnvelopeV1Schema.parse(commandValue);
  const artifact = hdrMergeArtifactV1Schema.parse(artifactValue);
  const options = hdrEditableSourceMutationOptionsV1Schema.parse(optionsValue);

  validateHdrApplyCommand(command);
  validateEditableHdrArtifact(artifact);

  if (command.parameters.acceptedDryRunPlanId !== artifact.dryRun.acceptedDryRunPlanId) {
    throw new Error('HDR editable source mutation requires the accepted dry-run plan id to match the artifact.');
  }

  if (command.parameters.acceptedDryRunPlanHash !== artifact.dryRun.acceptedDryRunPlanHash) {
    throw new Error('HDR editable source mutation requires the accepted dry-run plan hash to match the artifact.');
  }

  return computationalMergeMutationResultV1Schema.parse({
    appliedGraphRevision: options.appliedGraphRevision,
    changedNodeIds: [options.changedNodeId],
    commandId: command.commandId,
    commandType: command.commandType,
    correlationId: command.correlationId,
    derivedAssetId: artifact.editableDerivedAssetId,
    dryRun: false,
    mutates: true,
    outputArtifacts: [artifact.outputArtifact, ...artifact.previewArtifacts],
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    sourceGraphRevision: command.expectedGraphRevision,
    undoRevision: options.undoRevision,
    warnings: artifact.warningCodes,
  });
};

const validateHdrApplyCommand = (command: ComputationalMergeCommandEnvelopeV1) => {
  if (command.commandType !== 'computationalMerge.createHdr') {
    throw new Error('HDR editable source mutation requires computationalMerge.createHdr.');
  }

  if (command.dryRun) {
    throw new Error('HDR editable source mutation requires an apply command, not a dry run.');
  }
};

const validateEditableHdrArtifact = (artifact: HdrMergeArtifactV1) => {
  if (artifact.editableDerivedAssetId === undefined) {
    throw new Error('HDR editable source mutation requires editableDerivedAssetId.');
  }

  if (artifact.blockCodes.length > 0 || artifact.bracketDetection.blockCodes.length > 0) {
    throw new Error('HDR editable source mutation requires a non-blocked HDR artifact.');
  }

  if (!artifact.bracketDetection.accepted) {
    throw new Error('HDR editable source mutation requires accepted bracket detection.');
  }

  if (artifact.staleState.state !== 'current') {
    throw new Error('HDR editable source mutation requires a current HDR artifact.');
  }

  if (artifact.outputArtifact.kind !== 'merge_output' || artifact.outputArtifact.storage !== 'sidecar_artifact') {
    throw new Error('HDR editable source mutation requires a durable merge output artifact.');
  }
};
