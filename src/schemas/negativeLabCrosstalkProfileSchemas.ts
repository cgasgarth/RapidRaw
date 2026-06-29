import { z } from 'zod';

export const negativeLabCrosstalkProfileIdSchema = z
  .string()
  .regex(/^negative_lab\.crosstalk\.(?:identity|user|imported)\.[a-z0-9_]+\.v[0-9]+$/u);
export const negativeLabCrosstalkProfileProvenanceSchema = z.enum([
  'rawengine_identity_default',
  'user_owned',
  'user_imported',
]);
export const negativeLabCrosstalkProfileMatrixValueSchema = z
  .number()
  .min(-2)
  .max(2)
  .refine(Number.isFinite, { message: 'Negative Lab crosstalk matrix values must be finite.' });
export const negativeLabCrosstalkProfileMatrixRowSchema = z.tuple([
  negativeLabCrosstalkProfileMatrixValueSchema,
  negativeLabCrosstalkProfileMatrixValueSchema,
  negativeLabCrosstalkProfileMatrixValueSchema,
]);
export const negativeLabCrosstalkProfileMatrixSchema = z.tuple([
  negativeLabCrosstalkProfileMatrixRowSchema,
  negativeLabCrosstalkProfileMatrixRowSchema,
  negativeLabCrosstalkProfileMatrixRowSchema,
]);

export const negativeLabCrosstalkProfileSchema = z
  .object({
    matrix: negativeLabCrosstalkProfileMatrixSchema,
    profileId: negativeLabCrosstalkProfileIdSchema,
    provenance: negativeLabCrosstalkProfileProvenanceSchema,
    provenanceHash: z.string().regex(/^fnv1a32:[a-f0-9]{8}$/u),
    schemaVersion: z.literal(1),
    strength: z
      .number()
      .min(0)
      .max(1)
      .refine(Number.isFinite, { message: 'Negative Lab crosstalk strength must be finite.' }),
  })
  .strict()
  .superRefine((profile, context) => {
    for (const [rowIndex, row] of profile.matrix.entries()) {
      const rowSum = row.reduce((sum, value) => sum + value, 0);
      if (Math.abs(rowSum) < 1e-8) {
        context.addIssue({
          code: 'custom',
          message: 'Negative Lab crosstalk matrix rows must be normalizable.',
          path: ['matrix', rowIndex],
        });
      }
    }

    if (profile.provenance === 'rawengine_identity_default' && profile.strength !== 0) {
      context.addIssue({
        code: 'custom',
        message: 'RawEngine identity crosstalk defaults must use zero blend strength.',
        path: ['strength'],
      });
    }
  });

export type NegativeLabCrosstalkProfile = z.infer<typeof negativeLabCrosstalkProfileSchema>;
export type NegativeLabCrosstalkProfileMatrix = z.infer<typeof negativeLabCrosstalkProfileMatrixSchema>;
