import { z } from 'zod';

import {
  artifactHandleV1Schema,
  commandEnvelopeV1Schema,
  negativeAcquisitionProfileV1Schema,
  negativeLabAppServerToolManifestV1Schema,
  negativeLabApplyPlanRequestV1Schema,
  negativeLabApplyResultV1Schema,
  negativeLabBaseFogEstimateV1Schema,
  negativeLabBaseSampleRecordV1Schema,
  negativeLabBuiltInPresetCatalogV1Schema,
  negativeLabCommandEnvelopeV1Schema,
  negativeLabConversionOperationV1Schema,
  negativeLabDensityNormalizationProfileV1Schema,
  negativeLabDryRunResultV1Schema,
  negativeLabFixtureManifestV1Schema,
  negativeLabFrameDetectionResultV1Schema,
  negativeLabInputProfileCatalogV1Schema,
  negativeLabPerChannelInversionCurveSetV1Schema,
  negativeLabPresetMetadataPolicyCatalogV1Schema,
  negativeLabPositiveVariantProvenanceV1Schema,
  negativeLabProcessProfileV1Schema,
  negativeLabQcProofArtifactV1Schema,
  negativeLabRollBatchWorkflowV1Schema,
  negativeRollSessionV1Schema,
  panoramaArtifactV1Schema,
  queryEnvelopeV1Schema,
  rawEngineToolRegistryV1Schema,
} from '../src/rawEngineSchemas.js';
import {
  sampleArtifactHandleV1,
  sampleCommandEnvelopeV1,
  sampleNegativeAcquisitionProfileV1,
  sampleNegativeLabAppServerToolManifestV1,
  sampleNegativeLabApplyPlanRequestV1,
  sampleNegativeLabApplyFrameCropCommandEnvelopeV1,
  sampleNegativeLabApplyResultV1,
  sampleNegativeLabBaseFogEstimateV1,
  sampleNegativeLabBaseSampleRecordV1,
  sampleNegativeLabBuiltInPresetCatalogV1,
  sampleNegativeLabCommandEnvelopeV1,
  sampleNegativeLabConversionOperationV1,
  sampleNegativeLabDensityNormalizationProfileV1,
  sampleNegativeLabDryRunResultV1,
  sampleNegativeLabFixtureManifestV1,
  sampleNegativeLabFrameDetectionResultV1,
  sampleNegativeLabInputProfileCatalogV1,
  sampleNegativeLabPerChannelInversionCurveSetV1,
  sampleNegativeLabPresetMetadataPolicyCatalogV1,
  sampleNegativeLabPositiveVariantProvenanceV1,
  sampleNegativeLabProcessProfileV1,
  sampleNegativeLabQcProofArtifactV1,
  sampleNegativeLabRollBatchWorkflowV1,
  sampleNegativeRollSessionV1,
  samplePanoramaArtifactV1,
  sampleQueryEnvelopeV1,
  sampleToolRegistryV1,
} from '../src/samplePayloads.js';

const validSamples: ReadonlyArray<{
  name: string;
  schema: z.ZodType;
  value: unknown;
}> = [
  {
    name: 'query envelope',
    schema: queryEnvelopeV1Schema,
    value: sampleQueryEnvelopeV1,
  },
  {
    name: 'command envelope',
    schema: commandEnvelopeV1Schema,
    value: sampleCommandEnvelopeV1,
  },
  {
    name: 'artifact handle',
    schema: artifactHandleV1Schema,
    value: sampleArtifactHandleV1,
  },
  {
    name: 'tool registry',
    schema: rawEngineToolRegistryV1Schema,
    value: sampleToolRegistryV1,
  },
  {
    name: 'panorama artifact',
    schema: panoramaArtifactV1Schema,
    value: samplePanoramaArtifactV1,
  },
  {
    name: 'negative acquisition profile',
    schema: negativeAcquisitionProfileV1Schema,
    value: sampleNegativeAcquisitionProfileV1,
  },
  {
    name: 'negative roll session',
    schema: negativeRollSessionV1Schema,
    value: sampleNegativeRollSessionV1,
  },
  {
    name: 'negative lab command envelope',
    schema: negativeLabCommandEnvelopeV1Schema,
    value: sampleNegativeLabCommandEnvelopeV1,
  },
  {
    name: 'negative lab apply frame crop command envelope',
    schema: negativeLabCommandEnvelopeV1Schema,
    value: sampleNegativeLabApplyFrameCropCommandEnvelopeV1,
  },
  {
    name: 'negative lab dry-run result',
    schema: negativeLabDryRunResultV1Schema,
    value: sampleNegativeLabDryRunResultV1,
  },
  {
    name: 'negative lab apply plan request',
    schema: negativeLabApplyPlanRequestV1Schema,
    value: sampleNegativeLabApplyPlanRequestV1,
  },
  {
    name: 'negative lab apply result',
    schema: negativeLabApplyResultV1Schema,
    value: sampleNegativeLabApplyResultV1,
  },
  {
    name: 'negative lab conversion operation',
    schema: negativeLabConversionOperationV1Schema,
    value: sampleNegativeLabConversionOperationV1,
  },
  {
    name: 'negative lab app-server tool manifest',
    schema: negativeLabAppServerToolManifestV1Schema,
    value: sampleNegativeLabAppServerToolManifestV1,
  },
  {
    name: 'negative lab density normalization profile',
    schema: negativeLabDensityNormalizationProfileV1Schema,
    value: sampleNegativeLabDensityNormalizationProfileV1,
  },
  {
    name: 'negative lab frame detection result',
    schema: negativeLabFrameDetectionResultV1Schema,
    value: sampleNegativeLabFrameDetectionResultV1,
  },
  {
    name: 'negative lab base sample record',
    schema: negativeLabBaseSampleRecordV1Schema,
    value: sampleNegativeLabBaseSampleRecordV1,
  },
  {
    name: 'negative lab base fog estimate',
    schema: negativeLabBaseFogEstimateV1Schema,
    value: sampleNegativeLabBaseFogEstimateV1,
  },
  {
    name: 'negative lab process profile',
    schema: negativeLabProcessProfileV1Schema,
    value: sampleNegativeLabProcessProfileV1,
  },
  {
    name: 'negative lab per-channel inversion curve set',
    schema: negativeLabPerChannelInversionCurveSetV1Schema,
    value: sampleNegativeLabPerChannelInversionCurveSetV1,
  },
  {
    name: 'negative lab QC proof artifact',
    schema: negativeLabQcProofArtifactV1Schema,
    value: sampleNegativeLabQcProofArtifactV1,
  },
  {
    name: 'negative lab roll batch workflow',
    schema: negativeLabRollBatchWorkflowV1Schema,
    value: sampleNegativeLabRollBatchWorkflowV1,
  },
  {
    name: 'negative lab positive variant provenance',
    schema: negativeLabPositiveVariantProvenanceV1Schema,
    value: sampleNegativeLabPositiveVariantProvenanceV1,
  },
  {
    name: 'negative lab built-in preset catalog',
    schema: negativeLabBuiltInPresetCatalogV1Schema,
    value: sampleNegativeLabBuiltInPresetCatalogV1,
  },
  {
    name: 'negative lab preset metadata policy catalog',
    schema: negativeLabPresetMetadataPolicyCatalogV1Schema,
    value: sampleNegativeLabPresetMetadataPolicyCatalogV1,
  },
  {
    name: 'negative lab fixture manifest',
    schema: negativeLabFixtureManifestV1Schema,
    value: sampleNegativeLabFixtureManifestV1,
  },
  {
    name: 'negative lab input profile catalog',
    schema: negativeLabInputProfileCatalogV1Schema,
    value: sampleNegativeLabInputProfileCatalogV1,
  },
];

