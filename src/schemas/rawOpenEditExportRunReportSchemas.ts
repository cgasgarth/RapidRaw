import { z } from 'zod';

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
  'soft_proof_after_private',
  'sidecar_after_private',
  'workflow_report_private',
]);

const metricNameSchema = z.enum([
  'changedPixelRatio',
  'finalFileBlackPointCompensationApplied',
  'finalFileBitDepth',
  'finalFileColorEngineLcms2',
  'finalFileIccProfileEmbedded',
  'finalFileReopenSucceeded',
  'finalFileSoftProofRgb8MaxAbsDelta',
  'finalFileSoftProofRgb8MeanAbsDelta',
  'finalFileTransformApplied',
  'previewExportMeanAbsDelta',
  'softProofExportRgb8MeanAbsDelta',
  'sidecarReloadRevisionMatch',
  'sourceHashUnchanged',
]);

const whitePointSchema = z
  .object({
    x: z.number().positive(),
    y: z.number().positive(),
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
        displayProfileCorrectness: z.literal('not_proven'),
        exportColorEncoding: z.literal('display_p3_rgb16_tiff'),
        exportFormat: z.literal('tiff'),
        gamutMapping: z.literal('not_proven'),
        iccProfileEmbedded: z.literal(true),
        inputDomain: z.literal('decoder_camera_rgb_observed'),
        operationDomain: z.literal('linear_srgb_d65_observed'),
        outputProfile: z.literal('display_p3'),
        renderingIntentApplied: z.literal(true),
        sceneToDisplayTransform: z.literal('rawengine_agx_v1'),
        transferStatus: z.literal('lcms2_bpc_rgb16_display_p3_final_file'),
        viewTransform: z.literal('rawengine_agx_v1'),
        workingBuffer: z.literal('linear_srgb_d65_observed'),
      })
      .strict(),
    proofLevel: z.literal('private_raw_runtime_color_management_metadata'),
    requestedColorPipeline: z
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
      .strict(),
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

const runArtifactSchema = hashedPathSchema.extend({
  kind: artifactKindSchema,
});

const qualityMetricSchema = z
  .object({
    name: metricNameSchema,
    passed: z.literal(true),
    source: z.literal('private_raw_report'),
    threshold: z.number().min(0),
    value: z.number().min(0),
  })
  .strict();

const renderPathsSchema = z
  .object({
    exportAfterFormat: z.literal('tiff'),
    exportAfterWriterId: z.string().trim().min(1),
    previewAfterFormat: z.literal('png'),
    previewAfterWriterId: z.string().trim().min(1),
    previewBeforeWriterId: z.string().trim().min(1),
    softProofAfterFormat: z.literal('png'),
    softProofAfterWriterId: z.string().trim().min(1),
  })
  .strict();

const finalFileProofSchema = z
  .object({
    bitDepth: z.literal(16),
    blackPointCompensation: z.literal('Enabled via LittleCMS relative colorimetric transform'),
    cmm: z.literal('lcms2'),
    embeddedIccProfileHash: sha256Schema,
    expectedOutputProfileHash: sha256Schema,
    finalFileFormat: z.literal('tiff'),
    outputProfile: z.literal('display_p3'),
    pixelMaxAbsDelta: z.number().min(0),
    pixelMeanAbsDelta: z.number().min(0),
    reopenedDimensions: z.object({ height: z.number().int().positive(), width: z.number().int().positive() }).strict(),
    transformApplied: z.literal(true),
    transformPolicyFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    writerId: z.literal('export_processing::save_image_with_metadata'),
  })
  .strict();

const privateRunReportSchema = z
  .object({
    artifacts: z.array(runArtifactSchema).min(6),
    colorManagement: colorManagementProofSchema,
    editCommandId: z.string().trim().min(1),
    editGraphRevision: z.string().regex(/^graph-rev\.[a-z0-9.-]+\.v[0-9]+$/u),
    finalFile: finalFileProofSchema,
    fixtureId: z.string().regex(/^validation\.raw-open-edit-export\.[a-z0-9.-]+\.v[0-9]+$/u),
    generatedAt: z.iso.datetime(),
    metrics: z.array(qualityMetricSchema).min(4),
    previewAfter: hashedPathSchema,
    previewBefore: hashedPathSchema,
    renderPaths: renderPathsSchema.optional(),
    reportId: z.string().regex(/^raw-open-edit-export-run\.[a-z0-9.-]+\.v[0-9]+$/u),
    sidecarAfter: hashedPathSchema,
    sourceRaw: hashedPathSchema,
    trackingIssue: z.literal(1376),
  })
  .strict()
  .superRefine((report, context) => {
    const artifactKinds = report.artifacts.map((artifact) => artifact.kind);
    if (new Set(artifactKinds).size !== artifactKinds.length) {
      context.addIssue({
        code: 'custom',
        message: 'RAW open/edit/export run artifact kinds must be unique.',
        path: ['artifacts'],
      });
    }

    const metricNames = report.metrics.map((metric) => metric.name);
    if (new Set(metricNames).size !== metricNames.length) {
      context.addIssue({
        code: 'custom',
        message: 'RAW open/edit/export run metrics must be unique.',
        path: ['metrics'],
      });
    }

    for (const requiredMetric of metricNameSchema.options) {
      if (!metricNames.includes(requiredMetric)) {
        context.addIssue({
          code: 'custom',
          message: `RAW open/edit/export run report requires ${requiredMetric}.`,
          path: ['metrics'],
        });
      }
    }
  });

export const rawOpenEditExportRunReportCollectionSchema = z
  .object({
    $schema: z.url(),
    issue: z.literal(1829),
    reports: z.array(privateRunReportSchema),
    schemaVersion: z.literal(1),
    snapshotDate: z.iso.date(),
    validationMode: z.literal('public_schema_private_reports'),
  })
  .strict()
  .superRefine((collection, context) => {
    const reportIds = collection.reports.map((report) => report.reportId);
    if (new Set(reportIds).size !== reportIds.length) {
      context.addIssue({
        code: 'custom',
        message: 'RAW open/edit/export run report IDs must be unique.',
        path: ['reports'],
      });
    }

    const fixtureIds = collection.reports.map((report) => report.fixtureId);
    if (new Set(fixtureIds).size !== fixtureIds.length) {
      context.addIssue({
        code: 'custom',
        message: 'Only one RAW open/edit/export run report is allowed per fixture.',
        path: ['reports'],
      });
    }
  });

export type RawOpenEditExportRunReportCollection = z.infer<typeof rawOpenEditExportRunReportCollectionSchema>;

export function parseRawOpenEditExportRunReportCollection(value: unknown): RawOpenEditExportRunReportCollection {
  return rawOpenEditExportRunReportCollectionSchema.parse(value);
}
