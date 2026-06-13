import { z } from 'zod';

import {
  artifactHandleV1Schema,
  commandEnvelopeV1Schema,
  panoramaArtifactV1Schema,
  queryEnvelopeV1Schema,
  rawEngineToolRegistryV1Schema,
} from '../src/rawEngineSchemas.js';
import {
  sampleArtifactHandleV1,
  sampleCommandEnvelopeV1,
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

console.log(`Validated ${validSamples.length} RawEngine schema samples.`);
