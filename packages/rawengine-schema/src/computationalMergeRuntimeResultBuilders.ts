import {
  type ArtifactHandleV1,
  artifactHandleV1Schema,
  type ComputationalMergeCommandEnvelopeV1,
  type ComputationalMergeDryRunResultV1,
  type ComputationalMergeMutationResultV1,
  computationalMergeDryRunResultV1Schema,
  computationalMergeMutationResultV1Schema,
  RAW_ENGINE_SCHEMA_VERSION,
} from './rawEngineSchemas.js';

export interface ComputationalMergeArtifactHandleInputV1 {
  artifactId: string;
  contentHash: string;
  height: number;
  kind: ArtifactHandleV1['kind'];
  storage: ArtifactHandleV1['storage'];
  width: number;
}

export const buildComputationalMergeArtifactHandleV1 = ({
  artifactId,
  contentHash,
  height,
  kind,
  storage,
  width,
}: ComputationalMergeArtifactHandleInputV1): ArtifactHandleV1 =>
  artifactHandleV1Schema.parse({
    artifactId,
    contentHash,
    dimensions: { height, width },
    kind,
    storage,
  });

export interface ComputationalMergeDryRunResultInputV1 {
  command: ComputationalMergeCommandEnvelopeV1;
  mergePlan: unknown;
  predictedGraphRevision: string;
  previewArtifacts: ArtifactHandleV1[];
  warnings: string[];
}

export const buildComputationalMergeDryRunResultV1 = ({
  command,
  mergePlan,
  predictedGraphRevision,
  previewArtifacts,
  warnings,
}: ComputationalMergeDryRunResultInputV1): ComputationalMergeDryRunResultV1 =>
  computationalMergeDryRunResultV1Schema.parse({
    commandId: command.commandId,
    commandType: command.commandType,
    correlationId: command.correlationId,
    dryRun: true,
    mergePlan,
    mutates: false,
    predictedGraphRevision,
    previewArtifacts,
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    sourceGraphRevision: command.expectedGraphRevision,
    warnings,
  });

export interface ComputationalMergeMutationResultInputV1 {
  appliedGraphRevision: string;
  changedNodeIds: string[];
  command: ComputationalMergeCommandEnvelopeV1;
  derivedAssetId: string;
  outputArtifacts: ArtifactHandleV1[];
  undoRevision: string;
  warnings: string[];
}

export const buildComputationalMergeMutationResultV1 = ({
  appliedGraphRevision,
  changedNodeIds,
  command,
  derivedAssetId,
  outputArtifacts,
  undoRevision,
  warnings,
}: ComputationalMergeMutationResultInputV1): ComputationalMergeMutationResultV1 =>
  computationalMergeMutationResultV1Schema.parse({
    appliedGraphRevision,
    changedNodeIds,
    commandId: command.commandId,
    commandType: command.commandType,
    correlationId: command.correlationId,
    derivedAssetId,
    dryRun: false,
    mutates: true,
    outputArtifacts,
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    sourceGraphRevision: command.expectedGraphRevision,
    undoRevision,
    warnings,
  });
