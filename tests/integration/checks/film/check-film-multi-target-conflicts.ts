import { strict as assert } from 'node:assert';
import { filmMultiTargetResultV1Schema } from '../../../../packages/rawengine-schema/src/index.ts';

for (const status of [
  'stale_revision',
  'profile_unavailable',
  'illegal_placement',
  'unsupported_domain',
  'validation_failed',
] as const) {
  const result = filmMultiTargetResultV1Schema.parse({
    commandId: 'batch-conflict',
    orderedResults: [
      {
        variantId: status,
        status,
        previousGraphRevision: 'rev-1',
        error: { code: status, message: `Rejected: ${status}` },
      },
    ],
  });
  assert.equal(result.orderedResults[0]?.status, status);
}

console.log('film multi-target conflict contract ok');
