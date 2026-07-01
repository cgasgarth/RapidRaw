import { z } from 'zod';
import {
  applyFilmGrainProvenanceToSidecar,
  buildFilmGrainSidecarProvenance,
  filmGrainControlsV1Schema,
  readFilmGrainProvenanceFromSidecar,
} from '../../packages/rawengine-schema/src/filmGrainProvenance';
import {
  applyFilmGrainRuntime,
  type FilmGrainRuntimePixelV1,
} from '../../packages/rawengine-schema/src/filmGrainRuntime';
import {
  applyFilmHalationRuntime,
  filmHalationControlsV1Schema,
} from '../../packages/rawengine-schema/src/filmHalationRuntime';
import { sampleFilmGrainModelV1 } from '../../packages/rawengine-schema/src/samplePayloads';
import {
  buildFilmLookAppliedAdjustmentPatch,
  clampFilmLookStrength,
  type FilmLookBrowserItem,
} from './film-look/filmLookBrowser';
import {
  applyFilmLookToColorPipelinePixels,
  hashFilmLookColorPipelinePixels,
} from './film-look/filmLookColorPipelineCommand';

export const GOVERNED_FILM_LOOK_RUNTIME_SCHEMA_VERSION = 1;

export const governedFilmLookPixelSchema = z
  .object({
    b: z.number().min(0).max(1),
    g: z.number().min(0).max(1),
    r: z.number().min(0).max(1),
    x: z.number().int().min(0),
    y: z.number().int().min(0),
  })
  .strict();

export const governedFilmLookRecipeSchema = z
  .object({
    grain: z
      .object({
        amount: z.number().min(0).max(100),
        roughness: z.number().min(0).max(100),
        size: z.number().min(0).max(100),
      })
      .strict(),
    halation: z
      .object({
        amount: z.number().min(0).max(100),
        enabled: z.boolean(),
        highlightThresholdEv: z.number().min(0.5).max(6),
        sigmaShortEdgeFraction: z.number().min(0).max(0.01),
        warmth: z.number().min(0).max(0.75),
      })
      .strict(),
    lookId: z.string().trim().min(1),
    recipeId: z.string().regex(/^film_look\.governed\.[a-z0-9._-]+\.v[0-9]+$/u),
    strength: z.number().int().min(0).max(100),
  })
  .strict();

export const governedFilmLookCommandSchema = z
  .object({
    actor: z
      .object({
        id: z.string().trim().min(1),
        kind: z.enum(['agent', 'batch', 'cli', 'test', 'ui']),
        sessionId: z.string().trim().min(1),
      })
      .strict(),
    approval: z
      .object({
        approvalClass: z.literal('edit_apply'),
        reason: z.string().trim().min(1),
        state: z.literal('approved'),
      })
      .strict(),
    commandId: z.string().trim().min(1),
    commandType: z.literal('filmLook.applyGovernedRecipe'),
    expectedGraphRevision: z.string().trim().min(1),
    parameters: z
      .object({
        recipe: governedFilmLookRecipeSchema,
        sourceContentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
        variantId: z.string().trim().min(1),
      })
      .strict(),
    schemaVersion: z.literal(GOVERNED_FILM_LOOK_RUNTIME_SCHEMA_VERSION),
    target: z
      .object({
        imageId: z.string().trim().min(1),
        imagePath: z.string().trim().min(1),
        kind: z.literal('image'),
      })
      .strict(),
  })
  .strict();

export const governedFilmLookRuntimeResultSchema = z
  .object({
    adjustmentPatch: z.record(z.string(), z.number()),
    afterHash: z.string().trim().min(1),
    beforeHash: z.string().trim().min(1),
    changedPixelRatio: z.number().min(0).max(1),
    grainHash: z.string().regex(/^fnv1a32:[a-f0-9]{8}$/u),
    halationHash: z.string().regex(/^fnv1a32:[a-f0-9]{8}$/u),
    lookHash: z.string().trim().min(1),
    outputPixels: z.array(governedFilmLookPixelSchema).min(1),
    previewHash: z.string().trim().min(1),
    provenance: z
      .object({
        claimBoundary: z.literal('governed_creative_look_not_measured_stock_emulation'),
        colorDomain: z.literal('working_linear_rgb'),
        coordinatePolicy: z.literal('variant_pixel_stable_v1'),
        grain: z
          .object({
            controls: filmGrainControlsV1Schema,
            provenanceId: z.string().trim().min(1),
            renderStage: z.literal('creative_final_after_glow'),
            seed: z.number().int().nonnegative(),
            seedPolicy: z.enum(['stable_per_image', 'stable_per_variant', 'explicit_seed', 'random_per_render']),
          })
          .strict(),
        grainProvenanceId: z.string().trim().min(1),
        halation: z
          .object({
            claimBoundary: z.literal('rgb_creative_approximation_not_physical_film_halation'),
            controls: filmHalationControlsV1Schema,
            renderStage: z.literal('late_working_linear_before_output_transform'),
          })
          .strict(),
        halationClaimBoundary: z.literal('rgb_creative_approximation_not_physical_film_halation'),
        lookId: z.string().trim().min(1),
        recipeId: z.string().trim().min(1),
        renderStages: z.tuple([
          z.literal('look_adjustment_patch'),
          z.literal('late_working_linear_before_output_transform'),
          z.literal('creative_final_after_glow'),
        ]),
        sourceContentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
        variantId: z.string().trim().min(1),
      })
      .strict(),
    runtimeStatus: z.literal('synthetic_runtime_apply_capable'),
    sidecar: z.looseObject({}),
    warnings: z.array(z.string().trim().min(1)),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.beforeHash === result.afterHash) {
      context.addIssue({ code: 'custom', message: 'Governed film look must change output pixels.' });
    }

    if (result.previewHash !== result.afterHash) {
      context.addIssue({ code: 'custom', message: 'Governed film look preview/export parity failed.' });
    }
  });

