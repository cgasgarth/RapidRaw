import { z } from 'zod';

export const libraryFolderAggregateSchema = z
  .object({
    path: z.string().min(1),
    directImageCount: z.number().int().nonnegative(),
    recursiveImageCount: z.number().int().nonnegative(),
    childFolderCount: z.number().int().nonnegative(),
    catalogRevision: z.number().int().nonnegative(),
  })
  .strict();

export const libraryFolderAggregateListSchema = z.array(libraryFolderAggregateSchema);

export type LibraryFolderAggregate = z.infer<typeof libraryFolderAggregateSchema>;
