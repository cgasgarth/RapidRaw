import { z } from 'zod';

import { privateRawFormatSchema } from '../privateRawFormatSchemas';

export const computationalMergeSourceSetFamilySchema = z.enum(['panorama_stitch', 'focus_stack', 'super_resolution']);

const sourceItemSchema = z
  .object({
    expectedRawFormat: privateRawFormatSchema,
    localRelativePath: z.string().trim().min(1),
    publicRepoAllowed: z.literal(false),
    sourceIndex: z.number().int().nonnegative(),
  })
  .strict();

export const computationalMergePrivateSourceSetSchema = z
  .object({
    evidenceId: z.string().regex(/^raw-evidence\.[a-z0-9.-]+\.v[0-9]+$/u),
    featureFamily: computationalMergeSourceSetFamilySchema,
    fixtureId: z.string().regex(/^validation\.computational-merge\.[a-z0-9.-]+\.v[0-9]+$/u),
    implementationIssue: z.number().int().positive(),
    proofStatus: z.enum([
      'manifest_only',
      'pending_private_assets',
      'runtime_apply_capable',
      'e2e_verified_private_assets',
    ]),
    sourceItems: z.array(sourceItemSchema).min(1),
    uiIssue: z.number().int().positive(),
  })
  .strict()
  .superRefine((sourceSet, context) => {
    const minimumSourceCounts = {
      focus_stack: 3,
      panorama_stitch: 3,
      super_resolution: 3,
    } as const;
    if (sourceSet.sourceItems.length < minimumSourceCounts[sourceSet.featureFamily]) {
      context.addIssue({
        code: 'custom',
        message: `${sourceSet.featureFamily} source set needs at least ${minimumSourceCounts[sourceSet.featureFamily]} inputs.`,
        path: ['sourceItems'],
      });
    }

    const sourceIndices = sourceSet.sourceItems.map((item) => item.sourceIndex);
    if (new Set(sourceIndices).size !== sourceIndices.length) {
      context.addIssue({
        code: 'custom',
        message: 'Source indices must be unique.',
        path: ['sourceItems'],
      });
    }
  });

export const computationalMergePrivateSourceSetCollectionSchema = z
  .object({
    issue: z.literal(1811),
    schemaVersion: z.literal(1),
    sourceSets: z.array(computationalMergePrivateSourceSetSchema).min(3),
  })
  .strict()
  .superRefine((collection, context) => {
    const families = new Set(collection.sourceSets.map((sourceSet) => sourceSet.featureFamily));
    for (const requiredFamily of computationalMergeSourceSetFamilySchema.options) {
      if (!families.has(requiredFamily)) {
        context.addIssue({
          code: 'custom',
          message: `Source-set collection requires ${requiredFamily}.`,
          path: ['sourceSets'],
        });
      }
    }
  });

export type ComputationalMergePrivateSourceSet = z.infer<typeof computationalMergePrivateSourceSetSchema>;
export type ComputationalMergePrivateSourceSetCollection = z.infer<
  typeof computationalMergePrivateSourceSetCollectionSchema
>;
