import { z } from 'zod';

import {
  artifactHandleV1Schema,
  commandEnvelopeV1Schema,
  negativeAcquisitionProfileV1Schema,
  negativeLabApplyPlanRequestV1Schema,
  negativeLabApplyResultV1Schema,
  negativeLabCommandEnvelopeV1Schema,
  negativeLabDryRunResultV1Schema,
  negativeRollSessionV1Schema,
  panoramaArtifactV1Schema,
  queryEnvelopeV1Schema,
  rawEngineToolRegistryV1Schema,
} from '../src/rawEngineSchemas.js';
import {
  sampleArtifactHandleV1,
  sampleCommandEnvelopeV1,
  sampleNegativeAcquisitionProfileV1,
  sampleNegativeLabApplyPlanRequestV1,
  sampleNegativeLabApplyResultV1,
  sampleNegativeLabCommandEnvelopeV1,
  sampleNegativeLabDryRunResultV1,
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
];

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

console.log(`Validated ${validSamples.length} RawEngine schema samples.`);
