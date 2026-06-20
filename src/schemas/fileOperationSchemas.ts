import { z } from 'zod';

export const fileOperationPathSchema = z.string().trim().min(1);
export const fileOperationPathListSchema = z.array(fileOperationPathSchema).min(1);

export const renameFilesRequestSchema = z
  .object({
    nameTemplate: z.string().trim().min(1),
    paths: fileOperationPathListSchema,
  })
  .strict();

export type FileOperationPathList = z.infer<typeof fileOperationPathListSchema>;
export type RenameFilesRequest = z.infer<typeof renameFilesRequestSchema>;
