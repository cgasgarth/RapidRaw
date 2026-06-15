#!/usr/bin/env bun

import {
  focusStackArtifactV1Schema,
  hdrMergeArtifactV1Schema,
  superResolutionArtifactV1Schema,
} from '../packages/rawengine-schema/src/rawEngineSchemas.ts';
import {
  sampleFocusStackArtifactV1,
  sampleHdrMergeArtifactV1,
  sampleSuperResolutionArtifactV1,
} from '../packages/rawengine-schema/src/samplePayloads.ts';

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
    invalidationReasons: [reason],
    state: 'stale',
  };
  return stale;
};

for (const testCase of CASES) {
  const current = expectValid(`${testCase.family} current sample`, testCase.schema, testCase.artifact);

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
  if (stale.outputArtifact.contentHash !== current.outputArtifact.contentHash) {
    throw new Error(`${testCase.family}: invalidation must not mutate the existing output artifact hash`);
  }
}

console.log(`derived artifact invalidation ok (${CASES.length})`);
