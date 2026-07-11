import { z } from 'zod';

const hashSchema = z.string().regex(/^blake3:[0-9a-f]{64}$/u);
const familySchema = z.enum(['focus_stack', 'hdr', 'super_resolution']);
const haloSchema = z
  .object({
    bottom: z.number().int().nonnegative(),
    left: z.number().int().nonnegative(),
    right: z.number().int().nonnegative(),
    top: z.number().int().nonnegative(),
  })
  .strict();

export const computationalMergeProgressV1Schema = z
  .object({
    completedUnits: z.number().int().nonnegative(),
    completedWeight: z.number().int().nonnegative(),
    family: familySchema,
    fraction: z.number().min(0).max(1),
    jobId: z.uuid(),
    schemaVersion: z.literal(1),
    stage: z.string().trim().min(1),
    status: z.enum(['active', 'cancel_requested', 'cancelled', 'failed', 'succeeded']),
    totalUnits: z.number().int().positive(),
    totalWeight: z.number().int().positive(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.completedUnits > value.totalUnits || value.completedWeight > value.totalWeight)
      context.addIssue({ code: 'custom', message: 'Observed progress exceeds its accepted work plan.' });
  });

const memoryEstimateSchema = z
  .object({
    encoderBufferBytes: z.number().int().nonnegative(),
    estimatedPeakBytes: z.number().int().positive(),
    mapsAccumulatorsBytes: z.number().int().nonnegative(),
    outputTileBytes: z.number().int().nonnegative(),
    residentInputBytes: z.number().int().nonnegative(),
    safetyMarginBytes: z.number().int().nonnegative(),
    subtotalBytes: z.number().int().positive(),
    transformedScratchBytes: z.number().int().nonnegative(),
  })
  .strict();

export const computationalMergeAcceptedTilePlanV1Schema = z
  .object({
    columns: z.number().int().positive(),
    coreHeight: z.number().int().positive(),
    coreWidth: z.number().int().positive(),
    halo: haloSchema,
    memory: memoryEstimateSchema,
    memoryBudgetBytes: z
      .number()
      .int()
      .min(256 * 1024 * 1024)
      .max(2 * 1024 * 1024 * 1024),
    overlapOwnership: z.literal('core_only'),
    planHash: hashSchema,
    reductionOrder: z.literal('source_then_row_major_tile'),
    rows: z.number().int().positive(),
    schemaVersion: z.literal(1),
    stageWorkUnits: z
      .array(
        z
          .object({
            stage: z.string().trim().min(1),
            units: z.number().int().positive(),
            weight: z.number().int().positive(),
          })
          .strict(),
      )
      .min(1),
    tileCount: z.number().int().positive(),
    tiles: z
      .array(
        z
          .object({
            column: z.number().int().nonnegative(),
            coreHeight: z.number().int().positive(),
            coreWidth: z.number().int().positive(),
            coreX: z.number().int().nonnegative(),
            coreY: z.number().int().nonnegative(),
            halo: haloSchema,
            index: z.number().int().nonnegative(),
            inputHeight: z.number().int().positive(),
            inputWidth: z.number().int().positive(),
            inputX: z.number().int(),
            inputY: z.number().int(),
            row: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.tileCount !== value.rows * value.columns || value.tiles.length !== value.tileCount)
      context.addIssue({
        code: 'custom',
        message: 'Tile count must match the complete row-major grid.',
        path: ['tileCount'],
      });
    if (value.memory.estimatedPeakBytes > value.memoryBudgetBytes)
      context.addIssue({ code: 'custom', message: 'Accepted plan exceeds its memory budget.', path: ['memory'] });
  });

export const computationalMergeRuntimeReceiptV1Schema = z
  .object({
    cancellationStage: z.string().trim().min(1).nullable(),
    commit: z
      .object({
        commitStatus: z.enum(['committed', 'unregistered']),
        finalPackagePath: z.string().trim().min(1),
        inventoryHash: hashSchema,
        manifestHash: hashSchema,
        mapHashes: z.array(hashSchema),
        payloadHash: hashSchema,
        recoveryAction: z.literal('retry_derived_source_registration').nullable(),
        stagingIdentity: z.string().trim().min(1),
      })
      .strict(),
    family: familySchema,
    observedPeakMemoryBytes: z.number().int().nonnegative(),
    observedTileCount: z.number().int().nonnegative(),
    planHash: hashSchema,
    receiptVersion: z.literal(1),
    sourceImmutabilityHashes: z.array(hashSchema).min(1),
    stageTimings: z.array(z.object({ elapsedMs: z.number().nonnegative(), stage: z.string().trim().min(1) }).strict()),
    status: z.enum(['cancelled', 'failed', 'succeeded']),
  })
  .strict();

export const computationalMergeDeterministicReceiptV1Schema = computationalMergeRuntimeReceiptV1Schema
  .omit({ cancellationStage: true, stageTimings: true })
  .extend({ status: z.literal('succeeded') })
  .strict();
export type ComputationalMergeAcceptedTilePlanV1 = z.infer<typeof computationalMergeAcceptedTilePlanV1Schema>;
export type ComputationalMergeRuntimeReceiptV1 = z.infer<typeof computationalMergeRuntimeReceiptV1Schema>;
