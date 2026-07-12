import { z } from 'zod';

export const fileOperationPathSchema = z.string().trim().min(1);
export const fileOperationPathListSchema = z.array(fileOperationPathSchema).min(1);
export const fileOperationVoidResponseSchema = z.unknown().transform(() => undefined);
export const importJobIdSchema = z.string().min(1);
export const importStageSchema = z.enum([
  'preflight',
  'inspecting',
  'copying',
  'verifying',
  'committing',
  'deletingSource',
  'cataloging',
  'completed',
  'failed',
  'cancelled',
]);

export const importItemFailureSchema = z
  .object({
    itemId: z.number().int().nonnegative(),
    source: fileOperationPathSchema,
    stage: importStageSchema,
    error: z.string(),
  })
  .strict();

export const importResumeValidationSchema = z
  .object({
    jobId: importJobIdSchema,
    verifiedCompleted: z.array(z.number().int().nonnegative()),
    resumable: z.array(z.number().int().nonnegative()),
    invalid: z.array(importItemFailureSchema),
  })
  .strict();

export const deleteFilesRequestSchema = z
  .object({
    paths: fileOperationPathListSchema,
  })
  .strict();

export const createFolderRequestSchema = z
  .object({
    path: fileOperationPathSchema,
  })
  .strict();

export const renameFolderRequestSchema = z
  .object({
    newName: z.string().trim().min(1),
    path: fileOperationPathSchema,
  })
  .strict();

export const renameFilesRequestSchema = z
  .object({
    nameTemplate: z.string().trim().min(1),
    paths: fileOperationPathListSchema,
  })
  .strict();

export const importFilesRequestSchema = z
  .object({
    destinationFolder: fileOperationPathSchema,
    settings: z
      .object({
        dateFolderFormat: z.string(),
        deleteAfterImport: z.boolean(),
        filenameTemplate: z.string().trim().min(1),
        organizeByDate: z.boolean(),
      })
      .strict(),
    sourcePaths: fileOperationPathListSchema,
  })
  .strict();

export const copyMoveFilesRequestSchema = z
  .object({
    destinationFolder: fileOperationPathSchema,
    sourcePaths: fileOperationPathListSchema,
  })
  .strict();

export const resolveAndroidContentUriNameRequestSchema = z
  .object({
    uriStr: fileOperationPathSchema,
  })
  .strict();

export type FileOperationPathList = z.infer<typeof fileOperationPathListSchema>;
export type CopyMoveFilesRequest = z.infer<typeof copyMoveFilesRequestSchema>;
export type CreateFolderRequest = z.infer<typeof createFolderRequestSchema>;
export type DeleteFilesRequest = z.infer<typeof deleteFilesRequestSchema>;
export type ImportFilesRequest = z.infer<typeof importFilesRequestSchema>;
export type ImportResumeValidation = z.infer<typeof importResumeValidationSchema>;
export type RenameFilesRequest = z.infer<typeof renameFilesRequestSchema>;
export type RenameFolderRequest = z.infer<typeof renameFolderRequestSchema>;
export type ResolveAndroidContentUriNameRequest = z.infer<typeof resolveAndroidContentUriNameRequestSchema>;
