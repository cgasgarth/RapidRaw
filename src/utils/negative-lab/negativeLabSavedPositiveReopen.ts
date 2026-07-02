import { z } from 'zod';

import {
  type NegativeLabSavedPositiveHandoff,
  negativeLabSavedPositiveHandoffSchema,
} from '../../schemas/negative-lab/negativeLabPresetCatalogSchemas';

const negativeLabReopenArtifactSchema = z
  .object({
    artifactId: z.string().trim().min(1),
    conversionBundlePath: z.string().trim().min(1).optional(),
    conversion: z
      .object({
        conversionBundlePath: z.string().trim().min(1).optional(),
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

export interface NegativeLabReopenedPositiveProvenance {
  artifactId: string;
  conversionBundlePath: string | null;
  invalidationReasons: string[];
  outputArtifactId: string;
  outputFormat: 'jpeg_proof' | 'tiff16';
  outputHash: string | null;
  outputPath: string;
  positiveVariantId: string;
  profileProvenanceHash: string | null;
  replayPlanHash: string;
  sidecarPath: string | null;
  sourcePath: string;
  state: NegativeLabReopenedPositiveArtifactState;
}

const toUniqueSortedReasons = (reasons: readonly string[]): string[] =>
  Array.from(new Set(reasons.filter((reason) => reason.trim().length > 0))).sort((a, b) => a.localeCompare(b));

interface NegativeLabReopenArtifactMatch {
  artifact: z.infer<typeof negativeLabReopenArtifactSchema>;
  outputArtifact: z.infer<typeof negativeLabReopenArtifactSchema>['outputArtifacts'][number];
  sourceImageRef: string;
  state: NegativeLabReopenedPositiveArtifactState;
  invalidationReasons: string[];
}

const findNegativeLabReopenArtifactMatch = (
  imagePath: string,
  metadata: unknown,
): NegativeLabReopenArtifactMatch | null => {
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
      artifact,
      invalidationReasons: reasons,
      outputArtifact,
      sourceImageRef,
      state: isMissing ? 'missing' : isPersistedStale ? 'stale' : 'current',
    };
  }

  return null;
};

export const buildNegativeLabReopenedSavedPositiveArtifactStatus = ({
  imagePath,
  metadata,
}: {
  imagePath: string;
  metadata: unknown;
}): NegativeLabReopenedPositiveArtifactStatus | null => {
  const match = findNegativeLabReopenArtifactMatch(imagePath, metadata);
  if (match === null) return null;

  return {
    artifactId: match.artifact.artifactId,
    invalidationReasons: match.invalidationReasons,
    outputArtifactId: match.outputArtifact.artifactId,
    outputPath: match.outputArtifact.path ?? imagePath,
    positiveVariantId: match.outputArtifact.positiveVariantId,
    sourceImageRef: match.sourceImageRef,
    state: match.state,
  };
};

export const buildNegativeLabReopenedSavedPositiveProvenance = ({
  imagePath,
  metadata,
}: {
  imagePath: string;
  metadata: unknown;
}): NegativeLabReopenedPositiveProvenance | null => {
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) return null;

  const rawHandoffValue = (metadata as Record<string, unknown>)['rawEngineNegativeLabHandoff'];
  const parsedHandoff = negativeLabSavedPositiveHandoffSchema.safeParse(rawHandoffValue);
  if (parsedHandoff.success && parsedHandoff.data.path === imagePath) {
    return {
      artifactId: parsedHandoff.data.artifactId,
      conversionBundlePath: parsedHandoff.data.conversionBundlePath,
      invalidationReasons: [],
      outputArtifactId: parsedHandoff.data.outputArtifactId,
      outputFormat: parsedHandoff.data.outputFormat,
      outputHash: parsedHandoff.data.outputHash,
      outputPath: parsedHandoff.data.outputPath,
      positiveVariantId: parsedHandoff.data.positiveVariantId,
      profileProvenanceHash: parsedHandoff.data.profileProvenanceHash,
      replayPlanHash: parsedHandoff.data.replayPlanHash,
      sidecarPath: parsedHandoff.data.sidecarPath,
      sourcePath: parsedHandoff.data.sourcePath,
      state: 'current',
    };
  }

  const match = findNegativeLabReopenArtifactMatch(imagePath, metadata);
  if (match === null) return null;

  const conversionBundlePath =
    match.artifact.conversionBundlePath ?? match.artifact.conversion.conversionBundlePath ?? null;
  const sidecarPath = match.artifact.sidecarPath ?? null;

  return {
    artifactId: match.artifact.artifactId,
    conversionBundlePath,
    invalidationReasons: match.invalidationReasons,
    outputArtifactId: match.outputArtifact.artifactId,
    outputFormat: match.artifact.conversion.outputFormat,
    outputHash: match.outputArtifact.contentHash ?? null,
    outputPath: match.outputArtifact.path ?? imagePath,
    positiveVariantId: match.outputArtifact.positiveVariantId,
    profileProvenanceHash: match.artifact.conversion.profileProvenanceHash ?? null,
    replayPlanHash: match.artifact.replay.identityHash,
    sidecarPath,
    sourcePath: match.sourceImageRef,
    state: match.state,
  };
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
    const conversionBundlePath = artifact.conversionBundlePath ?? artifact.conversion.conversionBundlePath ?? null;

    const parsedHandoff = negativeLabSavedPositiveHandoffSchema.safeParse({
      artifactId: artifact.artifactId,
      conversionBundlePath,
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
