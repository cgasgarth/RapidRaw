import { z } from 'zod';

import { uniqueStringArraySchema } from '../zodUniqueHelpers';

export const librarySessionKindSchema = z.enum([
  'folder_browse',
  'shoot_session',
  'culling',
  'editing',
  'client_select',
  'export_review',
]);

export const librarySessionWorkflowStageSchema = z.enum(['ingest', 'cull', 'edit', 'review', 'export', 'archive']);
export const librarySessionViewModeSchema = z.enum(['grid', 'list', 'compare', 'survey']);
export const librarySessionSortKeySchema = z.enum(['name', 'modified_at', 'rating', 'color_label', 'file_type']);
export const librarySessionSortOrderSchema = z.enum(['asc', 'desc']);
export const librarySessionRawStatusSchema = z.enum(['all', 'raw_only', 'rendered_only', 'missing_sidecar']);

export const librarySessionSortSchema = z
  .object({
    key: librarySessionSortKeySchema,
    order: librarySessionSortOrderSchema,
  })
  .strict();

export const librarySessionFilterSchema = z
  .object({
    colorLabels: uniqueStringArraySchema('colorLabels'),
    minimumRating: z.number().int().min(0).max(5),
    rawStatus: librarySessionRawStatusSchema,
    tags: uniqueStringArraySchema('tags'),
    text: z.string(),
  })
  .strict();

export const librarySessionSchema = z
  .object({
    activeAlbumId: z.string().trim().min(1).nullable(),
    activeAssetPath: z.string().trim().min(1).nullable(),
    activeFolderPath: z.string().trim().min(1).nullable(),
    createdAt: z.iso.datetime(),
    exportRecipeIds: uniqueStringArraySchema('exportRecipeIds'),
    filters: librarySessionFilterSchema,
    id: z.string().trim().min(1),
    importPresetId: z.string().trim().min(1).nullable(),
    kind: librarySessionKindSchema,
    lastOpenedAt: z.iso.datetime().nullable(),
    name: z.string().trim().min(1),
    notes: z.string().nullable(),
    recentAssetPaths: uniqueStringArraySchema('recentAssetPaths'),
    rootPaths: uniqueStringArraySchema('rootPaths').min(1),
    selectedAssetPaths: uniqueStringArraySchema('selectedAssetPaths'),
    smartAlbumIds: uniqueStringArraySchema('smartAlbumIds'),
    sort: librarySessionSortSchema,
    stateVersion: z.literal(1),
    updatedAt: z.iso.datetime(),
    viewMode: librarySessionViewModeSchema,
    workflowStage: librarySessionWorkflowStageSchema,
  })
  .strict()
  .superRefine((session, context) => {
    const createdAt = Date.parse(session.createdAt);
    const updatedAt = Date.parse(session.updatedAt);
    if (updatedAt < createdAt) {
      context.addIssue({
        code: 'custom',
        message: 'updatedAt must be at or after createdAt.',
        path: ['updatedAt'],
      });
    }

    if (session.lastOpenedAt !== null && Date.parse(session.lastOpenedAt) < createdAt) {
      context.addIssue({
        code: 'custom',
        message: 'lastOpenedAt must be at or after createdAt.',
        path: ['lastOpenedAt'],
      });
    }

    if (session.activeAssetPath !== null && !session.recentAssetPaths.includes(session.activeAssetPath)) {
      context.addIssue({
        code: 'custom',
        message: 'activeAssetPath must reference a recent asset.',
        path: ['activeAssetPath'],
      });
    }

    for (const selectedPath of session.selectedAssetPaths) {
      if (!session.recentAssetPaths.includes(selectedPath)) {
        context.addIssue({
          code: 'custom',
          message: 'selectedAssetPaths must reference recent assets.',
          path: ['selectedAssetPaths'],
        });
      }
    }

    if (session.activeFolderPath !== null) {
      const isInsideRoot = session.rootPaths.some(
        (rootPath) => session.activeFolderPath === rootPath || session.activeFolderPath?.startsWith(`${rootPath}/`),
      );
      if (!isInsideRoot) {
        context.addIssue({
          code: 'custom',
          message: 'activeFolderPath must be inside one of rootPaths.',
          path: ['activeFolderPath'],
        });
      }
    }
  });

export const librarySessionSetSchema = z
  .object({
    activeSessionId: z.string().trim().min(1).nullable(),
    sessions: z.array(librarySessionSchema),
  })
  .strict()
  .superRefine((sessionSet, context) => {
    const ids = new Set<string>();
    for (const [index, session] of sessionSet.sessions.entries()) {
      if (ids.has(session.id)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate library session id: ${session.id}`,
          path: ['sessions', index, 'id'],
        });
      }
      ids.add(session.id);
    }

    if (sessionSet.activeSessionId !== null && !ids.has(sessionSet.activeSessionId)) {
      context.addIssue({
        code: 'custom',
        message: 'activeSessionId must reference an existing session.',
        path: ['activeSessionId'],
      });
    }
  });

export type LibrarySession = z.infer<typeof librarySessionSchema>;
export type LibrarySessionSet = z.infer<typeof librarySessionSetSchema>;

export const parseLibrarySession = (value: unknown): LibrarySession => librarySessionSchema.parse(value);
export const parseLibrarySessionSet = (value: unknown): LibrarySessionSet => librarySessionSetSchema.parse(value);
