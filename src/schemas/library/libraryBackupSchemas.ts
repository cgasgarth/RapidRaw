import { z } from 'zod';

import { uniqueStringArraySchema } from '../zodUniqueHelpers';

export const libraryBackupFileRoleSchema = z.enum([
  'library_session',
  'sidecar_rrdata',
  'sidecar_rrexif',
  'preset',
  'metadata_template',
  'source_reference',
]);

export const libraryBackupHashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);

export const libraryBackupFileEntrySchema = z
  .object({
    byteLength: z.number().int().min(0),
    contentHash: libraryBackupHashSchema,
    originalPath: z.string().trim().min(1),
    restoredPath: z.string().trim().min(1).optional(),
    role: libraryBackupFileRoleSchema,
  })
  .strict();

export const libraryBackupManifestSchema = z
  .object({
    backupId: z.string().trim().min(1),
    createdAt: z.iso.datetime(),
    excludedOriginalPaths: uniqueStringArraySchema('excludedOriginalPaths'),
    fileCount: z.number().int().min(1),
    files: z.array(libraryBackupFileEntrySchema).min(1),
    includeOriginals: z.boolean(),
    manifestHash: libraryBackupHashSchema,
    schemaVersion: z.literal(1),
    sessionId: z.string().trim().min(1),
    sourceSessionHash: libraryBackupHashSchema,
    totalBytes: z.number().int().min(0),
  })
  .strict()
  .superRefine((manifest, context) => {
    if (manifest.fileCount !== manifest.files.length) {
      context.addIssue({
        code: 'custom',
        message: 'fileCount must match files.length.',
        path: ['fileCount'],
      });
    }

    const totalBytes = manifest.files.reduce((sum, file) => sum + file.byteLength, 0);
    if (manifest.totalBytes !== totalBytes) {
      context.addIssue({
        code: 'custom',
        message: 'totalBytes must match the file entries.',
        path: ['totalBytes'],
      });
    }

    if (!manifest.files.some((file) => file.role === 'library_session')) {
      context.addIssue({
        code: 'custom',
        message: 'Backup manifest must include the library session file.',
        path: ['files'],
      });
    }
  });

export type LibraryBackupFileEntry = z.infer<typeof libraryBackupFileEntrySchema>;
export type LibraryBackupManifest = z.infer<typeof libraryBackupManifestSchema>;
export type LibraryBackupFileRole = z.infer<typeof libraryBackupFileRoleSchema>;

export const parseLibraryBackupManifest = (value: unknown): LibraryBackupManifest =>
  libraryBackupManifestSchema.parse(value);
