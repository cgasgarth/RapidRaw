import { z } from 'zod';

import { approvalRequirementSchema, RAW_ENGINE_SCHEMA_VERSION, rawEngineActorSchema } from '../rawEngineSchemas.js';
import { filmEmulationNodeV1Schema, filmEmulationProfileRefV1Schema } from './filmEmulationSchemas.js';

const variantIdSchema = z.string().trim().min(1).max(256);

export const filmStageIdV1Schema = z.literal('reference_luminance_shaper_v1');

export const filmStagePatchV1Schema = z
  .object({
    p: z.number().finite().min(0.0001).max(4),
  })
  .strict();

const filmSetProfileOperationV1Schema = z
  .object({
    kind: z.literal('set_profile'),
    profileRef: filmEmulationProfileRefV1Schema,
  })
  .strict();

const filmSetMixOperationV1Schema = z
  .object({
    kind: z.literal('set_mix'),
    mix: z.number().finite().min(0).max(1),
  })
  .strict();

const filmSetEnabledOperationV1Schema = z
  .object({
    enabled: z.boolean(),
    kind: z.literal('set_enabled'),
  })
  .strict();

const filmSetStageParamsOperationV1Schema = z
  .object({
    kind: z.literal('set_stage_params'),
    patch: filmStagePatchV1Schema,
    stage: filmStageIdV1Schema,
  })
  .strict();

const filmSetStackPositionOperationV1Schema = z
  .object({
    afterNodeId: z.string().trim().min(1).max(256).optional(),
    kind: z.literal('set_stack_position'),
    position: z.enum(['scene_creative_end', 'scene_creative_custom']),
  })
  .strict()
  .superRefine((operation, context) => {
    if (operation.position === 'scene_creative_custom' && operation.afterNodeId === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'Custom Film placement requires afterNodeId.',
        path: ['afterNodeId'],
      });
    }
    if (operation.position === 'scene_creative_end' && operation.afterNodeId !== undefined) {
      context.addIssue({
        code: 'custom',
        message: 'scene_creative_end does not accept afterNodeId.',
        path: ['afterNodeId'],
      });
    }
  });

const filmResetOperationV1Schema = z.object({ kind: z.literal('reset_to_profile') }).strict();
const filmRemoveOperationV1Schema = z.object({ kind: z.literal('remove_node') }).strict();

export const filmEmulationOperationV1Schema = z.discriminatedUnion('kind', [
  filmSetProfileOperationV1Schema,
  filmSetMixOperationV1Schema,
  filmSetEnabledOperationV1Schema,
  filmSetStageParamsOperationV1Schema,
  filmSetStackPositionOperationV1Schema,
  filmResetOperationV1Schema,
  filmRemoveOperationV1Schema,
]);