const expectInvalid = (name: string, schema: z.ZodType, value: unknown) => {
  const parsed = schema.safeParse(value);
  if (parsed.success) {
    throw new Error(`Expected ${name} to be rejected.`);
  }
};

for (const sample of validSamples) {
  const parsed = sample.schema.safeParse(sample.value);
  if (!parsed.success) {
    throw new Error(`Expected valid ${sample.name}: ${parsed.error.message}`);
  }
}

const invalidToolRegistry = {
  ...sampleToolRegistryV1,
  extra: 'reject unknown registry fields',
};

const invalidResult = rawEngineToolRegistryV1Schema.safeParse(invalidToolRegistry);
if (invalidResult.success) {
  throw new Error('Expected tool registry schema to reject unknown fields.');
}

const invalidAcquisitionProfile = {
  ...sampleNegativeAcquisitionProfileV1,
  extra: 'reject unknown acquisition profile fields',
};

const invalidAcquisitionResult = negativeAcquisitionProfileV1Schema.safeParse(invalidAcquisitionProfile);
if (invalidAcquisitionResult.success) {
  throw new Error('Expected negative acquisition profile schema to reject unknown fields.');
}

const invalidNegativeLabCommand = {
  ...sampleNegativeLabCommandEnvelopeV1,
  parameters: {
    ...sampleNegativeLabCommandEnvelopeV1.parameters,
    unexpectedParameter: true,
  },
};

const invalidNegativeLabCommandResult = negativeLabCommandEnvelopeV1Schema.safeParse(invalidNegativeLabCommand);
if (invalidNegativeLabCommandResult.success) {
  throw new Error('Expected negative lab command schema to reject unknown parameter fields.');
}

const invalidFrameQcCommand = {
  ...sampleNegativeLabCommandEnvelopeV1,
  commandType: 'negativeLab.setFrameQcStatus',
  parameters: {
    acknowledgedWarningCodes: [],
    frameId: 'frame_0001',
    qcStatus: 'approved',
    sessionId: 'negative_roll_session_sample',
    warningCodes: ['lossy_input'],
  },
};

const invalidFrameQcCommandResult = negativeLabCommandEnvelopeV1Schema.safeParse(invalidFrameQcCommand);
if (invalidFrameQcCommandResult.success) {
  throw new Error('Expected frame QC command schema to reject generated warningCodes as user input.');
}

if (sampleNegativeLabApplyFrameCropCommandEnvelopeV1.commandType !== 'negativeLab.applyFrameCrop') {
  throw new Error('Expected frame crop command sample to use negativeLab.applyFrameCrop.');
}

const [sampleFrameCropEdit] = sampleNegativeLabApplyFrameCropCommandEnvelopeV1.parameters.cropEdits;
if (sampleFrameCropEdit === undefined) {
  throw new Error('Expected frame crop command sample to include a crop edit.');
}

const invalidFrameCropDuplicateFrames = {
  ...sampleNegativeLabApplyFrameCropCommandEnvelopeV1,
  parameters: {
    ...sampleNegativeLabApplyFrameCropCommandEnvelopeV1.parameters,
    cropEdits: [sampleFrameCropEdit, sampleFrameCropEdit],
  },
};
expectInvalid(
  'frame crop command with duplicate frame edits',
  negativeLabCommandEnvelopeV1Schema,
  invalidFrameCropDuplicateFrames,
);

const invalidFrameCropMissingDetectionRun = {
  ...sampleNegativeLabApplyFrameCropCommandEnvelopeV1,
  parameters: {
    ...sampleNegativeLabApplyFrameCropCommandEnvelopeV1.parameters,
    detectionRunId: undefined,
  },
};
expectInvalid(
  'detected frame crop command without detection run ID',
  negativeLabCommandEnvelopeV1Schema,
  invalidFrameCropMissingDetectionRun,
);

