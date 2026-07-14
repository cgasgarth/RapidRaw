import { z } from 'zod';

export const negativeLabWorkspacePanelIdSchema = z.enum([
  'process-profile',
  'base-bounds',
  'print-color',
  'auto-sampling',
  'roll-qc',
  'export-output',
]);

export type NegativeLabWorkspacePanelId = z.infer<typeof negativeLabWorkspacePanelIdSchema>;

export const negativeLabWorkspaceLayoutSchema = z
  .object({
    collapsedPanelIds: z.array(negativeLabWorkspacePanelIdSchema),
    pinnedPanelId: negativeLabWorkspacePanelIdSchema.nullable(),
  })
  .strict();

export type NegativeLabWorkspaceLayout = z.infer<typeof negativeLabWorkspaceLayoutSchema>;

export const DEFAULT_NEGATIVE_LAB_WORKSPACE_LAYOUT: NegativeLabWorkspaceLayout = {
  collapsedPanelIds: [],
  pinnedPanelId: null,
};

export const NEGATIVE_LAB_WORKSPACE_LAYOUT_STORAGE_KEY = 'rapidraw.negative-lab.workspace-layout.v1';

export const parseNegativeLabWorkspaceLayout = (value: unknown): NegativeLabWorkspaceLayout => {
  const parsed = negativeLabWorkspaceLayoutSchema.safeParse(value);
  if (!parsed.success) return DEFAULT_NEGATIVE_LAB_WORKSPACE_LAYOUT;
  return {
    collapsedPanelIds: [...new Set(parsed.data.collapsedPanelIds)],
    pinnedPanelId: parsed.data.pinnedPanelId,
  };
};

export const readNegativeLabWorkspaceLayout = (): NegativeLabWorkspaceLayout => {
  if (typeof window === 'undefined') return DEFAULT_NEGATIVE_LAB_WORKSPACE_LAYOUT;
  try {
    return parseNegativeLabWorkspaceLayout(
      JSON.parse(window.localStorage.getItem(NEGATIVE_LAB_WORKSPACE_LAYOUT_STORAGE_KEY) ?? 'null'),
    );
  } catch {
    return DEFAULT_NEGATIVE_LAB_WORKSPACE_LAYOUT;
  }
};

export const saveNegativeLabWorkspaceLayout = (layout: NegativeLabWorkspaceLayout): void => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(
    NEGATIVE_LAB_WORKSPACE_LAYOUT_STORAGE_KEY,
    JSON.stringify(parseNegativeLabWorkspaceLayout(layout)),
  );
};
