import { z } from 'zod';

import type { JsonValue } from '../utils/adjustments';

const jsonPrimitiveSchema = z.union([z.boolean(), z.null(), z.number(), z.string()]);

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([jsonPrimitiveSchema, z.array(jsonValueSchema), z.record(z.string(), jsonValueSchema)]),
);

const aiPatchDataSchema = z
  .record(z.string(), jsonValueSchema)
  .refine((value) => Object.keys(value).length > 0, 'Expected AI patch data object');

export const parseAiPatchDataJson = (value: string): JsonValue => {
  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(`Invalid AI patch data JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  return aiPatchDataSchema.parse(parsed);
};

export const aiMaskCapabilitySchema = z.enum(['background', 'depth', 'foreground', 'sky', 'subject']);

export const aiMaskCapabilityAuditEntrySchema = z
  .object({
    capability: aiMaskCapabilitySchema,
    derivedFrom: aiMaskCapabilitySchema.optional(),
    invokeCommand: z
      .enum([
        'generate_ai_depth_mask',
        'generate_ai_foreground_mask',
        'generate_ai_sky_mask',
        'generate_ai_subject_mask',
      ])
      .nullable(),
    renderMaskType: z.enum(['ai-depth', 'ai-foreground', 'ai-sky', 'ai-subject']),
    status: z.enum(['native', 'derived']),
  })
  .strict()
  .superRefine((entry, context) => {
    if (entry.status === 'native' && entry.invokeCommand === null) {
      context.addIssue({
        code: 'custom',
        message: 'Native AI mask capabilities require an invoke command.',
        path: ['invokeCommand'],
      });
    }

    if (entry.status === 'derived' && entry.derivedFrom === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'Derived AI mask capabilities require a source capability.',
        path: ['derivedFrom'],
      });
    }
  });

export const aiMaskCapabilityAuditSchema = z
  .array(aiMaskCapabilityAuditEntrySchema)
  .min(1)
  .superRefine((entries, context) => {
    const capabilities = new Set(entries.map((entry) => entry.capability));
    for (const capability of aiMaskCapabilitySchema.options) {
      if (!capabilities.has(capability)) {
        context.addIssue({
          code: 'custom',
          message: `Missing AI mask capability audit entry for ${capability}.`,
          path: [],
        });
      }
    }
  });

export type AiMaskCapability = z.infer<typeof aiMaskCapabilitySchema>;
export type AiMaskCapabilityAuditEntry = z.infer<typeof aiMaskCapabilityAuditEntrySchema>;