const invalidFrameCropAcceptedManualSource = {
  ...sampleNegativeLabApplyFrameCropCommandEnvelopeV1,
  parameters: {
    ...sampleNegativeLabApplyFrameCropCommandEnvelopeV1.parameters,
    cropEdits: [
      {
        ...sampleFrameCropEdit,
        cropSource: 'manual_override',
      },
    ],
  },
};
expectInvalid(
  'accepted detected frame crop command with manual crop source',
  negativeLabCommandEnvelopeV1Schema,
  invalidFrameCropAcceptedManualSource,
);

const invalidFrameCropManualDetectedSource = {
  ...sampleNegativeLabApplyFrameCropCommandEnvelopeV1,
  parameters: {
    ...sampleNegativeLabApplyFrameCropCommandEnvelopeV1.parameters,
    cropEdits: [
      {
        ...sampleFrameCropEdit,
        cropSource: 'detected_frame',
        editMode: 'manual_override',
      },
    ],
  },
};
expectInvalid(
  'manual frame crop override recorded as detected crop',
  negativeLabCommandEnvelopeV1Schema,
  invalidFrameCropManualDetectedSource,
);

const invalidFrameCropRejectedWithoutNotes = {
  ...sampleNegativeLabApplyFrameCropCommandEnvelopeV1,
  parameters: {
    ...sampleNegativeLabApplyFrameCropCommandEnvelopeV1.parameters,
    cropEdits: [
      {
        ...sampleFrameCropEdit,
        editMode: 'reject_detected',
        notes: undefined,
      },
    ],
  },
};
expectInvalid(
  'rejected frame crop command without review notes',
  negativeLabCommandEnvelopeV1Schema,
  invalidFrameCropRejectedWithoutNotes,
);

const invalidDeferredProcessCommand = {
  ...sampleNegativeLabCommandEnvelopeV1,
  parameters: {
    ...sampleNegativeLabCommandEnvelopeV1.parameters,
    processFamily: 'ecn2_color_negative',
  },
};

const invalidDeferredProcessCommandResult = negativeLabCommandEnvelopeV1Schema.safeParse(invalidDeferredProcessCommand);
if (invalidDeferredProcessCommandResult.success) {
  throw new Error('Expected negative lab v1 command schema to reject deferred process families.');
}

const invalidMutatingAppServerToolManifest = {
  ...sampleNegativeLabAppServerToolManifestV1,
  tools: [
    {
      ...sampleNegativeLabAppServerToolManifestV1.tools[0],
      approvalClass: 'preview_only',
      executionMode: 'apply_dry_run_plan',
      inputSchemaName: 'NegativeLabCommandEnvelopeV1',
      mutates: true,
      requiresDryRunPlan: false,
    },
  ],
};

const invalidMutatingAppServerToolResult = negativeLabAppServerToolManifestV1Schema.safeParse(
  invalidMutatingAppServerToolManifest,
);
if (invalidMutatingAppServerToolResult.success) {
  throw new Error('Expected mutating app-server tool manifests to require edit approval and a dry-run plan.');
}

const invalidPositiveVariantProvenance = {
  ...sampleNegativeLabPositiveVariantProvenanceV1,
  sourceContentHash: '',
};

const invalidPositiveVariantProvenanceResult = negativeLabPositiveVariantProvenanceV1Schema.safeParse(
  invalidPositiveVariantProvenance,
);
if (invalidPositiveVariantProvenanceResult.success) {
  throw new Error('Expected positive variant provenance schema to reject missing source hashes.');
}

const invalidDensityNormalizationProfile = {
  ...sampleNegativeLabDensityNormalizationProfileV1,
  channelBalanceWeights: {
    blue: 0.5,
    green: 0.5,
    red: 0.5,
  },
};

const invalidDensityNormalizationProfileResult = negativeLabDensityNormalizationProfileV1Schema.safeParse(
  invalidDensityNormalizationProfile,
);
if (invalidDensityNormalizationProfileResult.success) {
  throw new Error('Expected density normalization profiles to reject channel weights that do not sum to 1.');
}

const invalidProcessProfile = {
  ...sampleNegativeLabProcessProfileV1,
  densityCurves: [
    {
      channel: 'red',
      interpolation: 'linear',
      points: [
        { inputDensity: 0, outputLinear: 0.2 },
        { inputDensity: 0.5, outputLinear: 0.1 },
      ],
    },
  ],
};

const invalidProcessProfileResult = negativeLabProcessProfileV1Schema.safeParse(invalidProcessProfile);
if (invalidProcessProfileResult.success) {
  throw new Error('Expected process profiles to reject non-monotonic density curves.');
}

const [sampleRedDensityCurve] = sampleNegativeLabProcessProfileV1.densityCurves;
if (sampleRedDensityCurve === undefined) {
  throw new Error('Expected process profile sample to include a red density curve.');
}

const invalidDuplicateInversionCurveSet = {
  ...sampleNegativeLabPerChannelInversionCurveSetV1,
  densityCurves: [sampleRedDensityCurve, sampleRedDensityCurve],
};
expectInvalid(
  'per-channel inversion curve set with duplicate channels',
  negativeLabPerChannelInversionCurveSetV1Schema,
  invalidDuplicateInversionCurveSet,
);

const invalidBlackAndWhiteInversionCurveSet = {
  ...sampleNegativeLabPerChannelInversionCurveSetV1,
  colorMode: 'black_and_white_luminance',
};
expectInvalid(
  'black-and-white inversion curve set with RGB curves',
  negativeLabPerChannelInversionCurveSetV1Schema,
  invalidBlackAndWhiteInversionCurveSet,
);

if (sampleNegativeLabCommandEnvelopeV1.commandType !== 'negativeLab.setConversionRecipe') {
  throw new Error('Expected command sample to use negativeLab.setConversionRecipe.');
}

