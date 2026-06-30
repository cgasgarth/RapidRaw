import { z } from 'zod';

import { type FilmGrainModelV1, filmGrainModelV1Schema, RAW_ENGINE_SCHEMA_VERSION } from './rawEngineSchemas.js';

export const filmGrainProvenanceEvidenceStateV1Schema = z.enum([
  'synthetic_runtime_reference_only',
  'preview_export_parity_pending',
  'runtime_apply_capable',
]);

export const filmGrainProvenanceInvalidationReasonV1Schema = z.enum([
  'algorithm_version_changed',
  'controls_changed',
  'coordinate_policy_changed',
  'color_domain_changed',
  'render_stage_changed',
  'source_content_changed',
]);

export const filmGrainProvenanceStaleStateV1Schema = z
  .object({
    invalidationReasons: z.array(filmGrainProvenanceInvalidationReasonV1Schema),
    state: z.enum(['current', 'stale', 'unknown']),
  })
  .strict()
  .superRefine((staleState, context) => {
    if (staleState.state === 'current' && staleState.invalidationReasons.length > 0) {
      context.addIssue({
        code: 'custom',
        message: 'Current film grain provenance must not include invalidation reasons.',
        path: ['invalidationReasons'],
      });
    }

    if (staleState.state === 'stale' && staleState.invalidationReasons.length === 0) {
      context.addIssue({
        code: 'custom',
        message: 'Stale film grain provenance requires invalidation reasons.',
        path: ['invalidationReasons'],
      });
    }
  });

export const filmGrainControlsV1Schema = z
  .object({
    amount: z.number().min(0).max(100),
    roughness: z.number().min(0).max(100),
    size: z.number().min(0).max(100),
  })
  .strict();

export const filmGrainAdjustmentPatchV1Schema = z
  .object({
    grainAmount: z.number().min(0).max(100),
    grainRoughness: z.number().min(0).max(100),
    grainSize: z.number().min(0).max(100),
  })
  .strict();

export const filmGrainCoordinatePolicyV1Schema = z.enum([
  'image_pixel_stable_v1',
  'variant_pixel_stable_v1',
  'render_tile_local_deferred',
]);

export const filmGrainColorDomainV1Schema = z.enum(['display_referred_rgb', 'working_linear_rgb', 'acescg_linear_v1']);

export const filmGrainSidecarProvenanceV1Schema = z
  .object({
    algorithmId: z.string().trim().min(1),
    algorithmVersion: z.string().trim().min(1),
    colorDomain: filmGrainColorDomainV1Schema,
    controls: filmGrainControlsV1Schema,
    coordinatePolicy: filmGrainCoordinatePolicyV1Schema,
    effectiveSeed: z.number().int().nonnegative(),
    evidenceState: filmGrainProvenanceEvidenceStateV1Schema,
    model: filmGrainModelV1Schema,
    provenanceId: z.string().regex(/^film_grain_provenance_[a-z0-9_]+$/u),
    renderStage: z.enum(['creative_final_after_glow', 'layer_local_after_color', 'schema_only_deferred']),
    schemaVersion: z.literal(RAW_ENGINE_SCHEMA_VERSION),
    sourceContentHash: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/u)
      .optional(),
    sourceImageId: z.string().trim().min(1),
    staleState: filmGrainProvenanceStaleStateV1Schema,
    variantId: z.string().trim().min(1),
  })
  .strict()
  .superRefine((provenance, context) => {
    if (provenance.algorithmId !== provenance.model.modelId) {
      context.addIssue({
        code: 'custom',
        message: 'Film grain provenance algorithmId must match modelId.',
        path: ['algorithmId'],
      });
    }

    if (provenance.algorithmVersion !== provenance.model.modelVersion) {
      context.addIssue({
        code: 'custom',
        message: 'Film grain provenance algorithmVersion must match modelVersion.',
        path: ['algorithmVersion'],
      });
    }

    if (provenance.renderStage !== provenance.model.renderStage) {
      context.addIssue({
        code: 'custom',
        message: 'Film grain provenance renderStage must match model renderStage.',
        path: ['renderStage'],
      });
    }
  });

export const filmGrainProvenanceSidecarEnvelopeV1Schema = z.looseObject({
  rawEngine: z
    .looseObject({
      filmGrainProvenance: filmGrainSidecarProvenanceV1Schema,
    })
    .optional(),
});

export const filmGrainSidecarReloadStateV1Schema = z
  .object({
    adjustmentPatch: filmGrainAdjustmentPatchV1Schema,
    effectiveSeed: z.number().int().nonnegative(),
    provenanceId: z.string().regex(/^film_grain_provenance_[a-z0-9_]+$/u),
    staleState: filmGrainProvenanceStaleStateV1Schema,
  })
  .strict();