export type GovernedFilmLookCommand = z.infer<typeof governedFilmLookCommandSchema>;
export type GovernedFilmLookPixel = z.infer<typeof governedFilmLookPixelSchema>;
export type GovernedFilmLookRecipe = z.infer<typeof governedFilmLookRecipeSchema>;
export type GovernedFilmLookRuntimeResult = z.infer<typeof governedFilmLookRuntimeResultSchema>;

export interface BuildGovernedFilmLookCommandOptions {
  imageId: string;
  imagePath: string;
  look: FilmLookBrowserItem;
  operationId: string;
  recipe?: Partial<GovernedFilmLookRecipe>;
  sessionId: string;
  sourceContentHash: string;
  strength: number;
  variantId: string;
}

export interface ApplyGovernedFilmLookOptions {
  command: unknown;
  look: FilmLookBrowserItem;
  sourcePixels: ReadonlyArray<GovernedFilmLookPixel>;
}

export const DEFAULT_GOVERNED_FILM_LOOK_RECIPE = {
  grain: {
    amount: 28,
    roughness: 52,
    size: 34,
  },
  halation: {
    amount: 26,
    enabled: true,
    highlightThresholdEv: 2.4,
    sigmaShortEdgeFraction: 0.0012,
    warmth: 0.45,
  },
  lookId: 'film_look.generic.warm_print.v1',
  recipeId: 'film_look.governed.warm_print_grain_halation.v1',
  strength: 70,
} satisfies GovernedFilmLookRecipe;

export function buildGovernedFilmLookCommand({
  imageId,
  imagePath,
  look,
  operationId,
  recipe,
  sessionId,
  sourceContentHash,
  strength,
  variantId,
}: BuildGovernedFilmLookCommandOptions): GovernedFilmLookCommand {
  const resolvedRecipe = governedFilmLookRecipeSchema.parse({
    ...DEFAULT_GOVERNED_FILM_LOOK_RECIPE,
    ...recipe,
    grain: {
      ...DEFAULT_GOVERNED_FILM_LOOK_RECIPE.grain,
      ...recipe?.grain,
    },
    halation: {
      ...DEFAULT_GOVERNED_FILM_LOOK_RECIPE.halation,
      ...recipe?.halation,
    },
    lookId: look.id,
    strength: clampFilmLookStrength(strength),
  });

  return governedFilmLookCommandSchema.parse({
    actor: {
      id: 'rapidraw-ui',
      kind: 'ui',
      sessionId,
    },
    approval: {
      approvalClass: 'edit_apply',
      reason: 'Apply governed film look recipe through typed runtime path.',
      state: 'approved',
    },
    commandId: `film_look_governed_${operationId}`,
    commandType: 'filmLook.applyGovernedRecipe',
    expectedGraphRevision: `graph_rev_${operationId}`,
    parameters: {
      recipe: resolvedRecipe,
      sourceContentHash,
      variantId,
    },
    schemaVersion: GOVERNED_FILM_LOOK_RUNTIME_SCHEMA_VERSION,
    target: {
      imageId,
      imagePath,
      kind: 'image',
    },
  });
}

