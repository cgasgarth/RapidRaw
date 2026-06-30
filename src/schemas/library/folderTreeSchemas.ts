import { z } from 'zod';

export interface FolderTreePayload {
  children: FolderTreePayload[];
  hasSubdirs?: boolean | undefined;
  imageCount?: number | undefined;
  isDir: boolean;
  name: string;
  path: string;
}

export const folderTreeSchema: z.ZodType<FolderTreePayload> = z.lazy(() =>
  z
    .object({
      children: z.array(folderTreeSchema),
      hasSubdirs: z.boolean().optional(),
      imageCount: z.number().int().nonnegative().optional(),
      isDir: z.boolean(),
      name: z.string(),
      path: z.string(),
    })
    .strict(),
);

export const folderTreeListSchema = z.array(folderTreeSchema);