export const applyFilmEmulationOperationV1Schema = z
  .object({
    actor: rawEngineActorSchema,
    approval: approvalRequirementSchema,
    commandId: z.string().trim().min(1).max(256),
    commandType: z.literal('edit.apply_film_emulation_operation'),
    contractVersion: z.literal(1),
    correlationId: z.string().trim().min(1).max(256),
    dryRun: z.boolean(),
    expectedGraphRevision: z.string().trim().min(1).max(256),
    idempotencyKey: z.string().trim().min(1).max(256).optional(),
    operation: filmEmulationOperationV1Schema,
    schemaVersion: z.literal(RAW_ENGINE_SCHEMA_VERSION),
    target: z
      .object({
        kind: z.enum(['image', 'virtual_copy']),
        variantId: variantIdSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((command, context) => {
    const expectedClass = command.dryRun ? 'preview_only' : 'edit_apply';
    if (command.approval.approvalClass !== expectedClass) {
      context.addIssue({
        code: 'custom',
        message: `Film ${command.dryRun ? 'dry-run' : 'apply'} requires ${expectedClass} approval.`,
        path: ['approval', 'approvalClass'],
      });
    }
    if (!command.dryRun && command.approval.state !== 'approved') {
      context.addIssue({
        code: 'custom',
        message: 'Applied Film operations require approved approval.',
        path: ['approval', 'state'],
      });
    }
  });

export const filmEmulationPlacementV1Schema = z
  .object({
    afterNodeId: z.string().trim().min(1).max(256).optional(),
    position: z.enum(['scene_creative_end', 'scene_creative_custom']),
  })
  .strict();

export const filmEmulationHistoryEntryV1Schema = z
  .object({
    commandId: z.string().trim().min(1),
    createdAt: z.iso.datetime({ offset: true }),
    entryId: z.string().trim().min(1),
    operation: filmEmulationOperationV1Schema,
    previousNode: filmEmulationNodeV1Schema.nullable(),
    previousPlacement: filmEmulationPlacementV1Schema,
    resultingNode: filmEmulationNodeV1Schema.nullable(),
    resultingPlacement: filmEmulationPlacementV1Schema,
    sourceGraphRevision: z.string().trim().min(1),
    resultingGraphRevision: z.string().trim().min(1),
  })
  .strict();

export const filmEmulationTargetStateV1Schema = z
  .object({
    commandReceipts: z.array(
      z
        .object({
          commandId: z.string().trim().min(1),
          fingerprint: z.string().regex(/^fnv1a64:[0-9a-f]{16}$/u),
          idempotencyKey: z.string().trim().min(1).optional(),
          result: z.lazy(() => filmEmulationOperationResultV1Schema),
        })
        .strict(),
    ),
    graphHash: z.string().regex(/^fnv1a64:[0-9a-f]{16}$/u),
    graphRevision: z.string().trim().min(1),
    history: z.array(filmEmulationHistoryEntryV1Schema),
    node: filmEmulationNodeV1Schema.nullable(),
    nodeHash: z
      .string()
      .regex(/^fnv1a64:[0-9a-f]{16}$/u)
      .nullable(),
    placement: filmEmulationPlacementV1Schema,
    redo: z.array(filmEmulationHistoryEntryV1Schema),
    target: z.object({ kind: z.enum(['image', 'virtual_copy']), variantId: variantIdSchema }).strict(),
  })
  .strict();

export const filmEmulationOperationResultV1Schema = z
  .object({
    appliedGraphRevision: z.string().trim().min(1).optional(),
    commandId: z.string().trim().min(1),
    commandType: z.literal('edit.apply_film_emulation_operation'),
    correlationId: z.string().trim().min(1),
    dryRun: z.boolean(),
    graphHash: z.string().regex(/^fnv1a64:[0-9a-f]{16}$/u),
    historyEntryId: z.string().trim().min(1).optional(),
    idempotentReplay: z.boolean(),
    mutates: z.boolean(),
    nodeHash: z
      .string()
      .regex(/^fnv1a64:[0-9a-f]{16}$/u)
      .nullable(),
    planHash: z.string().regex(/^fnv1a64:[0-9a-f]{16}$/u),
    resultingNode: filmEmulationNodeV1Schema.nullable(),
    resultingPlacement: filmEmulationPlacementV1Schema,
    sourceGraphRevision: z.string().trim().min(1),
    warnings: z.array(z.string().trim().min(1)),
  })
  .strict();

export type ApplyFilmEmulationOperationV1 = z.infer<typeof applyFilmEmulationOperationV1Schema>;
export type FilmEmulationHistoryEntryV1 = z.infer<typeof filmEmulationHistoryEntryV1Schema>;
export type FilmEmulationTargetStateV1 = z.infer<typeof filmEmulationTargetStateV1Schema>;
export type FilmEmulationOperationResultV1 = z.infer<typeof filmEmulationOperationResultV1Schema>;
export type FilmEmulationOperationV1 = z.infer<typeof filmEmulationOperationV1Schema>;
export type FilmEmulationPlacementV1 = z.infer<typeof filmEmulationPlacementV1Schema>;
export type FilmStagePatchV1 = z.infer<typeof filmStagePatchV1Schema>;
