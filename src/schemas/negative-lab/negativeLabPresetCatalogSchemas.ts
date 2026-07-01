import { z } from 'zod';

export const negativeLabPresetIdSchema = z.string().regex(/^negative_lab\.generic\.(?:c41|bw)\.[a-z0-9_]+\.v[0-9]+$/u);

export const negativeLabUiPresetFilmClassSchema = z.enum(['color_negative', 'black_and_white_silver']);
export const negativeLabUiPresetProcessFamilySchema = z.enum(['c41_color_negative', 'black_and_white_silver_negative']);
export const negativeLabUiPresetProfileStatusSchema = z.enum(['generic_unmeasured', 'fixture_measured']);
export const negativeLabUiPresetRuntimeStatusSchema = z.enum(['ui_catalog_only', 'runtime_parameter_applied']);
export const negativeLabUiPresetClaimLevelSchema = z.enum(['generic_starting_point_only', 'measured_profile']);
export const negativeLabUiPresetMeasurementSourceSchema = z.enum([
  'generic_engineered_starting_point',
  'fixture_measured_profile',
]);
export const negativeLabUiPresetClaimPolicySchema = z.enum([
  'generic_starting_point_no_stock_claim',
  'measured_profile_required_before_stock_claim',
]);

export const negativeLabBaseFogSampleRectSchema = z
  .object({
    height: z.number().min(0.02).max(1),
    width: z.number().min(0.02).max(1),
    x: z.number().min(0).max(0.98),
    y: z.number().min(0).max(0.98),
  })
  .strict()
  .refine((rect) => rect.x + rect.width <= 1.000001 && rect.y + rect.height <= 1.000001, {
    message: 'Negative Lab base/fog sample rect must stay within normalized image bounds.',
  });

export const negativeLabDensityPrintAlgorithmSchema = z.enum(['density_rgb_v1', 'negative_density_print_v2']);
export const negativeLabDensityPrintOutputTagSchema = z.enum(['preview_display', 'export_linear']);

export const negativeLabDensityPrintV2ParamsSchema = z
  .object({
    contrast_grade: z.number().min(0.5).max(2).default(1),
    density_offset: z.number().min(-0.5).max(0.5).default(0),
    midtone_shape: z.number().min(-1).max(1).default(0),
    schema_version: z.literal(1).default(1),
    shoulder_strength: z.number().min(0).max(1).default(0.25),
    target_black_density: z.number().min(1.1).max(2.4).default(1.65),
    target_white_density: z.number().min(0).max(0.25).default(0.04),
    toe_strength: z.number().min(0).max(1).default(0.25),
  })
  .strict()
  .superRefine((params, context) => {
    if (params.target_black_density - params.target_white_density < 0.8) {
      context.addIssue({
        code: 'custom',
        message: 'Negative Lab v2 black target density must stay meaningfully above white target density.',
        path: ['target_black_density'],
      });
    }
  });

export const negativeLabPresetParamsSchema = z
  .object({
    black_point: z.number().min(0).max(0.95).default(0),
    blue_weight: z.number().min(0.5).max(2),
    base_fog_strength: z.number().min(0).max(1.25).default(1),
    base_fog_sample: negativeLabBaseFogSampleRectSchema.nullable().default(null),
    contrast: z.number().min(0.5).max(2.5),
    exposure: z.number().min(-2).max(2),
    green_weight: z.number().min(0.5).max(2),
    print_curve_algorithm: negativeLabDensityPrintAlgorithmSchema.default('density_rgb_v1'),
    print_curve_output_tag: negativeLabDensityPrintOutputTagSchema.default('preview_display'),
    print_curve_v2: negativeLabDensityPrintV2ParamsSchema.nullable().default(null),
    red_weight: z.number().min(0.5).max(2),
    white_point: z.number().min(0.05).max(1).default(1),
  })
  .strict()
  .superRefine((params, context) => {
    if (params.white_point - params.black_point < 0.05) {
      context.addIssue({
        code: 'custom',
        message: 'Negative Lab white point must stay at least 0.05 above black point.',
        path: ['white_point'],
      });
    }

    if (params.print_curve_algorithm === 'negative_density_print_v2' && params.print_curve_v2 === null) {
      context.addIssue({
        code: 'custom',
        message: 'Negative Lab density print v2 requires versioned v2 print curve params.',
        path: ['print_curve_v2'],
      });
    }

    if (params.print_curve_algorithm === 'density_rgb_v1' && params.print_curve_v2 !== null) {
      context.addIssue({
        code: 'custom',
        message: 'Negative Lab density_rgb_v1 params must not carry v2 print curve params.',
        path: ['print_curve_v2'],
      });
    }
  });

