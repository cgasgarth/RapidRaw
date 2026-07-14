import { z } from 'zod';
import { filmStagePatchV1Schema } from './filmEmulationOperationSchemas.js';
import { filmEmulationProfileRefV1Schema } from './filmEmulationSchemas.js';

export const filmEmulationTransferV1Schema = z
  .object({
    contract: z.literal('rapidraw.film_transfer.v1'),
    profileRef: filmEmulationProfileRefV1Schema,
    enabled: z.boolean(),
    mix: z.number().finite().min(0).max(1),
    stageOverrides: z
      .object({
        referenceLuminanceShaperP: filmStagePatchV1Schema.shape.p.optional(),
      })
      .strict(),
    stackPlacement: z
      .object({
        position: z.enum(['scene_creative_end', 'scene_creative_custom']),
        afterNodeSemanticId: z.string().trim().min(1).max(256).optional(),
      })
      .strict()
      .superRefine((placement, context) => {
        if (placement.position === 'scene_creative_custom' && placement.afterNodeSemanticId === undefined) {
          context.addIssue({
            code: 'custom',
            path: ['afterNodeSemanticId'],
            message: 'Custom placement requires a semantic node id.',
          });
        }
        if (placement.position === 'scene_creative_end' && placement.afterNodeSemanticId !== undefined) {
          context.addIssue({
            code: 'custom',
            path: ['afterNodeSemanticId'],
            message: 'End placement cannot include a predecessor.',
          });
        }
      }),
    seedTransferPolicy: z.enum(['preserve_for_same_source_v1', 'rederive_for_target_source_v1']),
  })
  .strict();

export type FilmEmulationTransferV1 = z.infer<typeof filmEmulationTransferV1Schema>;

export const filmLegacyMigrationStatusV1Schema = z.enum([
  'migrated_to_film_node',
  'legacy_adjustments_preserved',
  'legacy_mapping_unavailable',
  'legacy_controlled_fields_modified',
  'legacy_profile_withdrawn',
]);

export type FilmLegacyMigrationStatusV1 = z.infer<typeof filmLegacyMigrationStatusV1Schema>;