export type FilmGrainAdjustmentPatchV1 = z.infer<typeof filmGrainAdjustmentPatchV1Schema>;
export type FilmGrainControlsV1 = z.infer<typeof filmGrainControlsV1Schema>;
export type FilmGrainSidecarProvenanceV1 = z.infer<typeof filmGrainSidecarProvenanceV1Schema>;
export type FilmGrainProvenanceSidecarEnvelopeV1 = z.infer<typeof filmGrainProvenanceSidecarEnvelopeV1Schema>;
export type FilmGrainSidecarReloadStateV1 = z.infer<typeof filmGrainSidecarReloadStateV1Schema>;

export interface BuildFilmGrainSidecarProvenanceOptions {
  colorDomain: z.infer<typeof filmGrainColorDomainV1Schema>;
  controls?: FilmGrainControlsV1;
  coordinatePolicy: z.infer<typeof filmGrainCoordinatePolicyV1Schema>;
  evidenceState: z.infer<typeof filmGrainProvenanceEvidenceStateV1Schema>;
  model: FilmGrainModelV1;
  runtimeSeed?: number;
  sourceContentHash?: string;
  sourceImageId: string;
  variantId: string;
}

export const buildFilmGrainSidecarProvenance = ({
  colorDomain,
  controls,
  coordinatePolicy,
  evidenceState,
  model,
  runtimeSeed,
  sourceContentHash,
  sourceImageId,
  variantId,
}: BuildFilmGrainSidecarProvenanceOptions): FilmGrainSidecarProvenanceV1 => {
  const parsedModel = filmGrainModelV1Schema.parse(model);
  const parsedControls = filmGrainControlsV1Schema.parse(controls ?? parsedModel.intensity);
  const seedOptions = {
    controls: parsedControls,
    model: parsedModel,
    sourceImageId,
    variantId,
  };
  const effectiveSeed = resolveFilmGrainEffectiveSeed({
    ...seedOptions,
    ...(runtimeSeed !== undefined ? { runtimeSeed } : {}),
    ...(sourceContentHash !== undefined ? { sourceContentHash } : {}),
  });

  return filmGrainSidecarProvenanceV1Schema.parse({
    algorithmId: parsedModel.modelId,
    algorithmVersion: parsedModel.modelVersion,
    colorDomain,
    controls: parsedControls,
    coordinatePolicy,
    effectiveSeed,
    evidenceState,
    model: parsedModel,
    provenanceId: `film_grain_provenance_${stableFilmGrainHash(`${sourceImageId}:${variantId}`).toString(16)}`,
    renderStage: parsedModel.renderStage,
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    sourceContentHash,
    sourceImageId,
    staleState: {
      invalidationReasons: [],
      state: 'current',
    },
    variantId,
  });
};

export const applyFilmGrainProvenanceToSidecar = (
  sidecar: Record<string, unknown>,
  provenance: FilmGrainSidecarProvenanceV1,
): FilmGrainProvenanceSidecarEnvelopeV1 => {
  const rawEngine =
    typeof sidecar['rawEngine'] === 'object' && sidecar['rawEngine'] !== null ? sidecar['rawEngine'] : {};

  return filmGrainProvenanceSidecarEnvelopeV1Schema.parse({
    ...sidecar,
    rawEngine: {
      ...rawEngine,
      filmGrainProvenance: filmGrainSidecarProvenanceV1Schema.parse(provenance),
    },
  });
};

export const readFilmGrainProvenanceFromSidecar = (sidecar: unknown): FilmGrainSidecarProvenanceV1 | undefined => {
  const parsed = filmGrainProvenanceSidecarEnvelopeV1Schema.parse(sidecar);
  return parsed.rawEngine?.filmGrainProvenance;
};

export const buildFilmGrainControlsFromAdjustmentPatch = (
  adjustmentPatch: FilmGrainAdjustmentPatchV1,
): FilmGrainControlsV1 => {
  const patch = filmGrainAdjustmentPatchV1Schema.parse(adjustmentPatch);
  return filmGrainControlsV1Schema.parse({
    amount: patch.grainAmount,
    roughness: patch.grainRoughness,
    size: patch.grainSize,
  });
};

export const buildFilmGrainAdjustmentPatchFromControls = (
  controls: FilmGrainControlsV1,
): FilmGrainAdjustmentPatchV1 => {
  const parsedControls = filmGrainControlsV1Schema.parse(controls);
  return filmGrainAdjustmentPatchV1Schema.parse({
    grainAmount: parsedControls.amount,
    grainRoughness: parsedControls.roughness,
    grainSize: parsedControls.size,
  });
};