export const negativeLabBuiltInUiPresetSchema = z
  .object({
    claimLevel: negativeLabUiPresetClaimLevelSchema,
    claimPolicy: negativeLabUiPresetClaimPolicySchema,
    colorResponseNotes: z.string().trim().min(1).max(180),
    contrastCurveDescriptor: z.string().trim().min(1).max(120),
    displayName: z.string().trim().min(1).max(80),
    filmClass: negativeLabUiPresetFilmClassSchema,
    grainModelDescriptor: z.string().trim().min(1).max(120),
    intent: z.string().trim().min(1).max(160),
    legalNote: z.string().trim().min(1).max(180),
    measurementProfileId: z.string().trim().min(1).nullable(),
    measurementSource: negativeLabUiPresetMeasurementSourceSchema,
    nominalSpeedClass: z.string().trim().min(1).max(80),
    params: negativeLabPresetParamsSchema,
    presetId: negativeLabPresetIdSchema,
    profileStatus: negativeLabUiPresetProfileStatusSchema,
    processFamily: negativeLabUiPresetProcessFamilySchema,
    processHint: z.string().trim().min(1).max(80),
    provenanceSummary: z.string().trim().min(1).max(180),
    runtimeStatus: negativeLabUiPresetRuntimeStatusSchema,
    stockFamilyDescriptor: z.string().trim().min(1).max(80),
  })
  .strict()
  .superRefine((preset, context) => {
    if (preset.profileStatus === 'generic_unmeasured' && preset.measurementProfileId !== null) {
      context.addIssue({
        code: 'custom',
        message: 'Generic unmeasured Negative Lab presets must not reference a measurement profile.',
        path: ['measurementProfileId'],
      });
    }

    if (
      preset.profileStatus === 'generic_unmeasured' &&
      (preset.claimLevel !== 'generic_starting_point_only' ||
        preset.measurementSource !== 'generic_engineered_starting_point')
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Generic unmeasured Negative Lab presets must use generic claim and measurement metadata.',
        path: ['claimLevel'],
      });
    }

    if (preset.profileStatus === 'fixture_measured' && preset.measurementProfileId === null) {
      context.addIssue({
        code: 'custom',
        message: 'Fixture-measured Negative Lab presets must reference a measurement profile.',
        path: ['measurementProfileId'],
      });
    }

    if (
      preset.profileStatus === 'fixture_measured' &&
      (preset.claimLevel !== 'measured_profile' || preset.measurementSource !== 'fixture_measured_profile')
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Fixture-measured Negative Lab presets must use measured-profile claim and source metadata.',
        path: ['claimLevel'],
      });
    }
  });

