#!/usr/bin/env bun

import {
  previewScopeQueryV1Schema,
  previewScopeResultV1Schema,
} from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import {
  samplePreviewScopeQueryV1,
  samplePreviewScopeResultV1,
} from '../../../packages/rawengine-schema/src/samplePayloads.ts';

const failures = [];

const expectValid = (name, schema, value) => {
  const result = schema.safeParse(value);
  if (!result.success) {
    failures.push(`${name}: expected valid payload.`);
  }
};

const expectInvalid = (name, schema, value) => {
  const result = schema.safeParse(value);
  if (result.success) {
    failures.push(`${name}: expected invalid payload.`);
  }
};

expectValid('preview scope query', previewScopeQueryV1Schema, samplePreviewScopeQueryV1);
expectValid('preview scope result', previewScopeResultV1Schema, samplePreviewScopeResultV1);

const sampleHistogram = samplePreviewScopeResultV1.histogram;
if (sampleHistogram === undefined || sampleHistogram.channels.length < 2) {
  failures.push('preview scope sample must include at least two histogram channels.');
}

expectInvalid('empty scope query', previewScopeQueryV1Schema, {
  ...samplePreviewScopeQueryV1,
  parameters: {
    ...samplePreviewScopeQueryV1.parameters,
    includeScopes: [],
  },
});

expectInvalid('histogram bin mismatch', previewScopeResultV1Schema, {
  ...samplePreviewScopeResultV1,
  histogram: {
    ...sampleHistogram,
    channels: sampleHistogram?.channels.map((channel, index) =>
      index === 0
        ? {
            ...channel,
            bins: channel.bins.slice(1),
          }
        : channel,
    ),
  },
});

expectInvalid('duplicate histogram channel', previewScopeResultV1Schema, {
  ...samplePreviewScopeResultV1,
  histogram: {
    ...sampleHistogram,
    channels: [
      sampleHistogram?.channels[0],
      {
        ...sampleHistogram?.channels[1],
        channel: sampleHistogram?.channels[0]?.channel,
      },
    ],
  },
});

expectInvalid('inverted histogram percentile', previewScopeResultV1Schema, {
  ...samplePreviewScopeResultV1,
  histogram: {
    ...sampleHistogram,
    channels: sampleHistogram?.channels.map((channel, index) =>
      index === 0
        ? {
            ...channel,
            percentile01: 0.9,
            percentile99: 0.1,
          }
        : channel,
    ),
  },
});

expectInvalid('mismatched vectorscope channel', previewScopeResultV1Schema, {
  ...samplePreviewScopeResultV1,
  vectorscope: {
    ...samplePreviewScopeResultV1.vectorscope,
    channel: 'rgb',
  },
});

if (failures.length > 0) {
  console.error('Preview scope validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Preview scope validation ok.');