const sampleConversionRecipeParameters = sampleNegativeLabCommandEnvelopeV1.parameters;
const curveModelWithoutInversionCurveSet = {
  curveFamily: sampleConversionRecipeParameters.curveModel.curveFamily,
  inversionCurveSetPolicy: 'use_curve_set_override',
  normalizationProfileId: sampleConversionRecipeParameters.curveModel.normalizationProfileId,
  normalizationProfileVersion: sampleConversionRecipeParameters.curveModel.normalizationProfileVersion,
  processProfileId: sampleConversionRecipeParameters.curveModel.processProfileId,
  processProfileVersion: sampleConversionRecipeParameters.curveModel.processProfileVersion,
};
const invalidCurveOverrideCommand = {
  ...sampleNegativeLabCommandEnvelopeV1,
  parameters: {
    ...sampleConversionRecipeParameters,
    curveModel: curveModelWithoutInversionCurveSet,
  },
};
expectInvalid(
  'curve override command without curve set',
  negativeLabCommandEnvelopeV1Schema,
  invalidCurveOverrideCommand,
);

const [sampleDetectedFrame] = sampleNegativeLabFrameDetectionResultV1.detectedFrames;
if (sampleDetectedFrame === undefined) {
  throw new Error('Expected frame detection sample to include a detected frame.');
}

const invalidFrameDetectionDuplicateId = {
  ...sampleNegativeLabFrameDetectionResultV1,
  detectedFrames: [
    sampleDetectedFrame,
    {
      ...sampleDetectedFrame,
      frameIndex: 1,
    },
  ],
};

const invalidFrameDetectionDuplicateIdResult = negativeLabFrameDetectionResultV1Schema.safeParse(
  invalidFrameDetectionDuplicateId,
);
if (invalidFrameDetectionDuplicateIdResult.success) {
  throw new Error('Expected frame detection results to reject duplicate frame IDs.');
}

const invalidFrameDetectionUnknownSource = {
  ...sampleNegativeLabFrameDetectionResultV1,
  detectedFrames: [
    {
      ...sampleDetectedFrame,
      sourceFileId: 'unknown_source_file',
    },
  ],
};

const invalidFrameDetectionUnknownSourceResult = negativeLabFrameDetectionResultV1Schema.safeParse(
  invalidFrameDetectionUnknownSource,
);
if (invalidFrameDetectionUnknownSourceResult.success) {
  throw new Error('Expected frame detection results to reject frames from unlisted source files.');
}

const invalidAcceptedBaseSampleWithoutStats = {
  ...sampleNegativeLabBaseSampleRecordV1,
  sampleStats: undefined,
};
expectInvalid(
  'accepted base sample without channel stats',
  negativeLabBaseSampleRecordV1Schema,
  invalidAcceptedBaseSampleWithoutStats,
);

const invalidRejectedBaseSampleWithoutReason = {
  ...sampleNegativeLabBaseSampleRecordV1,
  rejectionReason: undefined,
  sampleStats: undefined,
  status: 'rejected',
};
expectInvalid(
  'rejected base sample without reason',
  negativeLabBaseSampleRecordV1Schema,
  invalidRejectedBaseSampleWithoutReason,
);

const invalidBaseFogEstimateDuplicateSources = {
  ...sampleNegativeLabBaseFogEstimateV1,
  sourceSampleIds: [sampleNegativeLabBaseSampleRecordV1.sampleId, sampleNegativeLabBaseSampleRecordV1.sampleId],
};
expectInvalid(
  'base fog estimate with duplicate source samples',
  negativeLabBaseFogEstimateV1Schema,
  invalidBaseFogEstimateDuplicateSources,
);

const invalidBaseFogEstimateRejectedSource = {
  ...sampleNegativeLabBaseFogEstimateV1,
  rejectedSampleIds: [sampleNegativeLabBaseSampleRecordV1.sampleId],
};
expectInvalid(
  'base fog estimate using a rejected source sample',
  negativeLabBaseFogEstimateV1Schema,
  invalidBaseFogEstimateRejectedSource,
);

const invalidHighConfidenceBaseFogWarning = {
  ...sampleNegativeLabBaseFogEstimateV1,
  confidence: 'high',
  warningCodes: ['clipped_base_channel'],
};
expectInvalid(
  'high-confidence base fog estimate with confidence warning',
  negativeLabBaseFogEstimateV1Schema,
  invalidHighConfidenceBaseFogWarning,
);

const invalidOperationWrongStage = {
  ...sampleNegativeLabConversionOperationV1,
  operationStage: 'creative_rendering',
};
expectInvalid(
  'conversion operation with wrong stage',
  negativeLabConversionOperationV1Schema,
  invalidOperationWrongStage,
);

const invalidOperationWrongClass = {
  ...sampleNegativeLabConversionOperationV1,
  operationClass: 'creative',
};
expectInvalid(
  'conversion operation with wrong class',
  negativeLabConversionOperationV1Schema,
  invalidOperationWrongClass,
);

const invalidMutatingOperationWithoutApplyApproval = {
  ...sampleNegativeLabConversionOperationV1,
  changeSet: sampleNegativeLabApplyResultV1.changeSet,
  mutates: true,
  resultGraphRevision: sampleNegativeLabApplyResultV1.appliedGraphRevision,
};
expectInvalid(
  'mutating conversion operation without apply approval',
  negativeLabConversionOperationV1Schema,
  invalidMutatingOperationWithoutApplyApproval,
);

const invalidDryRunOperationWithChangeSet = {
  ...sampleNegativeLabConversionOperationV1,
  changeSet: sampleNegativeLabApplyResultV1.changeSet,
};
expectInvalid(
  'dry-run conversion operation with change set',
  negativeLabConversionOperationV1Schema,
  invalidDryRunOperationWithChangeSet,
);