export const negativeLabBuiltInUiPresetCatalogSchema = z
  .object({
    defaultPresetId: negativeLabPresetIdSchema,
    presets: z.array(negativeLabBuiltInUiPresetSchema).min(1),
    version: z.literal(1),
  })
  .strict()
  .superRefine((catalog, context) => {
    const presetIds = new Set<string>();
    const displayNames = new Set<string>();

    for (const [index, preset] of catalog.presets.entries()) {
      if (presetIds.has(preset.presetId)) {
        context.addIssue({ code: 'custom', message: 'Duplicate Negative Lab preset id.', path: ['presets', index] });
      }
      presetIds.add(preset.presetId);

      const displayName = preset.displayName.toLocaleLowerCase('en-US');
      if (displayNames.has(displayName)) {
        context.addIssue({
          code: 'custom',
          message: 'Duplicate Negative Lab preset display name.',
          path: ['presets', index],
        });
      }
      displayNames.add(displayName);

      const isBlackAndWhitePreset = preset.filmClass === 'black_and_white_silver';
      const hasBlackAndWhiteId = preset.presetId.includes('.bw.');
      if (isBlackAndWhitePreset !== hasBlackAndWhiteId) {
        context.addIssue({
          code: 'custom',
          message: 'Black-and-white preset film classes and ids must align.',
          path: ['presets', index],
        });
      }

      if (preset.filmClass === 'color_negative' && preset.processFamily !== 'c41_color_negative') {
        context.addIssue({
          code: 'custom',
          message: 'Color-negative UI presets must declare the C-41 process family.',
          path: ['presets', index, 'processFamily'],
        });
      }

      if (preset.filmClass === 'black_and_white_silver' && preset.processFamily !== 'black_and_white_silver_negative') {
        context.addIssue({
          code: 'custom',
          message: 'Black-and-white UI presets must declare the silver-negative process family.',
          path: ['presets', index, 'processFamily'],
        });
      }

      if (
        preset.claimPolicy === 'generic_starting_point_no_stock_claim' &&
        (preset.profileStatus !== 'generic_unmeasured' ||
          preset.claimLevel !== 'generic_starting_point_only' ||
          preset.measurementSource !== 'generic_engineered_starting_point')
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Generic no-stock-claim presets must stay generic until measured profile policy is implemented.',
          path: ['presets', index, 'profileStatus'],
        });
      }
    }

    if (!presetIds.has(catalog.defaultPresetId)) {
      context.addIssue({
        code: 'custom',
        message: 'Default Negative Lab preset must exist.',
        path: ['defaultPresetId'],
      });
    }
  });

export type NegativeLabBuiltInUiPreset = z.infer<typeof negativeLabBuiltInUiPresetSchema>;
export type NegativeLabBaseFogSampleRect = z.infer<typeof negativeLabBaseFogSampleRectSchema>;
export type NegativeLabDensityPrintAlgorithm = z.infer<typeof negativeLabDensityPrintAlgorithmSchema>;
export type NegativeLabDensityPrintOutputTag = z.infer<typeof negativeLabDensityPrintOutputTagSchema>;
export type NegativeLabDensityPrintV2Params = z.infer<typeof negativeLabDensityPrintV2ParamsSchema>;
export type NegativeLabPresetParams = z.infer<typeof negativeLabPresetParamsSchema>;
export type NegativeLabBuiltInUiPresetCatalog = z.infer<typeof negativeLabBuiltInUiPresetCatalogSchema>;
export type NegativeLabUiPresetFilmClass = z.infer<typeof negativeLabUiPresetFilmClassSchema>;
export type NegativeLabUiPresetProcessFamily = z.infer<typeof negativeLabUiPresetProcessFamilySchema>;
export type NegativeLabUiPresetProfileStatus = z.infer<typeof negativeLabUiPresetProfileStatusSchema>;
export type NegativeLabUiPresetRuntimeStatus = z.infer<typeof negativeLabUiPresetRuntimeStatusSchema>;
export type NegativeLabUiPresetClaimLevel = z.infer<typeof negativeLabUiPresetClaimLevelSchema>;
export type NegativeLabUiPresetMeasurementSource = z.infer<typeof negativeLabUiPresetMeasurementSourceSchema>;

export const parseNegativeLabBuiltInUiPresetCatalog = (value: unknown): NegativeLabBuiltInUiPresetCatalog =>
  negativeLabBuiltInUiPresetCatalogSchema.parse(value);