export const buildFilmGrainAdjustmentPatchFromProvenance = (
  provenance: FilmGrainSidecarProvenanceV1,
): FilmGrainAdjustmentPatchV1 =>
  buildFilmGrainAdjustmentPatchFromControls(filmGrainSidecarProvenanceV1Schema.parse(provenance).controls);

export const classifyFilmGrainProvenanceStaleState = (
  provenance: FilmGrainSidecarProvenanceV1,
  current: Pick<
    BuildFilmGrainSidecarProvenanceOptions,
    'colorDomain' | 'coordinatePolicy' | 'controls' | 'model' | 'sourceContentHash'
  >,
): z.infer<typeof filmGrainProvenanceStaleStateV1Schema> => {
  const currentModel = filmGrainModelV1Schema.parse(current.model);
  const currentControls = filmGrainControlsV1Schema.parse(current.controls ?? currentModel.intensity);
  const reasons = [];

  if (
    provenance.algorithmId !== currentModel.modelId ||
    provenance.algorithmVersion !== currentModel.modelVersion ||
    provenance.model.algorithm !== currentModel.algorithm
  ) {
    reasons.push('algorithm_version_changed');
  }

  if (JSON.stringify(provenance.controls) !== JSON.stringify(currentControls)) reasons.push('controls_changed');
  if (provenance.coordinatePolicy !== current.coordinatePolicy) reasons.push('coordinate_policy_changed');
  if (provenance.colorDomain !== current.colorDomain) reasons.push('color_domain_changed');
  if (provenance.renderStage !== currentModel.renderStage) reasons.push('render_stage_changed');
  if (
    provenance.sourceContentHash !== undefined &&
    current.sourceContentHash !== undefined &&
    provenance.sourceContentHash !== current.sourceContentHash
  ) {
    reasons.push('source_content_changed');
  }

  return filmGrainProvenanceStaleStateV1Schema.parse({
    invalidationReasons: reasons,
    state: reasons.length > 0 ? 'stale' : 'current',
  });
};

export const markFilmGrainProvenanceStaleState = (
  provenance: FilmGrainSidecarProvenanceV1,
  current: Pick<
    BuildFilmGrainSidecarProvenanceOptions,
    'colorDomain' | 'coordinatePolicy' | 'controls' | 'model' | 'sourceContentHash'
  >,
): FilmGrainSidecarProvenanceV1 =>
  filmGrainSidecarProvenanceV1Schema.parse({
    ...provenance,
    staleState: classifyFilmGrainProvenanceStaleState(provenance, current),
  });

export const readFilmGrainSidecarReloadState = (
  sidecar: unknown,
  current: Pick<
    BuildFilmGrainSidecarProvenanceOptions,
    'colorDomain' | 'coordinatePolicy' | 'controls' | 'model' | 'sourceContentHash'
  >,
): FilmGrainSidecarReloadStateV1 | undefined => {
  const provenance = readFilmGrainProvenanceFromSidecar(sidecar);
  if (provenance === undefined) return undefined;

  const staleState = classifyFilmGrainProvenanceStaleState(provenance, current);
  return filmGrainSidecarReloadStateV1Schema.parse({
    adjustmentPatch: buildFilmGrainAdjustmentPatchFromProvenance(provenance),
    effectiveSeed: provenance.effectiveSeed,
    provenanceId: provenance.provenanceId,
    staleState,
  });
};

function resolveFilmGrainEffectiveSeed({
  controls,
  model,
  runtimeSeed,
  sourceContentHash,
  sourceImageId,
  variantId,
}: {
  controls: FilmGrainControlsV1;
  model: FilmGrainModelV1;
  runtimeSeed?: number;
  sourceContentHash?: string;
  sourceImageId: string;
  variantId: string;
}): number {
  if (model.seedPolicy.mode === 'explicit_seed') {
    if (model.seedPolicy.seed === undefined) throw new Error('Explicit film grain seed policy requires seed.');
    return model.seedPolicy.seed;
  }
  if (model.seedPolicy.mode === 'random_per_render') {
    if (runtimeSeed === undefined) throw new Error('Persisted random-per-render film grain requires runtimeSeed.');
    return runtimeSeed;
  }

  return stableFilmGrainHash(
    JSON.stringify({
      controls,
      mode: model.seedPolicy.mode,
      modelId: model.modelId,
      modelVersion: model.modelVersion,
      sourceContentHash,
      sourceImageId,
      variantId,
    }),
  );
}

function stableFilmGrainHash(value: string): number {
  let hash = 0x811c9dc5;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}
