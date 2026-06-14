import { z } from 'zod';

export const referenceImageModeSchema = z.enum(['side_by_side', 'overlay', 'split_view']);
export const referenceImagePlacementSchema = z.enum(['left', 'right', 'top', 'bottom', 'floating']);
export const referenceImageColorIntentSchema = z.enum(['match_display', 'preserve_reference', 'proof_output']);

export const referenceImageSchema = z
  .object({
    colorIntent: referenceImageColorIntentSchema,
    id: z.string().trim().min(1),
    label: z.string().trim().min(1),
    path: z.string().trim().min(1),
    pinned: z.boolean(),
    sourceProfile: z.string().trim().min(1).nullable(),
  })
  .strict();

export const referenceImageWorkspaceSchema = z
  .object({
    activeReferenceId: z.string().trim().min(1).nullable(),
    createdAt: z.iso.datetime(),
    id: z.string().trim().min(1),
    mode: referenceImageModeSchema,
    opacity: z.number().min(0).max(1),
    placement: referenceImagePlacementSchema,
    references: z.array(referenceImageSchema).min(1).max(12),
    targetImagePath: z.string().trim().min(1),
    updatedAt: z.iso.datetime(),
    version: z.literal(1),
    zoomLinked: z.boolean(),
  })
  .strict()
  .superRefine((workspace, context) => {
    if (Date.parse(workspace.updatedAt) < Date.parse(workspace.createdAt)) {
      context.addIssue({ code: 'custom', message: 'updatedAt must be at or after createdAt.', path: ['updatedAt'] });
    }

    const ids = new Set<string>();
    for (const [index, reference] of workspace.references.entries()) {
      if (ids.has(reference.id)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate reference image id: ${reference.id}`,
          path: ['references', index, 'id'],
        });
      }
      ids.add(reference.id);
    }

    if (workspace.activeReferenceId !== null && !ids.has(workspace.activeReferenceId)) {
      context.addIssue({
        code: 'custom',
        message: 'activeReferenceId must reference a configured reference image.',
        path: ['activeReferenceId'],
      });
    }

    if (workspace.mode === 'overlay' && workspace.opacity === 0) {
      context.addIssue({ code: 'custom', message: 'Overlay mode requires visible opacity.', path: ['opacity'] });
    }
  });

export type ReferenceImageWorkspace = z.infer<typeof referenceImageWorkspaceSchema>;

export const activeReferenceImage = (workspace: ReferenceImageWorkspace) =>
  workspace.references.find((reference) => reference.id === workspace.activeReferenceId) ?? workspace.references[0];

export const referenceWorkspaceSummary = (workspace: ReferenceImageWorkspace): string => {
  const reference = activeReferenceImage(workspace);
  return `${workspace.mode}:${workspace.placement}:${reference?.id ?? 'none'}:${workspace.references.length}`;
};

export const parseReferenceImageWorkspace = (value: unknown): ReferenceImageWorkspace =>
  referenceImageWorkspaceSchema.parse(value);
