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
    throw new Error(`Invalid AI patch data JSON: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }

  return aiPatchDataSchema.parse(parsed);
};

export const aiMaskCapabilitySchema = z.enum(['background', 'depth', 'foreground', 'person', 'sky', 'subject']);

export const aiMaskCapabilityAuditEntrySchema = z
  .object({
    capability: aiMaskCapabilitySchema,
    derivedFrom: aiMaskCapabilitySchema.optional(),
    invokeCommand: z
      .enum([
        'generate_ai_depth_mask',
        'generate_ai_foreground_mask',
        'generate_ai_whole_person_mask',
        'generate_ai_sky_mask',
        'generate_ai_subject_mask',
      ])
      .nullable(),
    renderMaskType: z.enum(['ai-depth', 'ai-foreground', 'ai-person', 'ai-sky', 'ai-subject']),
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

export const aiPeopleMaskPartSchema = z.enum([
  'arms',
  'background',
  'clothing',
  'eyes',
  'face',
  'full_person',
  'hair',
  'hands',
  'legs',
  'lips',
  'skin',
  'teeth',
]);

export const aiPeopleMaskProviderTierSchema = z.enum([
  'contract',
  'fake_provider',
  'macos_face',
  'macos_person',
  'person_parser',
  'face_detail',
]);

export const aiPeopleMaskRuntimeStatusSchema = z.enum(['schema_only', 'dry_run', 'runtime_apply']);

export const aiPeopleMaskSupportStatusSchema = z.enum(['supported', 'derived', 'planned', 'unsupported']);

export const aiPeopleMaskProviderCapabilitySchema = z
  .object({
    notes: z.string().trim().min(1),
    part: aiPeopleMaskPartSchema,
    providerTier: aiPeopleMaskProviderTierSchema,
    status: aiPeopleMaskSupportStatusSchema,
    validationMode: aiPeopleMaskRuntimeStatusSchema,
  })
  .strict()
  .superRefine((capability, context) => {
    if (capability.status === 'supported' && capability.validationMode === 'schema_only') {
      context.addIssue({
        code: 'custom',
        message: 'Supported people-mask parts need dry-run or runtime validation.',
        path: ['validationMode'],
      });
    }

    if (capability.status === 'unsupported' && capability.validationMode !== 'schema_only') {
      context.addIssue({
        code: 'custom',
        message: 'Unsupported people-mask parts must stay schema-only.',
        path: ['validationMode'],
      });
    }
  });

export const normalizedAiPeopleRectSchema = z
  .object({
    height: z.number().positive().max(1),
    width: z.number().positive().max(1),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
  })
  .strict()
  .superRefine((rect, context) => {
    if (rect.x + rect.width > 1) {
      context.addIssue({
        code: 'custom',
        message: 'People-mask bounds exceed normalized width.',
        path: ['width'],
      });
    }

    if (rect.y + rect.height > 1) {
      context.addIssue({
        code: 'custom',
        message: 'People-mask bounds exceed normalized height.',
        path: ['height'],
      });
    }
  });

export const aiPeopleMaskTargetSchema = z
  .object({
    part: aiPeopleMaskPartSchema,
    personId: z.string().trim().min(1).nullable(),
  })
  .strict();

export const aiPeopleMaskAnalysisPersonSchema = z
  .object({
    availableParts: z.array(aiPeopleMaskPartSchema).min(1),
    bounds: normalizedAiPeopleRectSchema,
    confidence: z.number().min(0).max(1),
    personId: z.string().trim().min(1),
  })
  .strict()
  .superRefine((person, context) => {
    if (!person.availableParts.includes('full_person')) {
      context.addIssue({
        code: 'custom',
        message: 'People-mask analysis entries must include full_person.',
        path: ['availableParts'],
      });
    }
  });

export const aiPeopleMaskAnalysisSchema = z
  .object({
    generatedAt: z.iso.datetime(),
    imageHash: z.string().trim().min(1),
    people: z.array(aiPeopleMaskAnalysisPersonSchema),
    providerTier: aiPeopleMaskProviderTierSchema,
    schemaVersion: z.literal(1),
    warnings: z.array(z.string().trim().min(1)),
  })
  .strict();

export const aiPeopleMaskArtifactSchema = z
  .object({
    artifactId: z.string().trim().min(1),
    confidence: z.number().min(0).max(1),
    imageHash: z.string().trim().min(1),
    providerTier: aiPeopleMaskProviderTierSchema,
    schemaVersion: z.literal(1),
    status: aiPeopleMaskRuntimeStatusSchema,
    target: aiPeopleMaskTargetSchema,
  })
  .strict();

export const aiPeopleMaskContractFixtureSchema = z
  .object({
    $schema: z.url(),
    analysis: aiPeopleMaskAnalysisSchema,
    artifacts: z.array(aiPeopleMaskArtifactSchema).min(1),
    capabilities: z.array(aiPeopleMaskProviderCapabilitySchema).min(aiPeopleMaskPartSchema.options.length),
    issue: z.literal(121),
    schemaVersion: z.literal(1),
    snapshotDate: z.iso.date(),
  })
  .strict()
  .superRefine((fixture, context) => {
    const capabilityParts = new Set(fixture.capabilities.map((capability) => capability.part));
    for (const part of aiPeopleMaskPartSchema.options) {
      if (!capabilityParts.has(part)) {
        context.addIssue({
          code: 'custom',
          message: `Missing people-mask capability contract for ${part}.`,
          path: ['capabilities'],
        });
      }
    }
  });

export const aiPeopleMaskPickerOptionSchema = z
  .object({
    disabledReason: z.string().trim().min(1).nullable(),
    label: z.string().trim().min(1),
    part: aiPeopleMaskPartSchema,
    recommendedDefault: z.boolean(),
    status: aiPeopleMaskSupportStatusSchema,
    validationMode: aiPeopleMaskRuntimeStatusSchema,
  })
  .strict()
  .superRefine((option, context) => {
    const isUnavailable = option.status === 'unsupported' || option.validationMode === 'schema_only';
    if (isUnavailable && option.disabledReason === null) {
      context.addIssue({
        code: 'custom',
        message: 'Unavailable people-mask picker options require a disabled reason.',
        path: ['disabledReason'],
      });
    }

    if (option.recommendedDefault && isUnavailable) {
      context.addIssue({
        code: 'custom',
        message: 'Unavailable people-mask picker options cannot be recommended defaults.',
        path: ['recommendedDefault'],
      });
    }
  });

export const aiPeopleMaskPickerModelSchema = z
  .object({
    groups: z
      .array(
        z
          .object({
            id: z.enum(['core', 'portrait_parts', 'body_parts']),
            options: z.array(aiPeopleMaskPickerOptionSchema).min(1),
            title: z.string().trim().min(1),
          })
          .strict(),
      )
      .min(1),
    schemaVersion: z.literal(1),
  })
  .strict();

export const aiPeopleMaskPickerModelFixtureSchema = z
  .object({
    $schema: z.url(),
    expectedModel: aiPeopleMaskPickerModelSchema,
    issue: z.literal(1137),
    schemaVersion: z.literal(1),
    snapshotDate: z.iso.date(),
  })
  .strict();

export const aiPeopleMaskFakeAlphaMaskSchema = z
  .object({
    artifactId: z.string().trim().min(1),
    coverage: z.number().min(0).max(1),
    height: z.number().int().positive().max(256),
    rows: z.array(z.string().regex(/^[.#]+$/u)).min(1),
    target: aiPeopleMaskTargetSchema,
    width: z.number().int().positive().max(256),
  })
  .strict()
  .superRefine((mask, context) => {
    if (mask.rows.length !== mask.height) {
      context.addIssue({
        code: 'custom',
        message: 'Fake people-mask row count must match height.',
        path: ['rows'],
      });
    }

    for (const [index, row] of mask.rows.entries()) {
      if (row.length !== mask.width) {
        context.addIssue({
          code: 'custom',
          message: 'Fake people-mask row width must match width.',
          path: ['rows', index],
        });
      }
    }
  });

export const aiPeopleMaskFakeProviderFixtureSchema = z
  .object({
    $schema: z.url(),
    analysis: aiPeopleMaskAnalysisSchema,
    expectedMasks: z.array(aiPeopleMaskFakeAlphaMaskSchema).min(1),
    issue: z.literal(1133),
    schemaVersion: z.literal(1),
    snapshotDate: z.iso.date(),
  })
  .strict();

export const aiPeopleMaskLayerPlanEntrySchema = z
  .object({
    artifactId: z.string().trim().min(1),
    layerId: z.string().trim().min(1),
    maskOperationId: z.string().trim().min(1),
    name: z.string().trim().min(1),
    opacity: z.number().min(0).max(100),
    target: aiPeopleMaskTargetSchema,
    visible: z.boolean(),
  })
  .strict();

export const aiPeopleMaskLayerApplyPlanSchema = z
  .object({
    imageHash: z.string().trim().min(1),
    layers: z.array(aiPeopleMaskLayerPlanEntrySchema).min(1),
    providerTier: aiPeopleMaskProviderTierSchema,
    schemaVersion: z.literal(1),
    status: z.literal('dry_run'),
    warnings: z.array(z.string().trim().min(1)),
  })
  .strict();

export const aiPeopleMaskLayerApplyPlanFixtureSchema = z
  .object({
    $schema: z.url(),
    expectedPlan: aiPeopleMaskLayerApplyPlanSchema,
    issue: z.literal(1136),
    schemaVersion: z.literal(1),
    snapshotDate: z.iso.date(),
  })
  .strict();

export type AiMaskCapability = z.infer<typeof aiMaskCapabilitySchema>;
export type AiMaskCapabilityAuditEntry = z.infer<typeof aiMaskCapabilityAuditEntrySchema>;
export type AiPeopleMaskAnalysis = z.infer<typeof aiPeopleMaskAnalysisSchema>;
export type AiPeopleMaskPickerModel = z.infer<typeof aiPeopleMaskPickerModelSchema>;
export type AiPeopleMaskFakeAlphaMask = z.infer<typeof aiPeopleMaskFakeAlphaMaskSchema>;
export type AiPeopleMaskLayerApplyPlan = z.infer<typeof aiPeopleMaskLayerApplyPlanSchema>;
export type AiPeopleMaskPart = z.infer<typeof aiPeopleMaskPartSchema>;
export type AiPeopleMaskProviderCapability = z.infer<typeof aiPeopleMaskProviderCapabilitySchema>;
export type AiPeopleMaskTarget = z.infer<typeof aiPeopleMaskTargetSchema>;
