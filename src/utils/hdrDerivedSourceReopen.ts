import { z } from 'zod';

import {
  type DerivedOutputReceipt,
  derivedOutputProvenanceSidecarSchema,
  derivedOutputReceiptSchema,
} from '../schemas/computational-merge/derivedOutputReceiptSchemas';

const hdrSidecarArtifactSchema = z
  .object({
    dryRun: z
      .object({
        acceptedDryRunPlanHash: z.string().trim().min(1),
        acceptedDryRunPlanId: z.string().trim().min(1),
      })
      .passthrough()
      .optional(),
    editableDerivedAssetId: z.string().trim().min(1).optional(),
    family: z.literal('hdr'),
    outputArtifact: z
      .object({
        artifactId: z.string().trim().min(1).optional(),
        contentHash: z.string().trim().min(1).optional(),
      })
      .passthrough()
      .optional(),
    staleState: z
      .object({
        state: z.enum(['current', 'stale', 'unknown']),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const rawEngineArtifactsWithHdrProvenanceSchema = z
  .object({
    derivedOutputProvenanceSidecars: z.array(derivedOutputProvenanceSidecarSchema).default([]),
    hdrMergeArtifacts: z.array(hdrSidecarArtifactSchema).default([]),
    schemaVersion: z.literal(1),
  })
  .passthrough();

const metadataWithRawEngineArtifactsSchema = z
  .object({
    rawEngineArtifacts: rawEngineArtifactsWithHdrProvenanceSchema.optional(),
  })
  .passthrough();

export const buildHdrReopenedDerivedOutputReceipt = ({
  imagePath,
  metadata,
}: {
  imagePath: string;
  metadata: unknown;
}): DerivedOutputReceipt | null => {
  const parsedMetadata = metadataWithRawEngineArtifactsSchema.safeParse(metadata);
  if (!parsedMetadata.success) return null;

  const rawEngineArtifacts = parsedMetadata.data.rawEngineArtifacts;
  const provenance = rawEngineArtifacts?.derivedOutputProvenanceSidecars.find(
    (sidecar) => sidecar.receipt.family === 'hdr' && sidecar.output.path === imagePath,
  );
  if (provenance === undefined || provenance.sourceState.length < 2) return null;

  const matchingArtifact = rawEngineArtifacts?.hdrMergeArtifacts.find(
    (artifact) =>
      artifact.family === 'hdr' &&
      (artifact.outputArtifact?.contentHash === provenance.output.contentHash ||
        artifact.editableDerivedAssetId === provenance.acceptedApplyId ||
        artifact.outputArtifact?.artifactId === provenance.acceptedApplyId),
  );
  const outputArtifactId =
    matchingArtifact?.editableDerivedAssetId ??
    provenance.acceptedApplyId ??
    matchingArtifact?.outputArtifact?.artifactId ??
    provenance.receipt.receiptId;

  return derivedOutputReceiptSchema.parse({
    acceptedDryRunPlanHash: matchingArtifact?.dryRun?.acceptedDryRunPlanHash,
    acceptedDryRunPlanId: matchingArtifact?.dryRun?.acceptedDryRunPlanId ?? provenance.acceptedDryRunId,
    family: 'hdr',
    openInEditorAction: {
      label: 'Open HDR output',
      path: imagePath,
      state: 'available',
    },
    outputArtifactId,
    outputContentHash: provenance.output.contentHash,
    outputPath: imagePath,
    provenanceSidecar: provenance,
    receiptId: provenance.receipt.receiptId,
    settingsHash: provenance.settingsHash,
    sourceContentHashes: provenance.sourceState.map((source) => source.contentHash),
    sourceCount: provenance.sourceState.length,
    sourceGraphRevisions: provenance.sourceState.map((source) => source.graphRevision),
    staleReasons: undefined,
    staleState: matchingArtifact?.staleState?.state === 'current' ? 'current' : 'unknown',
    storagePolicy: 'export_path',
  });
};

export const upsertHdrReopenedDerivedOutputReceipt = ({
  imagePath,
  metadata,
  upsert,
}: {
  imagePath: string;
  metadata: unknown;
  upsert: (receipt: DerivedOutputReceipt) => void;
}): DerivedOutputReceipt | null => {
  const receipt = buildHdrReopenedDerivedOutputReceipt({ imagePath, metadata });
  if (receipt !== null) upsert(receipt);
  return receipt;
};