export function applyGovernedFilmLookRuntime({
  command,
  look,
  sourcePixels,
}: ApplyGovernedFilmLookOptions): GovernedFilmLookRuntimeResult {
  const parsedCommand = governedFilmLookCommandSchema.parse(command);
  const recipe = parsedCommand.parameters.recipe;
  if (look.id !== recipe.lookId) {
    throw new Error(`Governed film look recipe expected ${recipe.lookId}, got ${look.id}.`);
  }

  const lookPixels = applyFilmLookToColorPipelinePixels(sourcePixels, look, recipe.strength);
  const halation = applyFilmHalationRuntime({
    controls: recipe.halation,
    fullResShortEdgePx: 1200,
    imageId: parsedCommand.target.imageId,
    pixels: lookPixels,
    previewShortEdgePx: 1200,
    sourceContentHash: parsedCommand.parameters.sourceContentHash,
    workingSpace: 'linear_srgb_d65',
  });
  const grainModel = {
    ...sampleFilmGrainModelV1,
    intensity: recipe.grain,
  };
  const grain = applyFilmGrainRuntime(
    {
      imageId: parsedCommand.target.imageId,
      pixels: halation.outputPixels.map(
        (pixel): FilmGrainRuntimePixelV1 => ({
          b: clamp01(pixel.b),
          g: clamp01(pixel.g),
          r: clamp01(pixel.r),
          x: pixel.x,
          y: pixel.y,
        }),
      ),
      sourceContentHash: parsedCommand.parameters.sourceContentHash,
      variantKey: parsedCommand.parameters.variantId,
    },
    grainModel,
  );
  const grainProvenance = buildFilmGrainSidecarProvenance({
    colorDomain: 'working_linear_rgb',
    controls: recipe.grain,
    coordinatePolicy: 'variant_pixel_stable_v1',
    evidenceState: 'runtime_apply_capable',
    model: grainModel,
    runtimeSeed: grain.provenance.seed,
    sourceContentHash: parsedCommand.parameters.sourceContentHash,
    sourceImageId: parsedCommand.target.imageId,
    variantId: parsedCommand.parameters.variantId,
  });
  const beforeHash = hashFilmLookColorPipelinePixels(sourcePixels);
  const afterHash = hashFilmLookColorPipelinePixels(grain.outputPixels);
  const sidecar = applyFilmGrainProvenanceToSidecar(
    {
      rawEngine: {
        governedFilmLook: {
          commandId: parsedCommand.commandId,
          lookId: look.id,
          outputEffects: {
            afterHash,
            colorDomain: 'working_linear_rgb',
            controls: {
              grain: recipe.grain,
              halation: recipe.halation,
            },
            coordinatePolicy: 'variant_pixel_stable_v1',
            grainHash: grain.afterHash,
            halationHash: halation.afterHash,
            renderStages: [
              'look_adjustment_patch',
              'late_working_linear_before_output_transform',
              'creative_final_after_glow',
            ],
            sourceContentHash: parsedCommand.parameters.sourceContentHash,
            variantId: parsedCommand.parameters.variantId,
          },
          recipeId: recipe.recipeId,
          strength: recipe.strength,
        },
      },
    },
    grainProvenance,
  );
  const reloadedGrainProvenance = readFilmGrainProvenanceFromSidecar(sidecar);
  if (reloadedGrainProvenance?.provenanceId !== grainProvenance.provenanceId) {
    throw new Error('Governed film look sidecar did not roundtrip grain provenance.');
  }

  return governedFilmLookRuntimeResultSchema.parse({
    adjustmentPatch: buildFilmLookAppliedAdjustmentPatch(look, recipe.strength),
    afterHash,
    beforeHash,
    changedPixelRatio: calculateChangedPixelRatio(sourcePixels, grain.outputPixels),
    grainHash: grain.afterHash,
    halationHash: halation.afterHash,
    lookHash: hashFilmLookColorPipelinePixels(lookPixels),
    outputPixels: grain.outputPixels,
    previewHash: afterHash,
    provenance: {
      claimBoundary: 'governed_creative_look_not_measured_stock_emulation',
      colorDomain: 'working_linear_rgb',
      coordinatePolicy: 'variant_pixel_stable_v1',
      grain: {
        controls: recipe.grain,
        provenanceId: grainProvenance.provenanceId,
        renderStage: grain.provenance.renderStage,
        seed: grain.provenance.seed,
        seedPolicy: grain.provenance.seedPolicy,
      },
      grainProvenanceId: grainProvenance.provenanceId,
      halation: {
        claimBoundary: halation.claimBoundary,
        controls: recipe.halation,
        renderStage: halation.provenance.renderStage,
      },
      halationClaimBoundary: halation.claimBoundary,
      lookId: look.id,
      recipeId: recipe.recipeId,
      renderStages: [
        'look_adjustment_patch',
        'late_working_linear_before_output_transform',
        'creative_final_after_glow',
      ],
      sourceContentHash: parsedCommand.parameters.sourceContentHash,
      variantId: parsedCommand.parameters.variantId,
    },
    runtimeStatus: 'synthetic_runtime_apply_capable',
    sidecar,
    warnings: [
      ...new Set([...halation.warnings, ...deriveRuntimeWarnings(halation.changedPixels, grain.changedPixels)]),
    ],
  });
}

function deriveRuntimeWarnings(halationChangedPixels: number, grainChangedPixels: number): string[] {
  const warnings = ['real_raw_review_required', 'not_measured_stock_emulation'];
  if (halationChangedPixels > 0) warnings.push('halation_creative_rgb_approximation');
  if (grainChangedPixels > 0) warnings.push('grain_cpu_reference_runtime');
  return warnings.toSorted();
}

function calculateChangedPixelRatio(
  before: ReadonlyArray<GovernedFilmLookPixel>,
  after: ReadonlyArray<GovernedFilmLookPixel>,
): number {
  const changedPixels = after.filter((pixel, index) => {
    const beforePixel = before[index];
    return (
      beforePixel === undefined || beforePixel.r !== pixel.r || beforePixel.g !== pixel.g || beforePixel.b !== pixel.b
    );
  }).length;
  return Number((changedPixels / after.length).toFixed(6));
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
