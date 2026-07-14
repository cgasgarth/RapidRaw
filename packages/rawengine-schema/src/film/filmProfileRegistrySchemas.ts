import { z } from 'zod';
import { filmEmulationNodeV1Schema } from './filmEmulationSchemas.js';

const sha256Schema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const semverLike = z.string().regex(/^\d+(?:\.\d+){0,2}$/u);

export const filmProfileManifestV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    profile: z
      .object({
        id: z.string().min(1),
        version: semverLike,
        contentSha256: sha256Schema,
        renderContractVersion: z.string().min(1),
        workingSpace: z.literal('acescg_linear_v1'),
        lifecycle: z.enum(['active', 'deprecated', 'withdrawn']),
        supersedes: z
          .object({ id: z.string().min(1), version: semverLike, contentSha256: sha256Schema })
          .strict()
          .optional(),
      })
      .strict(),
    presentation: z
      .object({
        displayName: z.string().trim().min(1),
        family: z.enum(['generic', 'color_negative', 'reversal', 'cinema_print', 'monochrome']),
        tags: z.array(z.string().trim().min(1)),
        description: z.string().trim().min(1),
      })
      .strict(),
    claim: z
      .object({
        class: z.enum(['generic_engineered', 'measured_project_owned', 'licensed_third_party']),
        publicStatement: z.string().trim().min(1),
        exactStockOrProductClaim: z
          .object({
            claimedName: z.string().trim().min(1),
            rightsBasis: z.string().trim().min(1),
            legalReviewId: z.string().trim().min(1),
            reviewedAt: z.string().trim().min(1),
            endorsementDisclaimed: z.boolean(),
          })
          .strict()
          .optional(),
        prohibitedClaims: z.array(z.string().trim().min(1)),
      })
      .strict(),
    provenance: z
      .object({
        authors: z.array(z.string().trim().min(1)).min(1),
        sourceKind: z.enum(['project_parameters', 'project_measurements', 'licensed_dataset']),
        sourceUrls: z.array(z.string().url()),
        licenseSpdx: z.array(z.string().trim().min(1)).min(1),
        noticePaths: z.array(z.string().trim().min(1)),
        assetSha256: z.record(z.string().trim().min(1), sha256Schema),
      })
      .strict(),
    calibration: z
      .object({
        status: z.enum(['engineered', 'measured']),
        methodVersion: z.string().min(1),
        limitations: z.array(z.string().trim().min(1)).min(1),
        illuminants: z.array(z.string()).optional(),
        chartOrTargets: z.array(z.string()).optional(),
        captureDevices: z.array(z.string()).optional(),
        processAndBatch: z.string().optional(),
        scannerOrMeasurementDevice: z.string().optional(),
        sampleCount: z.number().int().positive().optional(),
        exposureBracketsEv: z.array(z.number()).optional(),
        datasetPath: z.string().optional(),
        datasetSha256: sha256Schema.optional(),
        datasetLicenseSpdx: z.array(z.string()).optional(),
        fittingToolCommit: z.string().optional(),
        trainHoldoutSplit: z.string().optional(),
        metricsPath: z.string().optional(),
        metricsSha256: sha256Schema.optional(),
      })
      .strict(),
    model: filmEmulationNodeV1Schema,
  })
  .strict();

export type FilmProfileManifestV1 = z.infer<typeof filmProfileManifestV1Schema>;
export type FilmProfileClaimDecisionV1 = { status: 'allowed' | 'unavailable' | 'rejected'; reasonCodes: string[] };

const forbiddenGenericClaim =
  /\b(?:manufacturer|stock|matched|accurate|measured|official|kodak|fuji|ilford|cinestill)\b/iu;

export const evaluateFilmProfileClaim = (
  manifest: FilmProfileManifestV1,
  availableAssets = new Set(Object.keys(manifest.provenance.assetSha256)),
): FilmProfileClaimDecisionV1 => {
  const reasons: string[] = [];
  const claimText =
    `${manifest.presentation.displayName} ${manifest.presentation.description} ${manifest.claim.publicStatement}`.replace(
      /\b(?:no|not|without)\s+(?:a\s+)?(?:manufacturer|stock|matched|accurate|measured|official|kodak|fuji|ilford|cinestill)(?:\s+claim)?/giu,
      '',
    );
  if (manifest.profile.lifecycle === 'withdrawn') reasons.push('profile_withdrawn');
  if (manifest.claim.class === 'generic_engineered' && forbiddenGenericClaim.test(claimText))
    reasons.push('generic_claim_language');
  if (
    manifest.claim.class === 'measured_project_owned' &&
    (!manifest.calibration.datasetSha256 ||
      !manifest.calibration.datasetLicenseSpdx?.length ||
      !manifest.calibration.fittingToolCommit ||
      !manifest.calibration.metricsSha256)
  )
    reasons.push('measured_evidence_incomplete');
  if (
    manifest.claim.class === 'licensed_third_party' &&
    (!manifest.claim.exactStockOrProductClaim?.legalReviewId || !manifest.provenance.licenseSpdx.length)
  )
    reasons.push('licensed_evidence_incomplete');
  if (Object.keys(manifest.provenance.assetSha256).some((asset) => !availableAssets.has(asset)))
    reasons.push('asset_unavailable');
  if (reasons.includes('profile_withdrawn') || reasons.includes('asset_unavailable'))
    return { status: 'unavailable', reasonCodes: reasons };
  return reasons.length > 0 ? { status: 'rejected', reasonCodes: reasons } : { status: 'allowed', reasonCodes: [] };
};

export const canonicalFilmProfileManifestJson = (manifest: FilmProfileManifestV1): string => JSON.stringify(manifest);
export const canonicalFilmProfileManifestHashInput = (manifest: FilmProfileManifestV1): string =>
  JSON.stringify({
    ...manifest,
    profile: { ...manifest.profile, contentSha256: '' },
    model: {
      ...manifest.model,
      profileRef: { ...manifest.model.profileRef, contentSha256: '' },
    },
  });
export const verifyFilmProfileManifestHash = async (
  manifest: FilmProfileManifestV1,
  expectedHash = manifest.profile.contentSha256,
): Promise<boolean> => {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonicalFilmProfileManifestHashInput(manifest)),
  );
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `sha256:${hex}` === expectedHash;
};
