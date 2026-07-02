import { z } from 'zod';

import { uniqueStringArraySchema } from './zodUniqueHelpers';

export const workspaceSurfaceSchema = z.enum(['library', 'editor', 'negative_lab', 'merge', 'export']);
export const workspaceDensitySchema = z.enum(['compact', 'comfortable', 'dense']);
export const workspacePanelIdSchema = z.enum([
  'adjustments',
  'agent',
  'ai',
  'crop',
  'export',
  'library',
  'metadata',
  'masks',
  'presets',
]);
export const workspacePanelDockSchema = z.enum(['left', 'right', 'bottom', 'hidden']);

export const workspacePanelLayoutSchema = z
  .object({
    collapsed: z.boolean(),
    dock: workspacePanelDockSchema,
    id: workspacePanelIdSchema,
    order: z.number().int().min(0),
    widthPx: z.number().int().min(220).max(720).nullable(),
  })
  .strict()
  .superRefine((panel, context) => {
    if (panel.dock === 'hidden' && panel.widthPx !== null) {
      context.addIssue({ code: 'custom', message: 'Hidden panels must not reserve width.', path: ['widthPx'] });
    }
    if ((panel.dock === 'left' || panel.dock === 'right') && panel.widthPx === null) {
      context.addIssue({ code: 'custom', message: 'Docked side panels require widthPx.', path: ['widthPx'] });
    }
  });

export const workspaceLayoutSchema = z
  .object({
    activePanelId: workspacePanelIdSchema.nullable(),
    createdAt: z.iso.datetime(),
    density: workspaceDensitySchema,
    hiddenAdjustmentSections: uniqueStringArraySchema('hiddenAdjustmentSections'),
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
    panels: z.array(workspacePanelLayoutSchema).min(1),
    primarySurface: workspaceSurfaceSchema,
    shortcutScope: z.enum(['global', 'surface']),
    updatedAt: z.iso.datetime(),
    version: z.literal(1),
  })
  .strict()
  .superRefine((layout, context) => {
    if (Date.parse(layout.updatedAt) < Date.parse(layout.createdAt)) {
      context.addIssue({ code: 'custom', message: 'updatedAt must be at or after createdAt.', path: ['updatedAt'] });
    }

    const panelIds = new Set<string>();
    const ordersByDock = new Map<string, Set<number>>();
    for (const [index, panel] of layout.panels.entries()) {
      if (panelIds.has(panel.id)) {
        context.addIssue({ code: 'custom', message: `Duplicate panel id: ${panel.id}`, path: ['panels', index, 'id'] });
      }
      panelIds.add(panel.id);

      const orders = ordersByDock.get(panel.dock) ?? new Set<number>();
      if (orders.has(panel.order)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate panel order ${panel.order} in ${panel.dock} dock.`,
          path: ['panels', index, 'order'],
        });
      }
      orders.add(panel.order);
      ordersByDock.set(panel.dock, orders);
    }

    if (layout.activePanelId !== null && !panelIds.has(layout.activePanelId)) {
      context.addIssue({
        code: 'custom',
        message: 'activePanelId must reference a configured panel.',
        path: ['activePanelId'],
      });
    }
  });

export const workspaceLayoutCatalogSchema = z
  .object({
    activeLayoutId: z.string().trim().min(1).nullable(),
    layouts: z.array(workspaceLayoutSchema),
  })
  .strict()
  .superRefine((catalog, context) => {
    const ids = new Set<string>();
    for (const [index, layout] of catalog.layouts.entries()) {
      if (ids.has(layout.id)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate workspace layout id: ${layout.id}`,
          path: ['layouts', index, 'id'],
        });
      }
      ids.add(layout.id);
    }
    if (catalog.activeLayoutId !== null && !ids.has(catalog.activeLayoutId)) {
      context.addIssue({
        code: 'custom',
        message: 'activeLayoutId must reference a layout.',
        path: ['activeLayoutId'],
      });
    }
  });

export type WorkspaceLayout = z.infer<typeof workspaceLayoutSchema>;
export type WorkspaceLayoutCatalog = z.infer<typeof workspaceLayoutCatalogSchema>;

export const visiblePanelsForLayout = (layout: WorkspaceLayout) =>
  layout.panels
    .filter((panel) => panel.dock !== 'hidden')
    .sort((left, right) => left.dock.localeCompare(right.dock) || left.order - right.order);

export const parseWorkspaceLayoutCatalog = (value: unknown): WorkspaceLayoutCatalog =>
  workspaceLayoutCatalogSchema.parse(value);
