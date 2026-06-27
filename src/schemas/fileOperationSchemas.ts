import { z } from 'zod';

export const fileOperationPathSchema = z.string().trim().min(1);
export const fileOperationPathListSchema = z.array(fileOperationPathSchema).min(1);
export const fileOperationVoidResponseSchema = z.unknown().transform(() => undefined);

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
export type RenameFilesRequest = z.infer<typeof renameFilesRequestSchema>;
export type RenameFolderRequest = z.infer<typeof renameFolderRequestSchema>;
export type ResolveAndroidContentUriNameRequest = z.infer<typeof resolveAndroidContentUriNameRequestSchema>;
