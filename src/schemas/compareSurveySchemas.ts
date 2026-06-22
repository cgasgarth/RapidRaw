import { z } from 'zod';

import { uniqueStringArraySchema } from './zodUniqueHelpers';

export const compareSurveyModeSchema = z.enum(['compare', 'survey']);
export const compareSurveySortKeySchema = z.enum(['selection_order', 'rating', 'capture_time', 'file_name']);
export const compareSurveySortOrderSchema = z.enum(['asc', 'desc']);

export const compareSurveyCandidateSchema = z
  .object({
    capturedAt: z.iso.datetime().nullable(),
    colorLabel: z.string().trim().min(1).nullable(),
    edited: z.boolean(),
    path: z.string().trim().min(1),
    rating: z.number().int().min(0).max(5),
    rejected: z.boolean(),
    virtualCopyId: z
      .string()
      .regex(/^[a-f0-9]{6}$/)
      .nullable(),
  })
  .strict();

export const compareSurveySessionSchema = z
  .object({
    activePath: z.string().trim().min(1),
    candidatePaths: uniqueStringArraySchema('candidatePaths', { duplicateLabel: 'paths' }).min(2).max(32),
    candidates: z.array(compareSurveyCandidateSchema).min(2).max(32),
    compareReferencePath: z.string().trim().min(1).nullable(),
    createdAt: z.iso.datetime(),
    id: z.string().trim().min(1),
    mode: compareSurveyModeSchema,
    showMetadataOverlays: z.boolean(),
    sort: z
      .object({
        key: compareSurveySortKeySchema,
        order: compareSurveySortOrderSchema,
      })
      .strict(),
    updatedAt: z.iso.datetime(),
    version: z.literal(1),
    zoomLinked: z.boolean(),
  })
  .strict()
  .superRefine((session, context) => {
    if (Date.parse(session.updatedAt) < Date.parse(session.createdAt)) {
      context.addIssue({ code: 'custom', message: 'updatedAt must be at or after createdAt.', path: ['updatedAt'] });
    }

    const candidatePaths = new Set(session.candidatePaths);
    const candidateModelPaths = new Set(session.candidates.map((candidate) => candidate.path));
    for (const path of candidatePaths) {
      if (!candidateModelPaths.has(path)) {
        context.addIssue({
          code: 'custom',
          message: `candidatePaths entry missing candidate metadata: ${path}`,
          path: ['candidates'],
        });
      }
    }
    if (!candidatePaths.has(session.activePath)) {
      context.addIssue({ code: 'custom', message: 'activePath must be in candidatePaths.', path: ['activePath'] });
    }
    if (session.compareReferencePath !== null && !candidatePaths.has(session.compareReferencePath)) {
      context.addIssue({
        code: 'custom',
        message: 'compareReferencePath must be in candidatePaths.',
        path: ['compareReferencePath'],
      });
    }
    if (session.mode === 'compare' && session.compareReferencePath === null) {
      context.addIssue({
        code: 'custom',
        message: 'Compare mode requires compareReferencePath.',
        path: ['compareReferencePath'],
      });
    }
  });

export type CompareSurveyCandidate = z.infer<typeof compareSurveyCandidateSchema>;
export type CompareSurveySession = z.infer<typeof compareSurveySessionSchema>;

export const compareSurveyPickExportHandoffSchema = z
  .object({
    editGraphRevision: z.string().trim().min(1),
    editorOpenedPath: z.string().trim().min(1),
    exportEditGraphRevision: z.string().trim().min(1),
    exportJobId: z.string().trim().min(1),
    exportRecipeId: z.string().trim().min(1),
    exportStatus: z.literal('queued'),
    pickedPath: z.string().trim().min(1),
    selectionContext: z.literal('compare_survey_pick'),
    sessionId: z.string().trim().min(1),
    sourceMode: z.literal('survey'),
    version: z.literal(1),
  })
  .strict()
  .superRefine((handoff, context) => {
    if (handoff.editorOpenedPath !== handoff.pickedPath) {
      context.addIssue({
        code: 'custom',
        message: 'Editor handoff path must match the picked survey path.',
        path: ['editorOpenedPath'],
      });
    }

    if (handoff.exportEditGraphRevision !== handoff.editGraphRevision) {
      context.addIssue({
        code: 'custom',
        message: 'Export job must preserve the editor edit graph revision.',
        path: ['exportEditGraphRevision'],
      });
    }
  });

export type CompareSurveyPickExportHandoff = z.infer<typeof compareSurveyPickExportHandoffSchema>;

export const visibleCompareSurveyCandidates = (session: CompareSurveySession): CompareSurveyCandidate[] => {
  const byPath = new Map(session.candidates.map((candidate) => [candidate.path, candidate]));
  const candidates = session.candidatePaths
    .map((path) => byPath.get(path))
    .filter((candidate) => candidate !== undefined);
  const sortedCandidates = [...candidates].sort((left, right) => {
    const direction = session.sort.order === 'asc' ? 1 : -1;
    switch (session.sort.key) {
      case 'capture_time':
        return direction * ((Date.parse(left.capturedAt ?? '') || 0) - (Date.parse(right.capturedAt ?? '') || 0));
      case 'file_name':
        return direction * left.path.localeCompare(right.path);
      case 'rating':
        return direction * (left.rating - right.rating);
      case 'selection_order':
        return 0;
    }
  });
  return sortedCandidates.filter((candidate) => !candidate.rejected);
};

export const parseCompareSurveySession = (value: unknown): CompareSurveySession =>
  compareSurveySessionSchema.parse(value);

export const parseCompareSurveyPickExportHandoff = (value: unknown): CompareSurveyPickExportHandoff =>
  compareSurveyPickExportHandoffSchema.parse(value);
