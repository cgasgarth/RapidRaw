import { z } from 'zod';
import { filmEmulationOperationV1Schema } from './filmEmulationOperationSchemas.js';
import { filmEmulationTransferV1Schema } from './filmEmulationTransferSchemas.js';

const targetSchema = z
  .object({ variantId: z.string().trim().min(1).max(256), expectedGraphRevision: z.string().trim().min(1).max(256) })
  .strict();
const operationSchema = z.union([
  filmEmulationOperationV1Schema,
  z.object({ kind: z.literal('apply_transfer'), transfer: filmEmulationTransferV1Schema }).strict(),
]);

export const applyFilmEmulationOperationToVariantsV1Schema = z
  .object({
    commandType: z.literal('edit.apply_film_emulation_operation'),
    contractVersion: z.literal(1),
    commandId: z.string().trim().min(1).max(256),
    idempotencyKey: z.string().trim().min(1).max(256).optional(),
    targets: z.array(targetSchema).min(1).max(1024),
    operation: operationSchema,
  })
  .strict()
  .superRefine((command, context) => {
    const ids = new Set<string>();
    command.targets.forEach((target, index) => {
      if (ids.has(target.variantId))
        context.addIssue({
          code: 'custom',
          path: ['targets', index, 'variantId'],
          message: 'Duplicate target variant.',
        });
      ids.add(target.variantId);
    });
  });

export const filmMultiTargetStatusV1Schema = z.enum([
  'applied',
  'no_change',
  'stale_revision',
  'profile_unavailable',
  'illegal_placement',
  'unsupported_domain',
  'validation_failed',
]);
export const filmMultiTargetResultV1Schema = z
  .object({
    commandId: z.string().trim().min(1),
    orderedResults: z
      .array(
        z
          .object({
            variantId: z.string().trim().min(1),
            status: filmMultiTargetStatusV1Schema,
            previousGraphRevision: z.string().trim().min(1),
            resultingGraphRevision: z.string().trim().min(1).optional(),
            graphHash: z.string().trim().min(1).optional(),
            nodeHash: z.string().trim().min(1).optional(),
            compiledNodeHash: z.string().trim().min(1).optional(),
            historyEntryId: z.string().trim().min(1).optional(),
            error: z
              .object({ code: z.string().trim().min(1), message: z.string().trim().min(1) })
              .strict()
              .optional(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict()
  .superRefine((result, context) => {
    result.orderedResults.forEach((entry, index) => {
      if (entry.status === 'applied' && entry.resultingGraphRevision === undefined)
        context.addIssue({
          code: 'custom',
          path: ['orderedResults', index],
          message: 'Applied result requires resulting revision.',
        });
      if (entry.status !== 'applied' && entry.resultingGraphRevision !== undefined)
        context.addIssue({
          code: 'custom',
          path: ['orderedResults', index],
          message: 'Conflict result cannot claim a resulting revision.',
        });
    });
  });

export type ApplyFilmEmulationOperationToVariantsV1 = z.infer<typeof applyFilmEmulationOperationToVariantsV1Schema>;
export type FilmMultiTargetResultV1 = z.infer<typeof filmMultiTargetResultV1Schema>;
