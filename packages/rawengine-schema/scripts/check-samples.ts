import { z } from 'zod';

import {
  artifactHandleV1Schema,
  commandEnvelopeV1Schema,
  negativeAcquisitionProfileV1Schema,
  negativeLabAppServerToolManifestV1Schema,
  negativeLabApplyPlanRequestV1Schema,
  negativeLabApplyResultV1Schema,
  negativeLabBuiltInPresetCatalogV1Schema,
  negativeLabCommandEnvelopeV1Schema,
  negativeLabDensityNormalizationProfileV1Schema,
  negativeLabDryRunResultV1Schema,
  negativeLabFrameDetectionResultV1Schema,
  negativeLabPositiveVariantProvenanceV1Schema,
  negativeLabProcessProfileV1Schema,
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
  sampleNegativeLabApplyResultV1,
  sampleNegativeLabBuiltInPresetCatalogV1,
  sampleNegativeLabCommandEnvelopeV1,
  sampleNegativeLabDensityNormalizationProfileV1,
  sampleNegativeLabDryRunResultV1,
  sampleNegativeLabFrameDetectionResultV1,
  sampleNegativeLabPositiveVariantProvenanceV1,
  sampleNegativeLabProcessProfileV1,
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
    name: 'negative lab process profile',
    schema: negativeLabProcessProfileV1Schema,
    value: sampleNegativeLabProcessProfileV1,
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

console.log(`Validated ${validSamples.length} RawEngine schema samples.`);
