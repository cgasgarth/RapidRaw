import { strict as assert } from 'node:assert';
import {
  applyFilmEmulationOperationToVariantsV1Schema,
  filmMultiTargetResultV1Schema,
} from '../../../../packages/rawengine-schema/src/index.ts';

const command = applyFilmEmulationOperationToVariantsV1Schema.parse({
  commandType: 'edit.apply_film_emulation_operation',
  contractVersion: 1,
  commandId: 'batch-1',
  targets: [
    { variantId: 'a', expectedGraphRevision: 'r1' },
    { variantId: 'b', expectedGraphRevision: 'r9' },
  ],
  operation: { kind: 'set_mix', mix: 0.75 },
});
assert.deepEqual(
  command.targets.map((target) => target.variantId),
  ['a', 'b'],
);
assert.throws(() =>
  applyFilmEmulationOperationToVariantsV1Schema.parse({
    ...command,
    targets: [...command.targets, command.targets[0]],
  }),
);

const result = filmMultiTargetResultV1Schema.parse({
  commandId: command.commandId,
  orderedResults: [
    {
      variantId: 'a',
      status: 'applied',
      previousGraphRevision: 'r1',
      resultingGraphRevision: 'r2',
      graphHash: 'blake3:a',
    },
    {
      variantId: 'b',
      status: 'stale_revision',
      previousGraphRevision: 'r9',
      error: { code: 'stale_revision', message: 'Target changed.' },
    },
  ],
});
assert.equal(result.orderedResults[1]?.status, 'stale_revision');
assert.throws(() =>
  filmMultiTargetResultV1Schema.parse({
    ...result,
    orderedResults: [{ ...result.orderedResults[1], resultingGraphRevision: 'r10' }],
  }),
);

console.log('film multi-target operation contract ok');
