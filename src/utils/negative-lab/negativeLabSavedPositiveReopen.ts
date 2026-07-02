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
            contentHash: z.string().trim().min(1),
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
  })
  .passthrough();

const negativeLabReopenMetadataSchema = z
  .object({
    rawEngineArtifacts: z
      .object({
        negativeLabArtifacts: z.array(negativeLabReopenArtifactSchema).default([]),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const buildNegativeLabReopenedSavedPositiveHandoff = ({
  imagePath,
  metadata,
}: {
  imagePath: string;
  metadata: unknown;
}): NegativeLabSavedPositiveHandoff | null => {
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
  if (handoff === null || typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) return metadata;

  return {
    ...metadata,
    rawEngineNegativeLabHandoff: handoff,
  };
};
