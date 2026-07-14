#!/usr/bin/env bun

import {
  applyFilmEmulationOperationV1Schema,
  filmEmulationOperationV1Schema,
} from '../../../../packages/rawengine-schema/src/index.ts';

const profileRef = {
  id: 'rapidraw.reference_film.v1',
  version: '1',
  contentSha256: 'sha256:d84121641d1318f3be759fb5705f04f01721cd35a57e1b238343590bc2b988ef',
} as const;

const operationKinds = [
  { kind: 'set_profile', profileRef },
  { kind: 'set_mix', mix: 0.65 },
  { kind: 'set_enabled', enabled: false },
  { kind: 'set_stage_params', stage: 'reference_luminance_shaper_v1', patch: { p: 0.5 } },
  { kind: 'set_stack_position', position: 'scene_creative_end' },
  { kind: 'set_stack_position', position: 'scene_creative_custom', afterNodeId: 'scene-curve' },
  { kind: 'reset_to_profile' },
  { kind: 'remove_node' },
] as const;

for (const operation of operationKinds) filmEmulationOperationV1Schema.parse(operation);

const base = {
  actor: { id: 'contract-test', kind: 'test' as const, sessionId: 'film-operation-contract' },
  approval: { approvalClass: 'edit_apply' as const, reason: 'contract test', state: 'approved' as const },
  commandId: 'film-operation-contract-1',
  commandType: 'edit.apply_film_emulation_operation' as const,
  contractVersion: 1 as const,
  correlationId: 'film-operation-contract-correlation',
  dryRun: false,
  expectedGraphRevision: 'film.graph.v1:0',
  idempotencyKey: 'film-operation-contract-idem',
  schemaVersion: 1 as const,
  target: { kind: 'image' as const, variantId: 'image-variant-1' },
};

applyFilmEmulationOperationV1Schema.parse({ ...base, operation: operationKinds[0] });
applyFilmEmulationOperationV1Schema.parse({
  ...base,
  approval: { approvalClass: 'preview_only', reason: 'contract test', state: 'not_required' },
  commandId: 'film-operation-contract-dry-run',
  dryRun: true,
  operation: operationKinds[1],
});

const invalid = [
  { ...base, operation: { ...operationKinds[1], mix: Number.NaN } },
  { ...base, operation: { ...operationKinds[2], unexpected: true } },
  { ...base, operation: { kind: 'set_stage_params', stage: 'post_view', patch: { p: 0.5 } } },
  { ...base, operation: { kind: 'set_stack_position', position: 'scene_creative_custom' } },
  {
    ...base,
    target: { kind: 'image', variantId: 'image-variant-1', imagePath: '/not-owned' },
    operation: operationKinds[0],
  },
];
for (const command of invalid) {
  if (applyFilmEmulationOperationV1Schema.safeParse(command).success)
    throw new Error('invalid Film operation was accepted');
}

console.log(`film operation contract ok (${operationKinds.length} members, strict invalid cases rejected)`);
