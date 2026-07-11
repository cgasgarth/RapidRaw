import { z } from 'zod';

const sha256Schema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const contentHashSchema = z.string().regex(/^(?:blake3|sha256):[0-9a-f]{64}$/u);

export const singleImageSwinIrCapabilityIdV1 = 'swinir_classical_x2_onnx_preview_v1' as const;
export const singleImageSwinIrSourceModeV1 = 'single_image_ai' as const;

export const singleImageSwinIrCapabilityV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    capabilityId: z.literal(singleImageSwinIrCapabilityIdV1),
    status: z.enum(['disabled', 'available']),
    build: z
      .object({
        featureName: z.literal('single-image-swinir-x2-preview'),
        featureEnabled: z.boolean(),
      })
      .strict(),
    sourceCode: z
      .object({
        repository: z.literal('JingyunLiang/SwinIR'),
        commit: z.literal('6545850fbf8df298df73d81f3e8cba638787c8bd'),
        licenseSpdx: z.literal('Apache-2.0'),
      })
      .strict(),
    checkpoint: z
      .object({
        filename: z.literal('001_classicalSR_DIV2K_s48w8_SwinIR-M_x2.pth'),
        redistributionStatus: z.enum(['unproven', 'approved']),
        licenseEvidence: z.string().trim().min(1).nullable(),
        sha256: sha256Schema.nullable(),
      })
      .strict(),
    onnxModel: z
      .object({
        artifactStatus: z.enum(['not_approved', 'approved']),
        bytes: z.number().int().positive().nullable(),
        downloadUrl: z.string().url().nullable(),
        format: z.literal('onnx'),
        inputName: z.literal('input'),
        opset: z.literal(17),
        outputName: z.literal('output'),
        scale: z.literal(2),
        sha256: sha256Schema.nullable(),
        windowSize: z.literal(8),
      })
      .strict(),
    contracts: z
      .object({
        baseline: z.literal('scene_linear_bicubic_mitchell_x2_v1'),
        blendOverlapLrPx: z.literal(64),
        contextHaloLrPx: z.literal(64),
        coreTileLrPx: z.literal(256),
        highlightGuardHighLinear: z.literal(1.25),
        highlightGuardLowLinear: z.literal(-0.02),
        modelInput: z.literal('encoded_srgb_nchw_f32_unit_v1'),
        publication: z.literal('temp_package_stale_check_atomic_rename_v1'),
        residual: z.literal('encoded_srgb_residual_scene_linear_guarded_v1'),
        review: z.literal('single_image_sr_manual_review_v1'),
        tiling: z.literal('swinir_x2_overlap_raised_cosine_row_major_v1'),
      })
      .strict(),
    blockCodes: z.array(z.string().trim().min(1)),
  })
  .strict()
  .superRefine((capability, context) => {
    const rightsApproved =
      capability.checkpoint.redistributionStatus === 'approved' &&
      capability.checkpoint.licenseEvidence !== null &&
      capability.checkpoint.sha256 !== null;
    const modelApproved =
      capability.onnxModel.artifactStatus === 'approved' &&
      capability.onnxModel.sha256 !== null &&
      capability.onnxModel.bytes !== null &&
      capability.onnxModel.downloadUrl !== null;

    if (capability.checkpoint.redistributionStatus === 'unproven') {
      if (capability.status !== 'disabled') {
        context.addIssue({ code: 'custom', message: 'unproven checkpoint rights must disable the capability' });
      }
      if (
        capability.checkpoint.sha256 !== null ||
        capability.onnxModel.sha256 !== null ||
        capability.onnxModel.downloadUrl !== null
      ) {
        context.addIssue({
          code: 'custom',
          message: 'an unproven checkpoint must not publish checkpoint/model hashes or a download URL',
        });
      }
    }

    if (capability.status === 'available') {
      if (!capability.build.featureEnabled || !rightsApproved || !modelApproved || capability.blockCodes.length > 0) {
        context.addIssue({ code: 'custom', message: 'available capability requires the build, rights, and model gates' });
      }
    }
  });

export const singleImageSwinIrPreviewPublicationV1Schema = z
  .object({
    artifactId: z.string().trim().min(1),
    height: z.number().int().positive(),
    modelSha256: sha256Schema,
    outputContentHash: contentHashSchema,
    planHash: contentHashSchema,
    previewDataUrl: z.string().startsWith('data:image/'),
    review: z
      .object({
        colorDeltaMean: z.number().nonnegative(),
        downscaleMae: z.number().nonnegative(),
        edgeRingingScore: z.number().nonnegative(),
        manualReviewRequired: z.literal(true),
        passedAutomaticChecks: z.boolean(),
        seamMaxAbs: z.number().nonnegative(),
      })
      .strict(),
    runtime: z.literal('onnxruntime'),
    sourceContentHash: contentHashSchema,
    sourceGraphRevision: z.string().trim().min(1),
    tileCount: z.number().int().positive(),
    tilePlanHash: contentHashSchema,
    width: z.number().int().positive(),
  })
  .strict();

export const singleImageSwinIrPreviewPlanV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    mode: z.literal(singleImageSwinIrSourceModeV1),
    status: z.enum(['capability_disabled', 'preview_ready', 'cancelled', 'stale', 'failed']),
    accepted: z.boolean(),
    blockCodes: z.array(z.string().trim().min(1)),
    capability: singleImageSwinIrCapabilityV1Schema,
    jobId: z.string().uuid().nullable(),
    probeOnly: z.boolean(),
    publication: singleImageSwinIrPreviewPublicationV1Schema.nullable(),
    sourceCount: z.number().int().nonnegative(),
    warningCodes: z.array(z.string().trim().min(1)),
  })
  .strict()
  .superRefine((plan, context) => {
    const isReady = plan.status === 'preview_ready';
    if (plan.accepted !== isReady) {
      context.addIssue({ code: 'custom', message: 'accepted must be true only for preview_ready' });
    }
    if (isReady !== (plan.publication !== null)) {
      context.addIssue({ code: 'custom', message: 'only preview_ready may publish a preview package' });
    }
    if (plan.capability.status === 'disabled') {
      if (plan.status !== 'capability_disabled' || plan.jobId !== null || plan.publication !== null) {
        context.addIssue({ code: 'custom', message: 'disabled capability must not start or publish a job' });
      }
    }
  });

export type SingleImageSwinIrCapabilityV1 = z.infer<typeof singleImageSwinIrCapabilityV1Schema>;
export type SingleImageSwinIrPreviewPlanV1 = z.infer<typeof singleImageSwinIrPreviewPlanV1Schema>;
export type SingleImageSwinIrPreviewPublicationV1 = z.infer<
  typeof singleImageSwinIrPreviewPublicationV1Schema
>;
