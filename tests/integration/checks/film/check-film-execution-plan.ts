import { strict as assert } from 'node:assert';
import {
  filmExecutionPlanV1Schema,
  filmExecutionStageOrderV1,
} from '../../../../packages/rawengine-schema/src/index.ts';

const plan = filmExecutionPlanV1Schema.parse({
  contract: 'rapidraw.film_execution_plan.v1',
  inputDomain: 'acescg_linear_v1',
  outputDomain: 'acescg_linear_v1',
  profileContentSha256: 'sha256:profile',
  compiledProfileSha256: 'sha256:compiled',
  stageOrder: [...filmExecutionStageOrderV1],
  haloOverlapPx: 32,
  borderPolicyVersion: 'reflect101_v1',
  scaleFilterVersion: 'variance_preserving_mip_v1',
  modelAbiVersion: 'film_model_abi_v1',
  backendAbiVersion: 'film_backend_abi_v1',
  planSha256: 'sha256:plan',
});
assert.equal(plan.stageOrder[0], 'capture_optical_scatter');
assert.equal(plan.stageOrder.at(-1), 'post_film_tap');
const reordered = structuredClone(plan);
[reordered.stageOrder[0], reordered.stageOrder[1]] = [reordered.stageOrder[1]!, reordered.stageOrder[0]!];
assert.throws(() => filmExecutionPlanV1Schema.parse(reordered));
console.log('film execution plan ok');
