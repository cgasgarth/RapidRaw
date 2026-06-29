import {
  RAW_ENGINE_SCHEMA_VERSION,
  computationalMergeDerivedSourceOpenRequestV1Schema,
  computationalMergeDerivedSourceOpenResultV1Schema,
  type ComputationalMergeDerivedSourceOpenRequestV1,
  type ComputationalMergeDerivedSourceOpenResultV1,
} from './rawEngineSchemas.js';

export function openComputationalMergeDerivedSourceV1(value: unknown): ComputationalMergeDerivedSourceOpenResultV1 {
  const request = computationalMergeDerivedSourceOpenRequestV1Schema.parse(value);
  return buildComputationalMergeDerivedSourceOpenResultV1(request);
}

function buildComputationalMergeDerivedSourceOpenResultV1(
  request: ComputationalMergeDerivedSourceOpenRequestV1,
): ComputationalMergeDerivedSourceOpenResultV1 {
  return computationalMergeDerivedSourceOpenResultV1Schema.parse({
    appliedGraphRevision: request.mutationResult.appliedGraphRevision,
    derivedSourceId: `derived_source_${request.receipt.family}_${request.receipt.receiptId}`,
    family: request.receipt.family,
    mutates: true,
    openPath: request.receipt.openInEditorAction.path,
    outputArtifactId: request.receipt.outputArtifactId,
    ...(request.receipt.provenanceSidecarPath === undefined
      ? {}
      : { provenanceSidecarPath: request.receipt.provenanceSidecarPath }),
    receiptId: request.receipt.receiptId,
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    sourceMutationCommandId: request.mutationResult.commandId,
  });
}
