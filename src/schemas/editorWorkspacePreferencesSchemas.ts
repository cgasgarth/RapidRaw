import { z } from 'zod';

import { Panel } from '../components/ui/AppProperties';

export const EDITOR_WORKSPACE_PREFERENCE_VERSION = 1 as const;

export const editorWorkspaceZoomModeSchema = z.enum(['fit', 'fill', 'oneToOne']);
export const editorWorkspaceLightsOutLevelSchema = z.enum(['off', 'dim', 'black']);
export const editorWorkspaceCompareModeSchema = z.enum(['off', 'hold-original', 'split-wipe', 'side-by-side']);
export const compactEditorDrawerStateSchema = z.enum(['collapsed', 'peek', 'expanded']);
export const editorWorkspacePanelSchema = z.nativeEnum(Panel);

const sectionIdsSchema = z.array(z.string().trim().min(1)).max(32);

export const editorWorkspacePreferencesSchema = z
  .object({
    compact: z
      .object({
        toolsExpanded: z.boolean(),
        toolsHeight: z.number().int().min(180).max(850).nullable(),
        drawerState: compactEditorDrawerStateSchema.default('expanded'),
      })
      .strict(),
    filmstrip: z
      .object({
        height: z.number().int().min(100).max(400),
        visible: z.boolean(),
      })
      .strict(),
    leftSidebar: z
      .object({
        expandedSections: sectionIdsSchema,
        visible: z.boolean(),
        width: z.number().int().min(200).max(500),
      })
      .strict(),
    rightInspector: z
      .object({
        activePanel: editorWorkspacePanelSchema,
        expandedSectionsByPanel: z.record(z.string().trim().min(1), sectionIdsSchema),
        pinnedControlIds: sectionIdsSchema,
        recentPanels: z.array(editorWorkspacePanelSchema).min(1).max(5),
        visible: z.boolean(),
        width: z.number().int().min(320).max(600),
      })
      .strict(),
    version: z.literal(EDITOR_WORKSPACE_PREFERENCE_VERSION),
    viewer: z
      .object({
        compareMode: editorWorkspaceCompareModeSchema,
        defaultZoomMode: editorWorkspaceZoomModeSchema,
        lightsOutLevel: editorWorkspaceLightsOutLevelSchema,
      })
      .strict(),
  })
  .strict();

export type EditorWorkspacePreferences = z.infer<typeof editorWorkspacePreferencesSchema>;
export type EditorWorkspaceZoomMode = z.infer<typeof editorWorkspaceZoomModeSchema>;
export type EditorWorkspaceLightsOutLevel = z.infer<typeof editorWorkspaceLightsOutLevelSchema>;
export type EditorWorkspaceCompareMode = z.infer<typeof editorWorkspaceCompareModeSchema>;
export type CompactEditorDrawerState = z.infer<typeof compactEditorDrawerStateSchema>;
