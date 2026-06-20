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

const whitePointSchema = z
  .object({
    x: z.number().positive(),
    y: z.number().positive(),
  })
  .strict();

const colorPipelineSchema = z
  .object({
    chromaticAdaptation: z
      .object({
        method: z.literal('bradford_v1'),
        sourceWhitePoint: whitePointSchema,
        status: z.literal('math_validated'),
        targetWhitePoint: whitePointSchema,
        warnings: z.array(z.string()),
      })
      .strict(),
    inputDomain: z.literal('camera_linear_rgb'),
    operationDomain: z.literal('acescg_linear_v1'),
    renderTarget: z
      .object({
        bitDepth: z.literal(16),
        embedIcc: z.literal(true),
        intent: z.literal('relative_colorimetric'),
        outputProfile: z.literal('display_p3'),
        viewTransform: z.literal('rawengine_agx_v1'),
      })
      .strict(),
    sceneToDisplayTransform: z.literal('rawengine_agx_v1'),
    workingSpace: z.literal('acescg_linear_v1'),
  })
  .strict();

const colorManagementProofSchema = z
  .object({
    chromaticAdaptation: colorPipelineSchema.shape.chromaticAdaptation.omit({ warnings: true }),
    displayTransform: z
      .object({
        bitDepth: z.literal(16),
        embedIcc: z.literal(true),
        intent: z.literal('relative_colorimetric'),
        outputProfile: z.literal('display_p3'),
        sceneToDisplayTransform: z.literal('rawengine_agx_v1'),
        viewTransform: z.literal('rawengine_agx_v1'),
      })
      .strict(),
    doesNotProve: z
      .array(
        z.enum([
          'camera_profile_quality',
          'capture_one_class_quality',
          'display_device_visual_match',
          'gpu_color_parity',
          'icc_colorimetric_accuracy',
        ]),
      )
      .min(5),
    inputDomain: z.literal('camera_linear_rgb'),
    operationDomain: z.literal('acescg_linear_v1'),
    proofLevel: z.literal('private_raw_runtime_color_management_metadata'),
    trackingIssue: z.literal(2308),
    workingSpace: z.literal('acescg_linear_v1'),
  })
  .strict();

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
    colorPipeline: colorPipelineSchema,
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
    colorManagement: colorManagementProofSchema,
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
