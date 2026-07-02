import { z } from 'zod';

import {
  type NegativeLabSavedPositiveHandoff,
  negativeLabSavedPositiveHandoffSchema,
} from '../../schemas/negative-lab/negativeLabPresetCatalogSchemas';

const negativeLabReopenArtifactSchema = z
  .object({
    artifactId: z.string().trim().min(1),
    conversion: z
      .object({
        frameExposureOverrides: z.unknown().optional(),
        frameRgbBalanceOverrides: z.unknown().optional(),
        outputFormat: z.enum(['jpeg_proof', 'tiff16']),
        profileProvenanceHash: z.string().trim().min(1).nullable().optional(),
        selectedAcquisitionProfile: z.unknown().optional(),
        selectedProfile: z.unknown().nullable().optional(),
      })
      .passthrough(),
    outputArtifacts: z
      .array(
        z
          .object({
            artifactId: z.string().trim().min(1),
            contentHash: z.string().trim().min(1).optional(),
            dimensions: z.object({ height: z.number().int().positive(), width: z.number().int().positive() }).strict(),
            outputIntent: z.literal('editable_positive').optional(),
            path: z.string().trim().min(1).optional(),
            positiveVariantId: z.string().trim().min(1),
          })
          .passthrough(),
      )
      .min(1),
    replay: z
      .object({
        identityHash: z.string().trim().min(1),
      })
      .passthrough(),
    sidecarPath: z.string().trim().min(1).optional(),
    sourceImageRefs: z
      .array(
        z
          .object({
            imagePath: z.string().trim().min(1),
          })
          .passthrough(),
      )
      .min(1),
    staleState: z
      .object({
        invalidationReasons: z.array(z.string().trim().min(1)).default([]),
        state: z.enum(['current', 'stale']).default('current'),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const negativeLabReopenMetadataSchema = z
  .object({
    rawEngineArtifacts: z
      .object({
        negativeLabArtifacts: z.array(negativeLabReopenArtifactSchema).default([]),
        staleArtifactIds: z.array(z.string().trim().min(1)).default([]),
        stale_artifact_ids: z.array(z.string().trim().min(1)).default([]),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type NegativeLabReopenedPositiveArtifactState = 'current' | 'missing' | 'stale';

export interface NegativeLabReopenedPositiveArtifactStatus {
  artifactId: string;
  invalidationReasons: string[];
  outputArtifactId: string | null;
  outputPath: string;
  positiveVariantId: string | null;
  sourceImageRef: string;
  state: NegativeLabReopenedPositiveArtifactState;
}

const toUniqueSortedReasons = (reasons: readonly string[]): string[] =>
  Array.from(new Set(reasons.filter((reason) => reason.trim().length > 0))).sort((a, b) => a.localeCompare(b));

export const buildNegativeLabReopenedSavedPositiveArtifactStatus = ({
  imagePath,
  metadata,
}: {
  imagePath: string;
  metadata: unknown;
}): NegativeLabReopenedPositiveArtifactStatus | null => {
  const parsedMetadata = negativeLabReopenMetadataSchema.safeParse(metadata);
  if (!parsedMetadata.success) return null;

  const rawEngineArtifacts = parsedMetadata.data.rawEngineArtifacts;
  if (rawEngineArtifacts === undefined) return null;

  const persistedStaleArtifactIds = new Set([
    ...rawEngineArtifacts.staleArtifactIds,
    ...rawEngineArtifacts.stale_artifact_ids,
  ]);

  for (const artifact of rawEngineArtifacts.negativeLabArtifacts) {
    const outputArtifact =
      artifact.outputArtifacts.find(
        (output) => output.path === imagePath && output.outputIntent === 'editable_positive',
      ) ??
      artifact.outputArtifacts.find((output) => output.path === imagePath) ??
      null;
    const sourceImageRef = artifact.sourceImageRefs[0]?.imagePath;
    if (outputArtifact === null || sourceImageRef === undefined) continue;

    const persistedReasons = artifact.staleState?.invalidationReasons ?? [];
    const isPersistedStale =
      artifact.staleState?.state === 'stale' ||
      persistedStaleArtifactIds.has(artifact.artifactId) ||
      persistedStaleArtifactIds.has(outputArtifact.artifactId);
    const reasons = toUniqueSortedReasons(
      isPersistedStale && persistedReasons.length === 0 ? ['persisted_stale_artifact_id'] : persistedReasons,
    );
    const isMissing =
      reasons.includes('output_artifact_missing') ||
      reasons.includes('source_missing') ||
      outputArtifact.contentHash === undefined;

    return {
      artifactId: artifact.artifactId,
      invalidationReasons: reasons,
      outputArtifactId: outputArtifact.artifactId,
      outputPath: outputArtifact.path ?? imagePath,
      positiveVariantId: outputArtifact.positiveVariantId,
      sourceImageRef,
      state: isMissing ? 'missing' : isPersistedStale ? 'stale' : 'current',
    };
  }

  return null;
};

export const buildNegativeLabReopenedSavedPositiveHandoff = ({
  imagePath,
  metadata,
}: {
  imagePath: string;
  metadata: unknown;
}): NegativeLabSavedPositiveHandoff | null => {
  const status = buildNegativeLabReopenedSavedPositiveArtifactStatus({ imagePath, metadata });
  if (status !== null && status.state !== 'current') return null;

  const parsedMetadata = negativeLabReopenMetadataSchema.safeParse(metadata);
  if (!parsedMetadata.success) return null;

  for (const artifact of parsedMetadata.data.rawEngineArtifacts?.negativeLabArtifacts ?? []) {
    const outputArtifact =
      artifact.outputArtifacts.find(
        (output) => output.path === imagePath && output.outputIntent === 'editable_positive',
      ) ??
      artifact.outputArtifacts.find((output) => output.path === imagePath) ??
      null;
    const sourceImageRef = artifact.sourceImageRefs[0]?.imagePath;
    if (outputArtifact === null || sourceImageRef === undefined) continue;

    const parsedHandoff = negativeLabSavedPositiveHandoffSchema.safeParse({
      artifactId: artifact.artifactId,
      conversionBundlePath: null,
      dimensions: outputArtifact.dimensions,
      frameExposureOverrides: artifact.conversion.frameExposureOverrides ?? { overrides: [], schemaVersion: 1 },
      frameRgbBalanceOverrides: artifact.conversion.frameRgbBalanceOverrides ?? { overrides: [], schemaVersion: 1 },
      outputArtifactId: outputArtifact.artifactId,
      outputFormat: artifact.conversion.outputFormat,
      outputHash: outputArtifact.contentHash,
      outputPath: imagePath,
      path: imagePath,
      positiveVariantId: outputArtifact.positiveVariantId,
      profileProvenanceHash: artifact.conversion.profileProvenanceHash ?? null,
      replayPlanHash: artifact.replay.identityHash,
      selectedAcquisitionProfile: artifact.conversion.selectedAcquisitionProfile ?? null,
      selectedProfile: artifact.conversion.selectedProfile ?? null,
      sidecarPath: artifact.sidecarPath ?? `${imagePath}.rrdata`,
      sourceImageRef,
      sourcePath: sourceImageRef,
    });
    if (parsedHandoff.success) return parsedHandoff.data;
  }

  return null;
};

export const metadataWithNegativeLabReopenedSavedPositiveHandoff = ({
  imagePath,
  metadata,
}: {
  imagePath: string;
  metadata: unknown;
}): unknown => {
  const handoff = buildNegativeLabReopenedSavedPositiveHandoff({ imagePath, metadata });
  const artifactStatus = buildNegativeLabReopenedSavedPositiveArtifactStatus({ imagePath, metadata });
  if (artifactStatus === null || typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
    return metadata;
  }

  return {
    ...metadata,
    ...(handoff === null ? {} : { rawEngineNegativeLabHandoff: handoff }),
    rawEngineNegativeLabPositiveStatus: artifactStatus,
  };
};