export const negativeBaseFogEstimateSchema = z
  .object({
    baseDensity: z.tuple([z.number().min(0), z.number().min(0), z.number().min(0)]),
    baseRgb: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1)]),
    blueWeight: z.number().min(0.5).max(2),
    confidence: z.number().min(0).max(1),
    greenWeight: z.number().min(0.5).max(2),
    redWeight: z.number().min(0.5).max(2),
  })
  .strict();

export const negativeBaseFogSampleReadoutSchema = z
  .object({
    areaPercent: z.number().min(0).max(100),
    confidencePercent: z.number().int().min(0).max(100).nullable(),
    heightPercent: z.number().min(0).max(100),
    label: z.string().trim().min(1),
    widthPercent: z.number().min(0).max(100),
    xPercent: z.number().min(0).max(100),
    yPercent: z.number().min(0).max(100),
  })
  .strict();

export const negativeBaseFogDensitometerStatusSchema = z.enum(['balanced', 'minor_cast', 'strong_cast']);
export const negativeBaseFogDensitometerChannelSchema = z.enum(['red', 'green', 'blue']);
export const negativeBaseFogDensitometerReadoutSchema = z
  .object({
    densityRange: z.number().min(0),
    dominantChannel: negativeBaseFogDensitometerChannelSchema,
    status: negativeBaseFogDensitometerStatusSchema,
  })
  .strict();

export const negativeLabSavedPositiveHandoffSchema = z
  .object({
    artifactId: z.string().trim().min(1),
    conversionBundlePath: z.string().trim().min(1).nullable(),
    dimensions: z.object({ height: z.number().int().positive(), width: z.number().int().positive() }).strict(),
    frameExposureOverrides: z.unknown(),
    frameRgbBalanceOverrides: z.unknown(),
    outputArtifactId: z.string().trim().min(1),
    outputFormat: z.enum(['jpeg_proof', 'tiff16']),
    outputHash: z.string().regex(/^fnv1a64:[a-f0-9]{16}$/u),
    outputPath: z.string().trim().min(1),
    path: z.string().trim().min(1),
    positiveVariantId: z.string().trim().min(1),
    profileProvenanceHash: z
      .string()
      .regex(/^fnv1a32:[a-f0-9]{8}$/u)
      .nullable(),
    replayPlanHash: z.string().regex(/^fnv1a32:[a-f0-9]{8}$/u),
    selectedAcquisitionProfile: z.unknown(),
    selectedProfile: z.unknown().nullable(),
    sidecarPath: z.string().trim().min(1),
    sourceImageRef: z.string().trim().min(1),
    sourcePath: z.string().trim().min(1),
  })
  .strict()
  .superRefine((handoff, context) => {
    if (handoff.path !== handoff.outputPath) {
      context.addIssue({
        code: 'custom',
        message: 'Negative Lab saved positive path must match outputPath.',
        path: ['path'],
      });
    }
    if (handoff.sourceImageRef !== handoff.sourcePath) {
      context.addIssue({
        code: 'custom',
        message: 'Negative Lab sourceImageRef must match sourcePath.',
        path: ['sourceImageRef'],
      });
    }
  });

export const negativeConversionSavedPositiveHandoffsSchema = z.array(negativeLabSavedPositiveHandoffSchema).min(1);
export const negativeConversionSavedPathsSchema = z.array(z.string().trim().min(1)).min(1);

export type NegativeBaseFogDensitometerReadout = z.infer<typeof negativeBaseFogDensitometerReadoutSchema>;
export type NegativeBaseFogEstimate = z.infer<typeof negativeBaseFogEstimateSchema>;
export type NegativeBaseFogSampleReadout = z.infer<typeof negativeBaseFogSampleReadoutSchema>;
export type NegativeLabSavedPositiveHandoff = z.infer<typeof negativeLabSavedPositiveHandoffSchema>;

export const parseNegativeBaseFogEstimate = (value: unknown): NegativeBaseFogEstimate =>
  negativeBaseFogEstimateSchema.parse(value);

export const parseNegativeConversionSavedPaths = (value: unknown): string[] =>
  negativeConversionSavedPathsSchema.parse(value);