const invalidPositiveVariantOperationWithoutOutputs = {
  ...sampleNegativeLabConversionOperationV1,
  artifactPurposes: ['editable_positive_variant'],
  commandType: 'negativeLab.createPositiveVariant',
  operationClass: 'output',
  operationStage: 'output_generation',
  outputArtifacts: [],
  parameterRefs: {
    ...sampleNegativeLabConversionOperationV1.parameterRefs,
    positiveVariantIds: [],
  },
};
expectInvalid(
  'positive variant operation without output artifact references',
  negativeLabConversionOperationV1Schema,
  invalidPositiveVariantOperationWithoutOutputs,
);

const [sampleBuiltInPreset, secondSampleBuiltInPreset] = sampleNegativeLabBuiltInPresetCatalogV1.presets;
if (sampleBuiltInPreset === undefined || secondSampleBuiltInPreset === undefined) {
  throw new Error('Expected built-in preset catalog sample to include at least two presets.');
}

const invalidGenericPresetManufacturerClaim = {
  ...sampleNegativeLabBuiltInPresetCatalogV1,
  presets: [
    {
      ...sampleBuiltInPreset,
      displayName: 'Kodak Portra 400',
    },
    ...sampleNegativeLabBuiltInPresetCatalogV1.presets.slice(1),
  ],
};
expectInvalid(
  'generic built-in preset catalog with manufacturer or stock claims',
  negativeLabBuiltInPresetCatalogV1Schema,
  invalidGenericPresetManufacturerClaim,
);

const invalidGenericPresetUppercaseId = {
  ...sampleNegativeLabBuiltInPresetCatalogV1,
  presets: [
    {
      ...sampleBuiltInPreset,
      presetId: 'negative_lab.generic.C41.neutral.v1',
    },
    ...sampleNegativeLabBuiltInPresetCatalogV1.presets.slice(1),
  ],
};
expectInvalid(
  'generic built-in preset catalog with uppercase preset IDs',
  negativeLabBuiltInPresetCatalogV1Schema,
  invalidGenericPresetUppercaseId,
);

const invalidGenericPresetDuplicateIds = {
  ...sampleNegativeLabBuiltInPresetCatalogV1,
  presets: [
    sampleBuiltInPreset,
    {
      ...secondSampleBuiltInPreset,
      presetId: sampleBuiltInPreset.presetId,
    },
    ...sampleNegativeLabBuiltInPresetCatalogV1.presets.slice(2),
  ],
};
expectInvalid(
  'generic built-in preset catalog with duplicate preset IDs',
  negativeLabBuiltInPresetCatalogV1Schema,
  invalidGenericPresetDuplicateIds,
);

const invalidGenericPresetDuplicateDisplayNames = {
  ...sampleNegativeLabBuiltInPresetCatalogV1,
  presets: [
    sampleBuiltInPreset,
    {
      ...secondSampleBuiltInPreset,
      displayName: sampleBuiltInPreset.displayName.toLocaleUpperCase('en-US'),
    },
    ...sampleNegativeLabBuiltInPresetCatalogV1.presets.slice(2),
  ],
};
expectInvalid(
  'generic built-in preset catalog with duplicate display names',
  negativeLabBuiltInPresetCatalogV1Schema,
  invalidGenericPresetDuplicateDisplayNames,
);

const invalidGenericPresetExactNameApproval = {
  ...sampleNegativeLabBuiltInPresetCatalogV1,
  presets: [
    {
      ...sampleBuiltInPreset,
      legalNamingStatus: 'approved_exact_stock_name',
    },
    ...sampleNegativeLabBuiltInPresetCatalogV1.presets.slice(1),
  ],
};
expectInvalid(
  'generic built-in preset catalog with exact-stock naming status',
  negativeLabBuiltInPresetCatalogV1Schema,
  invalidGenericPresetExactNameApproval,
);

const invalidGenericPresetMeasuredProvenance = {
  ...sampleNegativeLabBuiltInPresetCatalogV1,
  presets: [
    {
      ...sampleBuiltInPreset,
      provenance: {
        ...sampleBuiltInPreset.provenance,
        measurementSource: 'project_owned_measurement',
      },
    },
    ...sampleNegativeLabBuiltInPresetCatalogV1.presets.slice(1),
  ],
};
expectInvalid(
  'generic built-in preset catalog with measured provenance',
  negativeLabBuiltInPresetCatalogV1Schema,
  invalidGenericPresetMeasuredProvenance,
);

const invalidGenericPresetProfileMismatch = {
  ...sampleNegativeLabBuiltInPresetCatalogV1,
  presets: [
    {
      ...sampleBuiltInPreset,
      processProfileId: 'generic_bw_silver_v1',
      processProfileVersion: '2026-06-13',
    },
    ...sampleNegativeLabBuiltInPresetCatalogV1.presets.slice(1),
  ],
};
expectInvalid(
  'generic built-in preset catalog with film class and process profile mismatches',
  negativeLabBuiltInPresetCatalogV1Schema,
  invalidGenericPresetProfileMismatch,
);

const invalidGenericPresetCreativeRendering = {
  ...sampleNegativeLabBuiltInPresetCatalogV1,
  presets: [
    {
      ...sampleBuiltInPreset,
      touchedParameters: {
        ...sampleBuiltInPreset.touchedParameters,
        creativeRendering: ['contrast_s_curve_v1'],
      },
    },
    ...sampleNegativeLabBuiltInPresetCatalogV1.presets.slice(1),
  ],
};
expectInvalid(
  'generic built-in preset catalog with creative rendering defaults',
  negativeLabBuiltInPresetCatalogV1Schema,
  invalidGenericPresetCreativeRendering,
);

