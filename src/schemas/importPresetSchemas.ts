import { z } from 'zod';

import { uniqueStringArraySchema } from './zodUniqueHelpers';

export const importPresetSourcePolicySchema = z.enum(['copy', 'move', 'reference']);
export const importPresetDuplicatePolicySchema = z.enum(['skip', 'rename', 'overwrite_after_approval']);
export const importPresetSidecarPolicySchema = z.enum(['copy_existing', 'create_empty', 'ignore']);

export const importPresetBackupPolicySchema = z
  .object({
    backupRootPath: z.string().trim().min(1).nullable(),
    enabled: z.boolean(),
  })
  .strict()
  .superRefine((policy, context) => {
    if (policy.enabled && policy.backupRootPath === null) {
      context.addIssue({
        code: 'custom',
        message: 'Enabled backups require backupRootPath.',
        path: ['backupRootPath'],
      });
    }
  });

export const importPresetSchema = z
  .object({
    addTags: uniqueStringArraySchema('addTags'),
    applyPresetIds: uniqueStringArraySchema('applyPresetIds'),
    backupPolicy: importPresetBackupPolicySchema,
    colorLabel: z.string().trim().min(1).nullable(),
    createdAt: z.iso.datetime(),
    destinationRootPath: z.string().trim().min(1).nullable(),
    duplicatePolicy: importPresetDuplicatePolicySchema,
    fileNamingTemplate: z.string().trim().min(1),
    id: z.string().trim().min(1),
    metadataTemplateId: z.string().trim().min(1).nullable(),
    name: z.string().trim().min(1),
    rawOnly: z.boolean(),
    rating: z.number().int().min(0).max(5).nullable(),
    requireExplicitApproval: z.boolean(),
    sidecarPolicy: importPresetSidecarPolicySchema,
    sourcePolicy: importPresetSourcePolicySchema,
    subfolderTemplate: z.string().trim().min(1).nullable(),
    updatedAt: z.iso.datetime(),
    version: z.literal(1),
  })
  .strict()
  .superRefine((preset, context) => {
    if (Date.parse(preset.updatedAt) < Date.parse(preset.createdAt)) {
      context.addIssue({ code: 'custom', message: 'updatedAt must be at or after createdAt.', path: ['updatedAt'] });
    }
    if (preset.sourcePolicy !== 'reference' && preset.destinationRootPath === null) {
      context.addIssue({
        code: 'custom',
        message: 'Copy and move import presets require destinationRootPath.',
        path: ['destinationRootPath'],
      });
    }
    if (
      (preset.sourcePolicy === 'move' || preset.duplicatePolicy === 'overwrite_after_approval') &&
      !preset.requireExplicitApproval
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Move and overwrite import presets require explicit approval.',
        path: ['requireExplicitApproval'],
      });
    }
  });

export const importPresetCatalogSchema = z
  .object({
    defaultPresetId: z.string().trim().min(1).nullable(),
    presets: z.array(importPresetSchema),
  })
  .strict()
  .superRefine((catalog, context) => {
    const ids = new Set<string>();
    for (const [index, preset] of catalog.presets.entries()) {
      if (ids.has(preset.id)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate import preset id: ${preset.id}`,
          path: ['presets', index, 'id'],
        });
      }
      ids.add(preset.id);
    }
    if (catalog.defaultPresetId !== null && !ids.has(catalog.defaultPresetId)) {
      context.addIssue({
        code: 'custom',
        message: 'defaultPresetId must reference a preset.',
        path: ['defaultPresetId'],
      });
    }
  });

export type ImportPreset = z.infer<typeof importPresetSchema>;
export type ImportPresetCatalog = z.infer<typeof importPresetCatalogSchema>;

export interface PlannedImportItem {
  action: ImportPreset['sourcePolicy'];
  destinationPath: string | null;
  sourcePath: string;
}

const fileNameFromPath = (path: string): string => path.split(/[\\/]/).at(-1) ?? path;

const applyNamingTemplate = (template: string, sourcePath: string, index: number): string =>
  template
    .replaceAll('{filename}', fileNameFromPath(sourcePath))
    .replaceAll('{sequence}', String(index + 1).padStart(4, '0'));

export const planImportPreset = (preset: ImportPreset, sourcePaths: string[]): PlannedImportItem[] =>
  sourcePaths.map((sourcePath, index) => {
    const fileName = applyNamingTemplate(preset.fileNamingTemplate, sourcePath, index);
    const destinationPath =
      preset.destinationRootPath === null
        ? null
        : [preset.destinationRootPath, preset.subfolderTemplate, fileName].filter((part) => part !== null).join('/');
    return { action: preset.sourcePolicy, destinationPath, sourcePath };
  });

export const parseImportPresetCatalog = (value: unknown): ImportPresetCatalog => importPresetCatalogSchema.parse(value);
