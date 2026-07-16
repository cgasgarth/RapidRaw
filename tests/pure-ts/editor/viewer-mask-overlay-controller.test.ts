import { describe, expect, test } from 'bun:test';
import {
  createViewerMaskOverlayController,
  type ViewerMaskOverlayContext,
  type ViewerMaskOverlayGenerateCommand,
  type ViewerMaskOverlayTransition,
} from '../../../src/components/panel/editor/viewerMaskOverlayController';
import { Mask, SubMaskMode } from '../../../src/components/panel/right/layers/Masks';
import { createDefaultMaskEditNodes, INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { buildMaskOverlayInvokePayload } from '../../../src/utils/mask/maskOverlayRequest';

const context = (overrides: Partial<ViewerMaskOverlayContext> = {}): ViewerMaskOverlayContext => ({
  geometryEpoch: 7,
  imageSessionId: 'image-session:a:1',
  sourceIdentity: '/fixture/a.raw',
  sourceRevision: 'graph:4',
  ...overrides,
});

const payload = buildMaskOverlayInvokePayload({
  jsAdjustments: INITIAL_ADJUSTMENTS,
  maskDef: {
    adjustments: {},
    editNodes: createDefaultMaskEditNodes(),
    editNodeSchemaVersion: 1,
    id: 'mask-container:1',
    invert: false,
    name: 'Mask 1',
    opacity: 100,
    subMasks: [
      {
        id: 'mask:1',
        invert: false,
        mode: SubMaskMode.Additive,
        opacity: 100,
        parameters: {},
        type: Mask.Brush,
        visible: true,
      },
    ],
    visible: true,
  },
  maskOverlaySettings: { edgeThreshold: 0.65, mode: 'rubylith', opacity: 0.4 },
  patchesSentToBackend: new Set(),
  renderSize: { height: 200, offsetX: 0, offsetY: 0, scale: 0.5, width: 300 },
});

if (payload === null) throw new Error('mask overlay controller fixture must produce a payload');

const requiredCommand = (transition: ViewerMaskOverlayTransition): ViewerMaskOverlayGenerateCommand => {
  if (transition.command === null) throw new Error('expected a native mask-overlay command');
  return transition.command;
};

describe('viewer mask overlay controller', () => {
  test('serializes native work, keeps only the latest request, and publishes its exact key', () => {
    const controller = createViewerMaskOverlayController(context());
    const first = controller.request(context(), 'request:1', payload);
    expect(first.command?.request.key).toMatchObject({
      geometryEpoch: 7,
      imageSessionId: 'image-session:a:1',
      operationGeneration: 1,
      requestIdentity: 'request:1',
      sourceIdentity: '/fixture/a.raw',
      sourceRevision: 'graph:4',
      toolId: 'mask-overlay',
    });
    expect(controller.request(context(), 'request:2', payload).command).toBeNull();

    const successor = controller.resolve(requiredCommand(first).request.key, 'old');
    expect(successor.ignored).toBeTrue();
    expect(successor.descriptor.status).toBe('stale-ignored');
    expect(successor.command?.request.key).toMatchObject({ operationGeneration: 2, requestIdentity: 'request:2' });

    const current = controller.resolve(requiredCommand(successor).request.key, 'data:image/png;base64,current');
    expect(current.ignored).toBeFalse();
    expect(current.descriptor).toMatchObject({
      identity: 'request:2',
      imageSessionId: 'image-session:a:1',
      key: { operationGeneration: 2 },
      status: 'current',
      url: 'data:image/png;base64,current',
    });
  });

  test('rejects A to B to successor-A completions and starts only the exact successor request', () => {
    const controller = createViewerMaskOverlayController(context());
    const sourceA = controller.request(context(), 'request:a-old', payload);
    const sourceBContext = context({ imageSessionId: 'image-session:b:2', sourceIdentity: '/fixture/b.raw' });
    controller.synchronize(sourceBContext);
    controller.request(sourceBContext, 'request:b', payload);
    const successorAContext = context({ imageSessionId: 'image-session:a:3' });
    controller.synchronize(successorAContext);
    controller.request(successorAContext, 'request:a-successor', payload);

    const afterOld = controller.resolve(requiredCommand(sourceA).request.key, 'old-a');
    expect(afterOld.ignored).toBeTrue();
    expect(afterOld.descriptor).toMatchObject({
      identity: JSON.stringify({ imageSessionId: 'image-session:a:3', status: 'session-invalidated' }),
      imageSessionId: 'image-session:a:3',
      status: 'none',
      url: null,
    });
    expect(afterOld.command?.request.key).toMatchObject({
      imageSessionId: 'image-session:a:3',
      requestIdentity: 'request:a-successor',
    });
  });

  test('hidden, failed, and disposed requests fail closed while draining the latest native output', () => {
    const controller = createViewerMaskOverlayController(context());
    const hidden = controller.request(context(), 'request:hidden', null);
    expect(hidden.command).toBeNull();
    expect(hidden.descriptor).toMatchObject({ identity: 'request:hidden', status: 'none', url: null });

    const pending = controller.request(context(), 'request:failed', payload);
    const failed = controller.fail(requiredCommand(pending).request.key);
    expect(failed.descriptor).toMatchObject({ identity: 'request:failed', status: 'none', url: null });

    const disposed = controller.request(context(), 'request:disposed', payload);
    controller.request(context(), 'request:dispose-successor', payload);
    controller.dispose();
    const disposedCompletion = controller.resolve(requiredCommand(disposed).request.key, 'late');
    expect(disposedCompletion.ignored).toBeTrue();
    expect(requiredCommand(disposedCompletion).request.key.requestIdentity).toBe('request:dispose-successor');
    expect(
      controller.resolve(requiredCommand(disposedCompletion).request.key, 'dispose-successor-output').ignored,
    ).toBeTrue();
    expect(controller.snapshot().url).toBeNull();
  });
});
