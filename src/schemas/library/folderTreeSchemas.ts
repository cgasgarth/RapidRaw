import { z } from 'zod';

export interface FolderTreePayload {
  children: FolderTreePayload[];
  hasSubdirs?: boolean | undefined;
  imageCount?: number | undefined;
  isDir: boolean;
  modified: number;
  name: string;
  path: string;
  created: number;
}

export const folderTreeSchema: z.ZodType<FolderTreePayload> = z.lazy(() =>
  z
    .object({
      children: z.array(folderTreeSchema),
      hasSubdirs: z.boolean().optional(),
      imageCount: z.number().int().nonnegative().optional(),
      isDir: z.boolean(),
      modified: z.number().int().nonnegative(),
      name: z.string(),
      path: z.string(),
      created: z.number().int().nonnegative(),
    })
    .strict(),
);

export const folderTreeListSchema = z.array(folderTreeSchema);
