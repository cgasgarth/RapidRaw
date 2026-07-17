import { expect, test } from 'bun:test';
import {
  acceptLightroomAiSceneMaskResult,
  buildLightroomAiSceneMaskTransaction,
  createLightroomAiSceneMaskAuthority,
  createLightroomAiSceneMaskContainer,
  createLightroomAiSceneMaskJob,
  markLightroomAiSceneMaskCancelled,
} from '../../../src/utils/ai/lightroomAiSceneMaskGeneration';
import { selectEditDocumentNode } from '../../../src/utils/editDocumentSelectors';
import { createDefaultEditDocumentV2 } from '../../../src/utils/editDocumentV2';

const authority = (requestId = 'request-1') =>
  createLightroomAiSceneMaskAuthority({
    capability: 'subject',
    cancellationToken: 'cancel-1',
    imageSessionId: 'session-1',
    providerId: 'local',
    renderRevision: 7,
    requestId,
    sourceAssetIdentity: 'asset-1',
    sourceGraphRevision: 'graph-7',
  });

test('scene mask authority rejects late results after a source/session switch', () => {
  const job = createLightroomAiSceneMaskJob(authority());
  expect(
    acceptLightroomAiSceneMaskResult(job, {
      authority: authority('request-2'),
      generatedMaskArtifactId: 'artifact-2',
      parameters: {},
    }),
  ).toBeNull();
  expect(
    acceptLightroomAiSceneMaskResult(job, {
      authority: authority(),
      generatedMaskArtifactId: 'artifact-1',
      parameters: {},
    })?.status,
  ).toBe('preview');
});

test('malformed provider results fail closed before preview state', () => {
  const job = createLightroomAiSceneMaskJob(authority());
  expect(
    acceptLightroomAiSceneMaskResult(job, { authority: authority(), parameters: { unexpected: true } }),
  ).toBeNull();
});

test('cancelled scene jobs are terminal and cannot be mistaken for current previews', () => {
  const cancelled = markLightroomAiSceneMaskCancelled(createLightroomAiSceneMaskJob(authority()));
  expect(cancelled.status).toBe('cancelled');
  expect(
    acceptLightroomAiSceneMaskResult(cancelled, {
      authority: authority(),
      generatedMaskArtifactId: 'late-artifact',
      parameters: {},
    }),
  ).toBeNull();
});

test('background applies as one inverted foreground component with provenance', () => {
  const result = {
    authority: { ...authority(), capability: 'background' as const },
    generatedMaskArtifactId: 'artifact-background',
    generatedMaskCoverage: 0.42,
    parameters: { feather: 4 },
  };
  const container = createLightroomAiSceneMaskContainer({ capability: 'background', result });
  expect(container.subMasks).toHaveLength(1);
  expect(container.subMasks[0]?.invert).toBe(true);
  expect(container.subMasks[0]?.type).toBe('ai-foreground');
  const provenance = (container.subMasks[0]?.parameters as Record<string, unknown>)['rawEngine'];
  expect(provenance).toMatchObject({
    capability: 'background',
    providerId: 'local',
  });
});

test('Apply builds a typed single-entry layer transaction without mutating the source document', () => {
  const document = createDefaultEditDocumentV2();
  const result = {
    authority: authority(),
    generatedMaskArtifactId: 'artifact-subject',
    generatedMaskCoverage: 0.5,
    parameters: {},
  };
  const transaction = buildLightroomAiSceneMaskTransaction({
    baseAdjustmentRevision: 7,
    capability: 'subject',
    document,
    imageSessionId: 'session-1',
    result,
  });
  expect(transaction.source).toBe('ai-edit');
  expect(transaction.history).toBe('single-entry');
  expect(transaction.operations).toHaveLength(1);
  expect(selectEditDocumentNode(document, 'layers').params.masks).toHaveLength(0);
});