const invalidGenericPresetLabJpegWithoutWarnings = {
  ...sampleNegativeLabBuiltInPresetCatalogV1,
  presets: [
    {
      ...sampleBuiltInPreset,
      intendedInputModes: ['camera_raw', 'lab_jpeg'],
      requiredWarningCodes: [],
    },
    ...sampleNegativeLabBuiltInPresetCatalogV1.presets.slice(1),
  ],
};
expectInvalid(
  'generic built-in preset catalog that allows lab JPEG without required warnings',
  negativeLabBuiltInPresetCatalogV1Schema,
  invalidGenericPresetLabJpegWithoutWarnings,
);

const [
  sampleGenericPresetPolicy,
  sampleStockFamilyPresetPolicy,
  sampleMeasuredPresetPolicy,
  sampleLicensedPresetPolicy,
  sampleBlockedPresetPolicy,
] = sampleNegativeLabPresetMetadataPolicyCatalogV1.policies;
if (
  sampleGenericPresetPolicy === undefined ||
  sampleStockFamilyPresetPolicy === undefined ||
  sampleMeasuredPresetPolicy === undefined ||
  sampleLicensedPresetPolicy === undefined ||
  sampleBlockedPresetPolicy === undefined
) {
  throw new Error('Expected preset metadata policy catalog sample to include all policy tiers.');
}

const invalidPresetPolicyGenericManufacturerClaim = {
  ...sampleNegativeLabPresetMetadataPolicyCatalogV1,
  policies: [
    {
      ...sampleGenericPresetPolicy,
      allowedClaims: {
        ...sampleGenericPresetPolicy.allowedClaims,
        manufacturerName: true,
      },
    },
    ...sampleNegativeLabPresetMetadataPolicyCatalogV1.policies.slice(1),
  ],
};
expectInvalid(
  'preset metadata policy catalog with generic manufacturer claims',
  negativeLabPresetMetadataPolicyCatalogV1Schema,
  invalidPresetPolicyGenericManufacturerClaim,
);

const invalidPresetPolicyStockFamilyWithoutCitations = {
  ...sampleNegativeLabPresetMetadataPolicyCatalogV1,
  policies: [
    sampleGenericPresetPolicy,
    {
      ...sampleStockFamilyPresetPolicy,
      sourceRequirements: {
        ...sampleStockFamilyPresetPolicy.sourceRequirements,
        sourceCitationIds: [],
      },
    },
    ...sampleNegativeLabPresetMetadataPolicyCatalogV1.policies.slice(2),
  ],
};
expectInvalid(
  'preset metadata policy catalog with stock-family policy missing citations',
  negativeLabPresetMetadataPolicyCatalogV1Schema,
  invalidPresetPolicyStockFamilyWithoutCitations,
);

const invalidPresetPolicyMeasuredWithoutFixture = {
  ...sampleNegativeLabPresetMetadataPolicyCatalogV1,
  policies: [
    ...sampleNegativeLabPresetMetadataPolicyCatalogV1.policies.slice(0, 2),
    {
      ...sampleMeasuredPresetPolicy,
      sourceRequirements: {
        ...sampleMeasuredPresetPolicy.sourceRequirements,
        fixtureIds: [],
      },
    },
    ...sampleNegativeLabPresetMetadataPolicyCatalogV1.policies.slice(3),
  ],
};
expectInvalid(
  'preset metadata policy catalog with measured policy missing fixture IDs',
  negativeLabPresetMetadataPolicyCatalogV1Schema,
  invalidPresetPolicyMeasuredWithoutFixture,
);

const invalidPresetPolicyLicensedWithoutLicense = {
  ...sampleNegativeLabPresetMetadataPolicyCatalogV1,
  policies: [
    ...sampleNegativeLabPresetMetadataPolicyCatalogV1.policies.slice(0, 3),
    {
      ...sampleLicensedPresetPolicy,
      sourceRequirements: {
        ...sampleLicensedPresetPolicy.sourceRequirements,
        licenseRecordIds: [],
      },
    },
    ...sampleNegativeLabPresetMetadataPolicyCatalogV1.policies.slice(4),
  ],
};
expectInvalid(
  'preset metadata policy catalog with licensed exact policy missing license records',
  negativeLabPresetMetadataPolicyCatalogV1Schema,
  invalidPresetPolicyLicensedWithoutLicense,
);

const invalidPresetPolicyBlockedInNormalUi = {
  ...sampleNegativeLabPresetMetadataPolicyCatalogV1,
  policies: [
    ...sampleNegativeLabPresetMetadataPolicyCatalogV1.policies.slice(0, 4),
    {
      ...sampleBlockedPresetPolicy,
      allowedUiContexts: ['negative_lab_workspace'],
    },
  ],
};
expectInvalid(
  'preset metadata policy catalog with blocked policy visible in normal UI',
  negativeLabPresetMetadataPolicyCatalogV1Schema,
  invalidPresetPolicyBlockedInNormalUi,
);

const invalidPresetPolicyDuplicateIds = {
  ...sampleNegativeLabPresetMetadataPolicyCatalogV1,
  policies: [
    sampleGenericPresetPolicy,
    {
      ...sampleStockFamilyPresetPolicy,
      policyId: sampleGenericPresetPolicy.policyId,
    },
    ...sampleNegativeLabPresetMetadataPolicyCatalogV1.policies.slice(2),
  ],
};
expectInvalid(
  'preset metadata policy catalog with duplicate policy IDs',
  negativeLabPresetMetadataPolicyCatalogV1Schema,
  invalidPresetPolicyDuplicateIds,
);

const [sampleNegativeLabInputProfile, secondSampleNegativeLabInputProfile] =
  sampleNegativeLabInputProfileCatalogV1.profiles;
if (sampleNegativeLabInputProfile === undefined || secondSampleNegativeLabInputProfile === undefined) {
  throw new Error('Expected input profile catalog sample to include at least two profiles.');
}

