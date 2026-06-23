import { z } from 'zod';

export const xmpMetadataConflictChoiceSchema = z.enum(['local', 'external', 'merge']);

export const xmpMetadataConflictFieldSchema = z.object({
  field: z.enum(['rating', 'colorLabel', 'keywords']),
  label: z.string(),
  local: z.unknown(),
  external: z.unknown(),
  merged: z.unknown().optional(),
});

export const xmpMetadataConflictReportSchema = z.object({
  path: z.string(),
  xmpPath: z.string(),
  fields: z.array(xmpMetadataConflictFieldSchema),
});

export const xmpMetadataConflictDecisionSchema = z.object({
  field: xmpMetadataConflictFieldSchema.shape.field,
  choice: xmpMetadataConflictChoiceSchema,
});

export const xmpMetadataConflictReceiptSchema = z.object({
  id: z.string(),
  resolvedAt: z.string(),
  xmpPath: z.string(),
  decisions: z.array(xmpMetadataConflictDecisionSchema),
});

export type XmpMetadataConflictChoice = z.infer<typeof xmpMetadataConflictChoiceSchema>;
export type XmpMetadataConflictDecision = z.infer<typeof xmpMetadataConflictDecisionSchema>;
export type XmpMetadataConflictField = z.infer<typeof xmpMetadataConflictFieldSchema>;
export type XmpMetadataConflictReport = z.infer<typeof xmpMetadataConflictReportSchema>;
