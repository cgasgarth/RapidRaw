import { z } from 'zod';

export const LIBRARY_WORKSPACE_PREFERENCE_VERSION = 1 as const;

export const libraryWorkspacePreferencesSchema = z
  .object({
    folderTree: z
      .object({
        visible: z.boolean(),
        width: z.number().int().min(200).max(500),
      })
      .strict(),
    version: z.literal(LIBRARY_WORKSPACE_PREFERENCE_VERSION),
  })
  .strict();

export type LibraryWorkspacePreferences = z.infer<typeof libraryWorkspacePreferencesSchema>;
