import { z } from 'zod';

import { jsonValueSchema } from './aiMaskingSchemas';

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const privatePathSchema = z
  .string()
  .trim()
  .regex(/^(private-fixtures|private-artifacts)\//u);

const hashedPathSchema = z
  .object({
    hash: sha256Schema,
    path: privatePathSchema,
    publicRepoAllowed: z.literal(false),
  })
  .strict();

const artifactKindSchema = z.enum([
  'source_raw_private',
  'preview_before_private',
  'preview_after_private',
  'export_after_private',
  'sidecar_after_private',
  'workflow_report_private',
]);

const jsonObjectSchema = z.record(z.string(), jsonValueSchema);
const targetJsonObjectSchema = z.object({ kind: z.enum(['image', 'virtual_copy']) }).catchall(jsonValueSchema);

export const rawOpenEditExportBasicToneCommandSchema = z
  .object({
    actor: jsonObjectSchema,
    approval: z
      .object({
        approvalClass: z.literal('edit_apply'),
        reason: z.string().trim().min(1),
        state: z.literal('approved'),
      })
      .strict(),
    colorPipeline: jsonObjectSchema,
    commandId: z.string().trim().min(1),
    commandType: z.literal('toneColor.setBasicTone'),
    correlationId: z.string().trim().min(1),
    dryRun: z.literal(false),
    expectedGraphRevision: z.string().regex(/^graph-rev\.[a-z0-9.-]+\.v[0-9]+$/u),
    idempotencyKey: z.string().trim().min(1).optional(),
    parameters: z
      .object({
        blackPoint: z.number().min(-100).max(100),
        clarity: z.number().min(-100).max(100),
        contrast: z.number().min(-100).max(100),
        exposureEv: z.number().min(-10).max(10),
        highlights: z.number().min(-100).max(100),
        saturation: z.number().min(-100).max(100),
        shadows: z.number().min(-100).max(100),
        whitePoint: z.number().min(-100).max(100),
      })
      .strict(),
    schemaVersion: z.literal(1),
    target: targetJsonObjectSchema,
  })
  .strict();

export const rawOpenEditExportProofRequestSchema = z
  .object({
    $schema: z.url().optional(),
    artifactDirRelative: privatePathSchema,
    editCommand: rawOpenEditExportBasicToneCommandSchema,
    fixtureId: z.string().regex(/^validation\.raw-open-edit-export\.[a-z0-9.-]+\.v[0-9]+$/u),
    privateRootPath: z.string().trim().min(1),
    sourceRelativePath: privatePathSchema,
  })
  .strict();

export const rawOpenEditExportProofReportSchema = z
  .object({
    artifacts: z
      .array(
        hashedPathSchema
          .extend({
            kind: artifactKindSchema,
          })
          .strict(),
      )
      .min(6),
    editCommandId: z.string().trim().min(1),
    editGraphRevision: z.string().regex(/^graph-rev\.[a-z0-9.-]+\.v[0-9]+$/u),
    fixtureId: z.string().regex(/^validation\.raw-open-edit-export\.[a-z0-9.-]+\.v[0-9]+$/u),
    generatedAt: z.iso.datetime(),
    metrics: z.array(
      z
        .object({
          name: z.enum([
            'changedPixelRatio',
            'previewExportMeanAbsDelta',
            'sidecarReloadRevisionMatch',
            'sourceHashUnchanged',
          ]),
          passed: z.boolean(),
          source: z.literal('private_raw_report'),
          threshold: z.number().min(0),
          value: z.number().min(0),
        })
        .strict(),
    ),
    previewAfter: hashedPathSchema,
    previewBefore: hashedPathSchema,
    reportId: z.string().regex(/^raw-open-edit-export-run\.[a-z0-9.-]+\.v[0-9]+$/u),
    sidecarAfter: hashedPathSchema,
    sourceRaw: hashedPathSchema,
    trackingIssue: z.literal(1376),
  })
  .strict();

export type RawOpenEditExportProofRequest = z.infer<typeof rawOpenEditExportProofRequestSchema>;
export type RawOpenEditExportProofReport = z.infer<typeof rawOpenEditExportProofReportSchema>;