const invalidInputProfileDuplicateIds = {
  ...sampleNegativeLabInputProfileCatalogV1,
  profiles: [
    sampleNegativeLabInputProfile,
    {
      ...secondSampleNegativeLabInputProfile,
      profileId: sampleNegativeLabInputProfile.profileId,
    },
    ...sampleNegativeLabInputProfileCatalogV1.profiles.slice(2),
  ],
};
expectInvalid(
  'negative lab input profile catalog with duplicate profile IDs',
  negativeLabInputProfileCatalogV1Schema,
  invalidInputProfileDuplicateIds,
);

const invalidInputProfileDefaultMode = {
  ...sampleNegativeLabInputProfileCatalogV1,
  profiles: [
    {
      ...sampleNegativeLabInputProfile,
      defaultInputMode: 'lab_jpeg',
    },
    ...sampleNegativeLabInputProfileCatalogV1.profiles.slice(1),
  ],
};
expectInvalid(
  'negative lab input profile with unsupported default mode',
  negativeLabInputProfileCatalogV1Schema,
  invalidInputProfileDefaultMode,
);

const invalidCameraRawProfile = {
  ...sampleNegativeLabInputProfileCatalogV1,
  profiles: [
    {
      ...sampleNegativeLabInputProfile,
      colorSpaceEncoding: 'display_referred_rgb',
    },
    ...sampleNegativeLabInputProfileCatalogV1.profiles.slice(1),
  ],
};
expectInvalid(
  'camera raw input profile with display-referred encoding',
  negativeLabInputProfileCatalogV1Schema,
  invalidCameraRawProfile,
);

const invalidLabRenderedProfileWarnings = {
  ...sampleNegativeLabInputProfileCatalogV1,
  profiles: [
    {
      ...sampleNegativeLabInputProfileCatalogV1.profiles[3],
      requiredWarningCodes: [],
    },
  ],
};
expectInvalid(
  'lab-rendered input profile without required warnings',
  negativeLabInputProfileCatalogV1Schema,
  invalidLabRenderedProfileWarnings,
);

const invalidHighConfidenceAssumption = {
  ...sampleNegativeLabInputProfileCatalogV1,
  profiles: [
    {
      ...sampleNegativeLabInputProfile,
      inputProfileSource: 'assumed_display_profile',
    },
    ...sampleNegativeLabInputProfileCatalogV1.profiles.slice(1),
  ],
};
expectInvalid(
  'high-confidence input profile with assumed display profile source',
  negativeLabInputProfileCatalogV1Schema,
  invalidHighConfidenceAssumption,
);

const [sampleQcOverlay] = sampleNegativeLabQcProofArtifactV1.overlays;
if (sampleQcOverlay === undefined) {
  throw new Error('Expected QC proof sample to include an overlay.');
}

const [sampleQcFrameMetric] = sampleNegativeLabQcProofArtifactV1.rollConsistency.frameMetrics;
if (sampleQcFrameMetric === undefined) {
  throw new Error('Expected QC proof sample to include a roll consistency frame metric.');
}

const invalidQcOverlayFrame = {
  ...sampleNegativeLabQcProofArtifactV1,
  overlays: [
    {
      ...sampleQcOverlay,
      frameId: 'missing_frame',
    },
  ],
};

const invalidQcOverlayFrameResult = negativeLabQcProofArtifactV1Schema.safeParse(invalidQcOverlayFrame);
if (invalidQcOverlayFrameResult.success) {
  throw new Error('Expected QC proof artifacts to reject overlays for unlisted frames.');
}

const invalidQcMetricFrame = {
  ...sampleNegativeLabQcProofArtifactV1,
  rollConsistency: {
    ...sampleNegativeLabQcProofArtifactV1.rollConsistency,
    frameMetrics: [
      {
        ...sampleQcFrameMetric,
        frameId: 'missing_frame',
      },
    ],
  },
};

const invalidQcMetricFrameResult = negativeLabQcProofArtifactV1Schema.safeParse(invalidQcMetricFrame);
if (invalidQcMetricFrameResult.success) {
  throw new Error('Expected QC proof artifacts to reject roll metrics for unlisted frames.');
}

const [
  sampleRollBatchFrameDetectionStage,
  sampleRollBatchBaseStage,
  sampleRollBatchConversionStage,
  ...remainingSampleRollBatchStages
] = sampleNegativeLabRollBatchWorkflowV1.stagePlans;
const [sampleRollBatchFrameMetric] = sampleNegativeLabRollBatchWorkflowV1.rollConsistencyPreview.frameMetrics;
if (
  sampleRollBatchFrameDetectionStage === undefined ||
  sampleRollBatchBaseStage === undefined ||
  sampleRollBatchConversionStage === undefined ||
  sampleRollBatchFrameMetric === undefined
) {
  throw new Error('Expected roll batch workflow sample to include stages and frame metrics.');
}

const invalidRollBatchWorkflowRejectedFrames = {
  ...sampleNegativeLabRollBatchWorkflowV1,
  batchPolicy: {
    ...sampleNegativeLabRollBatchWorkflowV1.batchPolicy,
    includeRejectedFrames: true,
  },
};
expectInvalid(
  'negative lab roll batch workflow that includes rejected frames',
  negativeLabRollBatchWorkflowV1Schema,
  invalidRollBatchWorkflowRejectedFrames,
);

const invalidRollBatchWorkflowAnchorOutsideSelection = {
  ...sampleNegativeLabRollBatchWorkflowV1,
  anchorFrameIds: ['missing_frame'],
};
expectInvalid(
  'negative lab roll batch workflow with anchor outside selected frames',
  negativeLabRollBatchWorkflowV1Schema,
  invalidRollBatchWorkflowAnchorOutsideSelection,
);

