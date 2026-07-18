import { z } from 'zod';

import { Panel } from '../components/ui/AppProperties';
import {
  DEFAULT_DEVELOP_PANEL_ORDER,
  DEVELOP_PANEL_IDS,
  isValidDevelopPanelHidden,
  isValidDevelopPanelOrder,
} from '../utils/developPanelCustomization';

const EDITOR_WORKSPACE_PREFERENCE_VERSION = 1 as const;

const editorWorkspaceZoomModeSchema = z.enum(['fit', 'fill', 'oneToOne']);
const editorWorkspaceLightsOutLevelSchema = z.enum(['off', 'dim', 'black']);
const editorWorkspaceCompareModeSchema = z.enum(['off', 'hold-original', 'split-wipe', 'side-by-side']);
const compactEditorDrawerStateSchema = z.enum(['collapsed', 'peek', 'expanded']);
const editorWorkspacePanelSchema = z.nativeEnum(Panel);
export const editorLeftSectionIdSchema = z.enum([
  'navigator',
  'presets',
  'snapshots',
  'history',
  'collections',
  'focusSources',
]);
const developPanelIdSchema = z.enum(DEVELOP_PANEL_IDS);

const developPanelOrderSchema = z
  .array(developPanelIdSchema)
  .length(DEVELOP_PANEL_IDS.length)
  .superRefine((value, context) => {
    if (!isValidDevelopPanelOrder(value)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Develop panel order must contain each id once.' });
    }
  });

const developPanelHiddenSchema = z.array(developPanelIdSchema).superRefine((value, context) => {
  if (!isValidDevelopPanelHidden(value)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Develop panel visibility contains an invalid id.' });
  }
});

const sectionIdsSchema = z.array(z.string().trim().min(1)).max(32);

export const editorWorkspacePreferencesSchema = z
  .object({
    compact: z
      .object({
        toolsExpanded: z.boolean(),
        toolsHeight: z.number().int().min(180).max(850).nullable(),
        drawerState: compactEditorDrawerStateSchema,
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
        expandedSections: z.array(editorLeftSectionIdSchema).max(32),
        soloSectionId: editorLeftSectionIdSchema.nullable().default(null),
        visible: z.boolean(),
        width: z.number().int().min(200).max(500),
      })
      .strict(),
    rightInspector: z
      .object({
        activePanel: editorWorkspacePanelSchema,
        developPanelHidden: developPanelHiddenSchema.default([]),
        developPanelOrder: developPanelOrderSchema.default([...DEFAULT_DEVELOP_PANEL_ORDER]),
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
export type EditorLeftSectionId = z.infer<typeof editorLeftSectionIdSchema>;
