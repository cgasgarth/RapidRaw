import { z } from 'zod';

import { uniqueStringArraySchema } from './zodUniqueHelpers';

export const metadataTemplateMergeModeSchema = z.enum(['append_tags', 'replace_fields']);
export const metadataTemplateFieldSchema = z.enum([
  'Artist',
  'Copyright',
  'ImageDescription',
  'UserComment',
  'colorLabel',
  'rating',
  'tags',
]);

export const metadataTemplateValuesSchema = z
  .object({
    Artist: z.string().trim().min(1).nullable(),
    Copyright: z.string().trim().min(1).nullable(),
    ImageDescription: z.string().trim().min(1).nullable(),
    UserComment: z.string().trim().min(1).nullable(),
    colorLabel: z.string().trim().min(1).nullable(),
    rating: z.number().int().min(0).max(5).nullable(),
    tags: uniqueStringArraySchema('tags'),
  })
  .strict();

export const metadataTemplateSchema = z
  .object({
    applyFields: z.array(metadataTemplateFieldSchema).min(1),
    createdAt: z.iso.datetime(),
    id: z.string().trim().min(1),
    mergeMode: metadataTemplateMergeModeSchema,
    name: z.string().trim().min(1),
    requireApproval: z.boolean(),
    updatedAt: z.iso.datetime(),
    values: metadataTemplateValuesSchema,
    version: z.literal(1),
  })
  .strict()
  .superRefine((template, context) => {
    if (Date.parse(template.updatedAt) < Date.parse(template.createdAt)) {
      context.addIssue({ code: 'custom', message: 'updatedAt must be at or after createdAt.', path: ['updatedAt'] });
    }

    const uniqueFields = new Set(template.applyFields);
    if (uniqueFields.size !== template.applyFields.length) {
      context.addIssue({ code: 'custom', message: 'applyFields must not contain duplicates.', path: ['applyFields'] });
    }

    for (const field of template.applyFields) {
      const value = template.values[field];
      if (field === 'tags' ? template.values.tags.length === 0 : value === null) {
        context.addIssue({
          code: 'custom',
          message: `applyFields references empty value for ${field}.`,
          path: ['values', field],
        });
      }
    }

    if (template.mergeMode === 'replace_fields' && !template.requireApproval) {
      context.addIssue({
        code: 'custom',
        message: 'Replacing metadata fields requires approval.',
        path: ['requireApproval'],
      });
    }
  });

export const metadataTemplateCatalogSchema = z
  .object({
    defaultTemplateId: z.string().trim().min(1).nullable(),
    templates: z.array(metadataTemplateSchema),
  })
  .strict()
  .superRefine((catalog, context) => {
    const ids = new Set<string>();
    for (const [index, template] of catalog.templates.entries()) {
      if (ids.has(template.id)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate metadata template id: ${template.id}`,
          path: ['templates', index, 'id'],
        });
      }
      ids.add(template.id);
    }
    if (catalog.defaultTemplateId !== null && !ids.has(catalog.defaultTemplateId)) {
      context.addIssue({
        code: 'custom',
        message: 'defaultTemplateId must reference a template.',
        path: ['defaultTemplateId'],
      });
    }
  });

export const metadataTemplateTargetSchema = z
  .object({
    Artist: z.string().nullable(),
    Copyright: z.string().nullable(),
    ImageDescription: z.string().nullable(),
    UserComment: z.string().nullable(),
    colorLabel: z.string().nullable(),
    path: z.string().trim().min(1),
    rating: z.number().int().min(0).max(5),
    tags: uniqueStringArraySchema('targetTags'),
  })
  .strict();

export type MetadataTemplate = z.infer<typeof metadataTemplateSchema>;
export type MetadataTemplateCatalog = z.infer<typeof metadataTemplateCatalogSchema>;
export type MetadataTemplateTarget = z.infer<typeof metadataTemplateTargetSchema>;

export const applyMetadataTemplate = (
  template: MetadataTemplate,
  target: MetadataTemplateTarget,
): MetadataTemplateTarget => {
  const nextTarget = { ...target };
  for (const field of template.applyFields) {
    if (field === 'tags') {
      const tags =
        template.mergeMode === 'append_tags' ? [...target.tags, ...template.values.tags] : template.values.tags;
      nextTarget.tags = Array.from(new Set(tags));
    } else if (field === 'rating') {
      nextTarget.rating = template.values.rating ?? nextTarget.rating;
    } else {
      nextTarget[field] = template.values[field];
    }
  }
  return nextTarget;
};

export const parseMetadataTemplateCatalog = (value: unknown): MetadataTemplateCatalog =>
  metadataTemplateCatalogSchema.parse(value);
export const parseMetadataTemplateTarget = (value: unknown): MetadataTemplateTarget =>
  metadataTemplateTargetSchema.parse(value);