const invalidRollBatchWorkflowMetricOutsideSelection = {
  ...sampleNegativeLabRollBatchWorkflowV1,
  rollConsistencyPreview: {
    ...sampleNegativeLabRollBatchWorkflowV1.rollConsistencyPreview,
    frameMetrics: [
      {
        ...sampleRollBatchFrameMetric,
        frameId: 'missing_frame',
      },
    ],
  },
};
expectInvalid(
  'negative lab roll batch workflow with consistency metric outside selected frames',
  negativeLabRollBatchWorkflowV1Schema,
  invalidRollBatchWorkflowMetricOutsideSelection,
);

const invalidRollBatchWorkflowMissingRequiredStage = {
  ...sampleNegativeLabRollBatchWorkflowV1,
  stagePlans: sampleNegativeLabRollBatchWorkflowV1.stagePlans.filter((stagePlan) => stagePlan.stage !== 'qc_review'),
};
expectInvalid(
  'negative lab roll batch workflow missing QC review stage',
  negativeLabRollBatchWorkflowV1Schema,
  invalidRollBatchWorkflowMissingRequiredStage,
);

const invalidRollBatchWorkflowDryRunReadyWithoutPlan = {
  ...sampleNegativeLabRollBatchWorkflowV1,
  stagePlans: [
    sampleRollBatchFrameDetectionStage,
    sampleRollBatchBaseStage,
    {
      ...sampleRollBatchConversionStage,
      dryRunPlanIds: [],
    },
    ...remainingSampleRollBatchStages,
  ],
};
expectInvalid(
  'negative lab roll batch workflow dry-run stage without plan IDs',
  negativeLabRollBatchWorkflowV1Schema,
  invalidRollBatchWorkflowDryRunReadyWithoutPlan,
);

const invalidRollBatchWorkflowDuplicateStages = {
  ...sampleNegativeLabRollBatchWorkflowV1,
  stagePlans: [
    sampleRollBatchFrameDetectionStage,
    {
      ...sampleRollBatchBaseStage,
      stage: sampleRollBatchFrameDetectionStage.stage,
    },
    sampleRollBatchConversionStage,
    ...remainingSampleRollBatchStages,
  ],
};
expectInvalid(
  'negative lab roll batch workflow with duplicate stages',
  negativeLabRollBatchWorkflowV1Schema,
  invalidRollBatchWorkflowDuplicateStages,
);

const [sampleNegativeLabFixture, secondSampleNegativeLabFixture] = sampleNegativeLabFixtureManifestV1.entries;
if (sampleNegativeLabFixture === undefined || secondSampleNegativeLabFixture === undefined) {
  throw new Error('Expected negative lab fixture manifest sample to include at least two entries.');
}

const invalidFixtureDuplicateIds = {
  ...sampleNegativeLabFixtureManifestV1,
  entries: [
    sampleNegativeLabFixture,
    {
      ...secondSampleNegativeLabFixture,
      fixtureId: sampleNegativeLabFixture.fixtureId,
    },
  ],
};
expectInvalid(
  'negative lab fixture manifest with duplicate IDs',
  negativeLabFixtureManifestV1Schema,
  invalidFixtureDuplicateIds,
);

const invalidApprovedFixtureWithoutReview = {
  ...sampleNegativeLabFixtureManifestV1,
  entries: [
    {
      ...sampleNegativeLabFixture,
      reviewedAt: undefined,
      reviewer: undefined,
    },
    ...sampleNegativeLabFixtureManifestV1.entries.slice(1),
  ],
};
expectInvalid(
  'approved negative lab fixture without review metadata',
  negativeLabFixtureManifestV1Schema,
  invalidApprovedFixtureWithoutReview,
);

const invalidPublicFixtureWithoutRights = {
  ...sampleNegativeLabFixtureManifestV1,
  entries: [
    {
      ...sampleNegativeLabFixture,
      derivativeDistributionAllowed: false,
    },
    ...sampleNegativeLabFixtureManifestV1.entries.slice(1),
  ],
};
expectInvalid(
  'public negative lab fixture without derivative rights',
  negativeLabFixtureManifestV1Schema,
  invalidPublicFixtureWithoutRights,
);

const invalidPublicSourceWithoutLicense = {
  ...sampleNegativeLabFixtureManifestV1,
  entries: [
    {
      ...sampleNegativeLabFixture,
      source: {
        copyrightOwner: 'Unknown source',
        sourceKind: 'permissive_public',
      },
    },
    ...sampleNegativeLabFixtureManifestV1.entries.slice(1),
  ],
};
expectInvalid(
  'negative lab fixture manifest with public source missing license evidence',
  negativeLabFixtureManifestV1Schema,
  invalidPublicSourceWithoutLicense,
);

const invalidFixtureProfileMeasurementUse = {
  ...sampleNegativeLabFixtureManifestV1,
  entries: [
    {
      ...sampleNegativeLabFixture,
      allowedValidationUses: ['profile_measurement'],
    },
    ...sampleNegativeLabFixtureManifestV1.entries.slice(1),
  ],
};
expectInvalid(
  'synthetic negative lab fixture used for profile measurement',
  negativeLabFixtureManifestV1Schema,
  invalidFixtureProfileMeasurementUse,
);

const invalidFixtureLabJpegWarnings = {
  ...sampleNegativeLabFixtureManifestV1,
  entries: [
    {
      ...sampleNegativeLabFixture,
      expectedNegativeWarningCodes: [],
      fileFormat: 'jpeg',
      lossyCompression: true,
      scanInputMode: 'lab_jpeg',
    },
    ...sampleNegativeLabFixtureManifestV1.entries.slice(1),
  ],
};
expectInvalid(
  'negative lab lab-JPEG fixture without expected warnings',
  negativeLabFixtureManifestV1Schema,
  invalidFixtureLabJpegWarnings,
);

console.log(`Validated ${validSamples.length} RawEngine schema samples.`);
