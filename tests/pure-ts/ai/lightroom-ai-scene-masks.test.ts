import { expect, test } from 'bun:test';
import { editDocumentLayersV2Schema } from '../../../packages/rawengine-schema/src/editDocumentV2';
import {
  acceptLightroomAiSceneMaskResult,
  buildLightroomAiSceneMaskTransaction,
  createLightroomAiSceneMaskAuthority,
  createLightroomAiSceneMaskContainer,
  createLightroomAiSceneMaskJob,
  markLightroomAiSceneMaskCancelled,
  markLightroomAiSceneMaskUnavailable,
} from '../../../src/utils/ai/lightroomAiSceneMaskGeneration';
import { selectEditDocumentNode } from '../../../src/utils/editDocumentSelectors';
import {
  createDefaultEditDocumentV2,
  patchEditDocumentV2Node,
  prepareEditDocumentV2ForPersistence,
} from '../../../src/utils/editDocumentV2';

const authority = (requestId = 'request-1', capability: 'background' | 'sky' | 'subject' = 'subject') =>
  createLightroomAiSceneMaskAuthority({
    capability,
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

test('provider blocks become unavailable without exposing a retry action state', () => {
  const unavailable = markLightroomAiSceneMaskUnavailable(
    createLightroomAiSceneMaskJob(authority()),
    'Local subject model is unavailable.',
  );
  expect(unavailable.status).toBe('unavailable');
  expect(unavailable.errorMessage).toBe('Local subject model is unavailable.');
  expect(
    acceptLightroomAiSceneMaskResult(unavailable, {
      authority: authority(),
      generatedMaskArtifactId: 'late-artifact',
      parameters: {},
    }),
  ).toBeNull();
});

test('background applies as one inverted foreground component with provenance', () => {
  const result = {
    authority: authority('request-background', 'background'),
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

test('subject and sky preserve provider payloads in typed mask components', () => {
  const subjectResult = {
    authority: authority('request-subject', 'subject'),
    maskDataBase64: 'data:image/png;base64,subject',
    parameters: { rotation: 90, providerId: 'rawengine-local-ai' },
  };
  const subject = createLightroomAiSceneMaskContainer({
    capability: 'subject',
    imageDimensions: { height: 1200, width: 1600 },
    result: subjectResult,
  });
  expect(subject.subMasks[0]?.type).toBe('ai-subject');
  expect(subject.subMasks[0]?.invert).toBe(false);
  expect(subject.subMasks[0]?.parameters).toMatchObject({
    imageHeight: 1200,
    imageWidth: 1600,
    maskDataBase64: 'data:image/png;base64,subject',
  });

  const skyResult = {
    authority: authority('request-sky', 'sky'),
    maskDataBase64: 'data:image/png;base64,sky',
    parameters: {},
  };
  const sky = createLightroomAiSceneMaskContainer({ capability: 'sky', result: skyResult });
  expect(sky.subMasks[0]?.type).toBe('ai-sky');
  expect(sky.subMasks[0]?.invert).toBe(false);
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

test('scene mask persistence projects source-only layer fields before native save', () => {
  const result = {
    authority: authority('request-persistence', 'subject'),
    generatedMaskArtifactId: 'artifact-persistence',
    generatedMaskCoverage: 0.5,
    parameters: {},
  };
  const mask = createLightroomAiSceneMaskContainer({ capability: 'subject', result });
  const parsedMask = editDocumentLayersV2Schema.parse({ masks: [mask] }).masks[0];
  if (parsedMask === undefined) throw new Error('Expected scene mask.');
  const contaminated = {
    ...parsedMask,
    adjustments: { ...parsedMask.adjustments, aiPatches: [] },
  };
  const withMask = patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'layers', { masks: [contaminated] });
  const persisted = prepareEditDocumentV2ForPersistence(withMask);
  const persistedMask = persisted.layers.masks[0];
  expect(persistedMask?.adjustments).not.toHaveProperty('aiPatches');
  expect(persistedMask?.subMasks[0]?.parameters?.['generatedMaskArtifactId']).toBe('artifact-persistence');
});
