import { describe, expect, test } from 'bun:test';

import {
  createViewerSamplerSessionController,
  type ViewerSamplerSessionContext,
} from '../../../src/components/panel/editor/viewerSamplerSessionController';
import { createViewerSampleRequest } from '../../../src/utils/viewerSampler';

const context = (overrides: Partial<ViewerSamplerSessionContext> = {}): ViewerSamplerSessionContext => ({
  geometryEpoch: 7,
  graphRevision: 'graph:9',
  imageSessionId: 'image-session:a:1',
  samplerIdentity: 'sampler:a:1',
  sourceIdentity: '/fixture/A.ARW',
  suppressed: false,
  ...overrides,
});
const request = (x = 0.25) =>
  createViewerSampleRequest({
    geometryEpoch: 7,
    graphRevision: 'graph:9',
    imageIdentity: '/fixture/A.ARW',
    normalizedImagePoint: { x, y: 0.75 },
    requestedSpace: 'displayEncoded',
    sampleRadiusImagePx: 0,
    sourceImageSize: { height: 3000, width: 4000 },
    target: 'edited',
  });
const result = (requestIdentity: string) => ({
  clippedChannels: [] as Array<'r' | 'g' | 'b'>,
  imagePointPx: { x: 1000, y: 2250 },
  luma: 0.42,
  requestIdentity,
  rgb: [0.1, 0.2, 0.3] as [number, number, number],
  spaceLabel: 'Display encoded',
  status: 'available' as const,
});

describe('viewer sampler session controller', () => {
  test('publishes only the exact current operation and rejects duplicate native completion', () => {
    const controller = createViewerSamplerSessionController('edited');
    controller.synchronize(context());
    const operation = controller.begin(request(), 'edited', { x: 100, y: 200 }, context());
    expect(operation?.key).toMatchObject({
      geometryEpoch: 7,
      graphRevision: 'graph:9',
      imageSessionId: 'image-session:a:1',
      operationGeneration: 1,
      sourceIdentity: '/fixture/A.ARW',
    });
    if (operation === null) throw new Error('Expected sampler operation.');
    expect(controller.receive(operation, result(operation.request.requestIdentity), context())).toBeTrue();
    expect(controller.snapshot().result).toMatchObject({ status: 'available' });
    expect(controller.receive(operation, result(operation.request.requestIdentity), context())).toBeFalse();
  });

  test('rejects late A to B to A completion even at the same sampled coordinate', () => {
    const controller = createViewerSamplerSessionController('edited');
    controller.synchronize(context());
    const staleA = controller.begin(request(), 'edited', { x: 100, y: 200 }, context());
    if (staleA === null) throw new Error('Expected first A operation.');
    const successorB = context({
      imageSessionId: 'image-session:b:2',
      samplerIdentity: 'sampler:b:2',
      sourceIdentity: '/fixture/B.ARW',
    });
    controller.synchronize(successorB);
    const reopenedA = context({ imageSessionId: 'image-session:a:3', samplerIdentity: 'sampler:a:3' });
    controller.synchronize(reopenedA);
    const currentA = controller.begin(request(), 'edited', { x: 100, y: 200 }, reopenedA);
    if (currentA === null) throw new Error('Expected reopened A operation.');

    expect(currentA.key.operationGeneration).toBe(2);
    expect(controller.receive(staleA, result(staleA.request.requestIdentity), reopenedA)).toBeFalse();
    expect(controller.receive(currentA, result(currentA.request.requestIdentity), reopenedA)).toBeTrue();
  });

  test('locks interaction, cancels unlocked state, and invalidates locked pixels on suppression', () => {
    const controller = createViewerSamplerSessionController('softProof');
    controller.synchronize(context());
    const operation = controller.begin(request(), 'softProof', { x: 100, y: 200 }, context());
    if (operation === null) throw new Error('Expected sampler operation.');
    controller.receive(operation, result(operation.request.requestIdentity), context());
    expect(controller.toggleLock()).toBeTrue();
    expect(controller.begin(request(0.5), 'edited', { x: 200, y: 200 }, context())).toBeNull();
    expect(controller.cancel(true)).toBeFalse();
    expect(controller.snapshot()).toMatchObject({ locked: true, result: { status: 'available' } });

    expect(controller.synchronize(context({ suppressed: true }))).toBeTrue();
    expect(controller.snapshot()).toMatchObject({ locked: true, result: null });
    expect(controller.toggleLock()).toBeTrue();
    expect(controller.snapshot().locked).toBeFalse();
  });

  test('publishes typed failure only for current work and never after disposal', () => {
    const controller = createViewerSamplerSessionController('edited');
    controller.synchronize(context());
    const operation = controller.begin(request(), 'edited', { x: 100, y: 200 }, context());
    if (operation === null) throw new Error('Expected sampler operation.');
    expect(controller.fail(operation, context())).toBeTrue();
    expect(controller.snapshot().result).toMatchObject({ reason: 'frameUnavailable', status: 'unavailable' });

    const afterFailure = controller.begin(request(0.6), 'edited', { x: 240, y: 200 }, context());
    if (afterFailure === null) throw new Error('Expected successor operation.');
    controller.dispose();
    expect(controller.receive(afterFailure, result(afterFailure.request.requestIdentity), context())).toBeFalse();
    expect(controller.fail(afterFailure, context())).toBeFalse();
  });
});
