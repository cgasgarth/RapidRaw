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
const outputProfileSchema = z.enum(['display_p3', 'srgb']);
const renderingIntentSchema = z.enum(['perceptual', 'relative_colorimetric']);

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
        intent: renderingIntentSchema,
        outputProfile: outputProfileSchema,
        viewTransform: z.literal('rawengine_agx_v1'),
      })
      .strict(),
    sceneToDisplayTransform: z.literal('rawengine_agx_v1'),
    workingSpace: z.literal('acescg_linear_v1'),
  })
  .strict();

const colorManagementProofSchema = z
  .object({
    conformance: z.enum(['matched', 'partial', 'mismatch']),
    decoderTrace: z
      .object({
        cameraCalibration: z
          .object({
            applied: z.string().min(1),
            presence: z.string().min(1),
            source: z.string().min(1),
          })
          .strict(),
        cameraMake: z.string().trim().min(1),
        cameraModel: z.string().trim().min(1),
        decodedDimensions: z
          .object({ height: z.number().int().positive(), width: z.number().int().positive() })
          .strict(),
        privacySafeCameraId: z.string().trim().min(1),
        rawFormat: z.string().trim().min(1),
        sourceHash: sha256Schema,
        whiteBalance: z
          .object({
            applied: z.string().min(1),
            presence: z.string().min(1),
            source: z.string().min(1),
          })
          .strict(),
      })
      .strict(),
    doesNotProve: z
      .array(
        z.enum([
          'acescg_working_space',
          'bradford_chromatic_adaptation',
          'camera_profile_quality',
          'capture_one_class_quality',
          'display_device_visual_match',
          'gpu_color_parity',
          'icc_colorimetric_accuracy',
        ]),
      )
      .min(7),
    observedColorPipeline: z
      .object({
        bitDepth: z.literal(16),
        cmmUsed: z.literal(true),
        displayProfileCorrectness: z.enum(['active_display_lut_profile_loaded', 'not_proven']),
        exportColorEncoding: z.enum(['display_p3_rgb16_tiff', 'srgb_rgb16_tiff']),
        exportFormat: z.literal('tiff'),
        gamutMapping: z.enum(['not_proven', 'rawengine.gamut.srgb-oklab-chroma-reduce.v1']),
        iccProfileEmbedded: z.literal(true),
        inputDomain: z.literal('decoder_camera_rgb_observed'),
        operationDomain: z.literal('linear_srgb_d65_observed'),
        outputProfile: outputProfileSchema,
        renderingIntentApplied: z.literal(true),
        sceneToDisplayTransform: z.literal('rawengine_agx_v1'),
        transferStatus: z.string().trim().min(1),
        viewTransform: z.literal('rawengine_agx_v1'),
        workingBuffer: z.literal('linear_srgb_d65_observed'),
      })
      .strict(),
    proofLevel: z.literal('private_raw_runtime_color_management_metadata'),
    requestedColorPipeline: colorPipelineSchema,
    runtimeEnvironment: z
      .object({
        wgpuAdapter: z.string().min(1),
        wgpuBackend: z.string().min(1),
      })
      .strict(),
    trackingIssue: z.literal(2308),
    warnings: z.array(z.string().min(1)).min(1),
  })
  .strict()
  .superRefine((proof, context) => {
    const doesNotProve = new Set(proof.doesNotProve);
    for (const nonClaim of [
      'acescg_working_space',
      'bradford_chromatic_adaptation',
      'camera_profile_quality',
      'capture_one_class_quality',
      'display_device_visual_match',
      'gpu_color_parity',
      'icc_colorimetric_accuracy',
    ] as const) {
      if (!doesNotProve.has(nonClaim)) {
        context.addIssue({
          code: 'custom',
          message: `Color-management proof must explicitly avoid claiming ${nonClaim}.`,
          path: ['doesNotProve'],
        });
      }
    }
  });

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
        acceptedDryRunPlanHash: z.string().trim().min(1),
        acceptedDryRunPlanId: z.string().trim().min(1),
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

export const rawOpenEditExportAdjustHslCommandSchema = z
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
    commandType: z.literal('toneColor.adjustHsl'),
    correlationId: z.string().trim().min(1),
    dryRun: z.literal(false),
    expectedGraphRevision: z.string().regex(/^graph-rev\.[a-z0-9.-]+\.v[0-9]+$/u),
    idempotencyKey: z.string().trim().min(1).optional(),
    parameters: z
      .object({
        band: z.enum(['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta']),
        hueShiftDegrees: z.number().min(-180).max(180),
        luminance: z.number().min(-100).max(100),
        saturation: z.number().min(-100).max(100),
      })
      .strict(),
    schemaVersion: z.literal(1),
    target: targetJsonObjectSchema,
  })
  .strict();

export const rawOpenEditExportSkinToneUniformityCommandSchema = z
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
    commandType: z.literal('toneColor.adjustSkinToneUniformity'),
    correlationId: z.string().trim().min(1),
    dryRun: z.literal(false),
    expectedGraphRevision: z.string().regex(/^graph-rev\.[a-z0-9.-]+\.v[0-9]+$/u),
    idempotencyKey: z.string().trim().min(1).optional(),
    parameters: z
      .object({
        hueUniformity: z.number().min(0).max(1),
        luminanceUniformity: z.number().min(0).max(1),
        maxHueShiftDegrees: z.number().min(0).max(30),
        saturationUniformity: z.number().min(0).max(1),
        targetHueDegrees: z.number().min(0).lt(360),
        targetLuminance: z.number().min(0).max(1),
        targetSaturation: z.number().min(0).max(1),
      })
      .strict(),
    schemaVersion: z.literal(1),
    target: targetJsonObjectSchema,
  })
  .strict();

export const rawOpenEditExportCommandSchema = z.discriminatedUnion('commandType', [
  rawOpenEditExportBasicToneCommandSchema,
  rawOpenEditExportAdjustHslCommandSchema,
  rawOpenEditExportSkinToneUniformityCommandSchema,
]);

export const rawOpenEditExportProofRequestSchema = z
  .object({
    $schema: z.url().optional(),
    artifactDirRelative: privatePathSchema,
    editCommand: rawOpenEditExportCommandSchema,
    fixtureId: z.string().regex(/^validation\.raw-open-edit-export\.[a-z0-9.-]+\.v[0-9]+$/u),
    privateRootPath: z.string().trim().min(1),
    sourceMetadata: z
      .object({
        cameraMake: z.string().trim().min(1),
        cameraModel: z.string().trim().min(1),
        privacySafeCameraId: z.string().trim().min(1),
        rawFormat: z.string().trim().min(1),
      })
      .strict(),
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
            'finalFileBlackPointCompensationApplied',
            'previewExportMeanAbsDelta',
            'finalFileBitDepth',
            'finalFileColorEngineLcms2',
            'finalFileIccProfileEmbedded',
            'finalFileReopenSucceeded',
            'finalFileSoftProofRgb8MaxAbsDelta',
            'finalFileSoftProofRgb8MeanAbsDelta',
            'finalFileTransformApplied',
            'softProofExportRgb8MeanAbsDelta',
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
