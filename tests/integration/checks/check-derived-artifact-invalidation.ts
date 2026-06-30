#!/usr/bin/env bun

import { deriveArtifactInvalidationReasons } from '../../../packages/rawengine-schema/src/derivedArtifactInvalidation.ts';
import {
  focusStackArtifactV1Schema,
  hdrMergeArtifactV1Schema,
  panoramaArtifactV1Schema,
  superResolutionArtifactV1Schema,
} from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import {
  sampleFocusStackArtifactV1,
  sampleHdrMergeArtifactV1,
  samplePanoramaArtifactV1,
  sampleSuperResolutionArtifactV1,
} from '../../../packages/rawengine-schema/src/samplePayloads.ts';

const CASES = [
  {
    artifact: sampleHdrMergeArtifactV1,
    family: 'hdr',
    reason: 'source_content_hash_changed',
    schema: hdrMergeArtifactV1Schema,
  },
  {
    artifact: sampleFocusStackArtifactV1,
    family: 'focus_stack',
    reason: 'source_graph_revision_changed',
    schema: focusStackArtifactV1Schema,
  },
  {
    artifact: sampleSuperResolutionArtifactV1,
    family: 'super_resolution',
    reason: 'output_artifact_changed',
    schema: superResolutionArtifactV1Schema,
  },
  {
    artifact: samplePanoramaArtifactV1,
    family: 'panorama',
    reason: 'source_graph_revision_changed',
    schema: panoramaArtifactV1Schema,
  },
];

const clone = (value) => structuredClone(value);

const expectValid = (label, schema, value) => {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(`${label}: expected valid artifact, got ${result.error.issues[0]?.message ?? 'unknown error'}`);
  }
  return result.data;
};

const expectInvalid = (label, schema, value, expectedMessage) => {
  const result = schema.safeParse(value);
  if (result.success) {
    throw new Error(`${label}: expected invalid artifact`);
  }

  const messages = result.error.issues.map((issue) => issue.message).join('; ');
  if (!messages.includes(expectedMessage)) {
    throw new Error(`${label}: expected "${expectedMessage}", got "${messages}"`);
  }
};

const markStale = (artifact, reason) => {
  const stale = clone(artifact);
  stale.staleState = {
    checkedAt: '2026-06-15T23:10:00.000Z',
    invalidationReasons: Array.isArray(reason) ? reason : [reason],
    state: 'stale',
  };
  return stale;
};

const outputContentHashFor = (artifact) =>
  artifact.outputArtifact?.contentHash ?? artifact.outputArtifacts?.[0]?.contentHash;

const currentStateFor = (artifact) => ({
  outputContentHash: outputContentHashFor(artifact),
  sourceState: clone(artifact.sourceState),
});

const invalidationArtifactFor = (artifact) => ({
  outputArtifact: {
    contentHash: outputContentHashFor(artifact),
  },
  sourceState: clone(artifact.sourceState),
});

const mutateFirstSource = (currentState, patch) => {
  const [firstSource] = currentState.sourceState;
  if (firstSource === undefined) {
    throw new Error('Expected at least one source state entry.');
  }

  Object.assign(firstSource, patch);
  return currentState;
};

for (const testCase of CASES) {
  const current = expectValid(`${testCase.family} current sample`, testCase.schema, testCase.artifact);
  const unchangedReasons = deriveArtifactInvalidationReasons(
    invalidationArtifactFor(current),
    currentStateFor(current),
  );

  if (unchangedReasons.length !== 0) {
    throw new Error(`${testCase.family}: unchanged source state must not invalidate the artifact`);
  }

  const currentWithReason = clone(current);
  currentWithReason.staleState = {
    checkedAt: '2026-06-15T23:10:00.000Z',
    invalidationReasons: [testCase.reason],
    state: 'current',
  };
  expectInvalid(`${testCase.family} current-with-reason`, testCase.schema, currentWithReason, 'Current');

  const staleWithoutReason = clone(current);
  staleWithoutReason.staleState = {
    checkedAt: '2026-06-15T23:10:00.000Z',
    invalidationReasons: [],
    state: 'stale',
  };
  expectInvalid(`${testCase.family} stale-without-reason`, testCase.schema, staleWithoutReason, 'Stale');

  const stale = expectValid(
    `${testCase.family} stale-with-reason`,
    testCase.schema,
    markStale(current, testCase.reason),
  );
  if (outputContentHashFor(stale) !== outputContentHashFor(current)) {
    throw new Error(`${testCase.family}: invalidation must not mutate the existing output artifact hash`);
  }

  const sourceHashReasons = deriveArtifactInvalidationReasons(
    invalidationArtifactFor(current),
    mutateFirstSource(currentStateFor(current), { contentHash: 'sha256:changed-source-content' }),
  );
  if (!sourceHashReasons.includes('source_content_hash_changed')) {
    throw new Error(`${testCase.family}: source content hash changes must invalidate the artifact`);
  }
  expectValid(
    `${testCase.family} stale-after-source-hash-change`,
    testCase.schema,
    markStale(current, sourceHashReasons),
  );

  const graphRevisionReasons = deriveArtifactInvalidationReasons(
    invalidationArtifactFor(current),
    mutateFirstSource(currentStateFor(current), { graphRevision: 'graph_rev_changed' }),
  );
  if (!graphRevisionReasons.includes('source_graph_revision_changed')) {
    throw new Error(`${testCase.family}: source graph revision changes must invalidate the artifact`);
  }
  expectValid(
    `${testCase.family} stale-after-graph-revision-change`,
    testCase.schema,
    markStale(current, graphRevisionReasons),
  );

  const sourceSetReasons = deriveArtifactInvalidationReasons(invalidationArtifactFor(current), {
    outputContentHash: outputContentHashFor(current),
    sourceState: current.sourceState.slice(1),
  });
  if (!sourceSetReasons.includes('source_set_changed')) {
    throw new Error(`${testCase.family}: source set changes must invalidate the artifact`);
  }
  expectValid(
    `${testCase.family} stale-after-source-set-change`,
    testCase.schema,
    markStale(current, sourceSetReasons),
  );

  const outputArtifactReasons = deriveArtifactInvalidationReasons(invalidationArtifactFor(current), {
    outputContentHash: 'sha256:changed-output-artifact',
    sourceState: current.sourceState,
  });
  if (!outputArtifactReasons.includes('output_artifact_changed')) {
    throw new Error(`${testCase.family}: output artifact changes must invalidate the artifact`);
  }
  expectValid(
    `${testCase.family} stale-after-output-artifact-change`,
    testCase.schema,
    markStale(current, outputArtifactReasons),
  );
}

console.log(`derived artifact invalidation ok (${CASES.length})`);
