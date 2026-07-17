import { describe, expect, test } from 'bun:test';
import { Mask, SubMaskMode } from '../../../src/components/panel/right/layers/Masks';
import { createDefaultMaskEditNodes } from '../../../src/utils/adjustments';
import { createDefaultEditDocumentV2, patchEditDocumentV2Node } from '../../../src/utils/editDocumentV2';
import {
  buildGradientMaskEditTransaction,
  createGradientMaskWorkflow,
  type GradientMaskWorkflowIdentity,
} from '../../../src/utils/mask/gradientMaskInteraction';
import { buildRadialGradientMaskCommandFromParameters } from '../../../src/utils/mask/radialGradientMaskCommandBridge';

const sourcePath = '/fixture/gradient-workflow.ARW';
const baselineParameters = { endX: 400, endY: 800, range: 120, startX: 400, startY: 100 };
const identity: GradientMaskWorkflowIdentity = {
  containerId: 'layer:gradient',
  containerKind: 'masks',
  geometryEpoch: 4,
  imageSessionId: 'session:gradient',
  sourceIdentity: sourcePath,
  sourceRevision: 'graph:4',
  subMaskId: 'linear:1',
  tool: Mask.Linear,
};

const linearSubMask = {
  id: identity.subMaskId,
  invert: false,
  mode: SubMaskMode.Additive,
  name: 'Linear',
  opacity: 100,
  parameters: baselineParameters,
  type: Mask.Linear,
  visible: true,
};

const editDocumentV2 = patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'layers', {
  masks: [
    {
      adjustments: {},
      blendMode: 'normal',
      editNodes: createDefaultMaskEditNodes(),
      editNodeSchemaVersion: 1,
      id: identity.containerId,
      invert: false,
      name: 'Gradient layer',
      opacity: 100,
      subMasks: [structuredClone(linearSubMask)],
      visible: true,
    },
  ],
});

const state = {
  adjustmentRevision: 7,
  editDocumentV2,
  geometryEpoch: identity.geometryEpoch,
  imageSession: { id: identity.imageSessionId },
  selectedImage: { path: sourcePath },
  sourceRevision: identity.sourceRevision,
};

describe('gradient mask workflow', () => {
  test('keeps draw, preview, refine, apply and cancel phases explicit', () => {
    const workflow = createGradientMaskWorkflow({ parameters: baselineParameters });
    expect(workflow.phase).toBe('idle');
    workflow.begin();
    workflow.preview({ parameters: { ...baselineParameters, range: 180 } });
    workflow.refine({ invert: true });
    expect(workflow.phase).toBe('refining');
    expect(workflow.apply()).toEqual({
      invert: true,
      parameters: { ...baselineParameters, range: 180 },
    });
    expect(workflow.phase).toBe('applied');

    const cancelled = createGradientMaskWorkflow({ parameters: baselineParameters });
    cancelled.begin();
    cancelled.preview({ parameters: { ...baselineParameters, range: 220 } });
    cancelled.cancel();
    expect(cancelled.phase).toBe('cancelled');
    expect(cancelled.draft).toBeNull();
  });

  test('builds one typed atomic transaction for geometry and invert', () => {
    const transaction = buildGradientMaskEditTransaction(
      state,
      identity,
      { invert: true, parameters: { ...baselineParameters, range: 180 } },
      'gradient:gesture:1',
    );
    expect(transaction).toMatchObject({
      baseAdjustmentRevision: 7,
      history: 'single-entry',
      persistence: 'commit',
      source: 'layer-command',
      transactionId: 'gradient:gesture:1',
    });
    expect(transaction.operations).toHaveLength(1);
    expect(transaction.operations[0]).toMatchObject({ nodeType: 'layers', type: 'patch-edit-document-node' });
    const operation = transaction.operations[0];
    if (operation === undefined || operation.type !== 'patch-edit-document-node' || operation.nodeType !== 'layers')
      throw new Error('Expected layers transaction.');
    if (operation.patch.masks === undefined) throw new Error('Expected masks patch.');
    expect(operation.patch.masks[0]?.subMasks[0]).toMatchObject({
      invert: true,
      parameters: { range: 180 },
    });
  });

  test('rejects stale geometry/session/source before mutating the graph', () => {
    expect(() =>
      buildGradientMaskEditTransaction(
        { ...state, geometryEpoch: 5 },
        identity,
        { parameters: baselineParameters },
        'gradient:stale',
      ),
    ).toThrow('gradient_mask_transaction.stale_identity');
    expect(() =>
      buildGradientMaskEditTransaction(
        { ...state, sourceRevision: 'graph:old' },
        identity,
        { parameters: baselineParameters },
        'gradient:stale-revision',
      ),
    ).toThrow('gradient_mask_transaction.stale_identity');
  });

  test('builds a normalized radial preview/apply command envelope', () => {
    const command = buildRadialGradientMaskCommandFromParameters(
      { centerX: 1000, centerY: 500, feather: 0.35, radiusX: 600, radiusY: 300, rotation: 22 },
      {
        expectedGraphRevision: 'graph:4',
        imagePath: sourcePath,
        imageSize: { height: 2000, width: 4000 },
        maskName: 'Radial gradient',
        operationId: 'gesture:radial:1',
        sessionId: 'session:gradient',
      },
      { dryRun: true },
    );
    expect(command.dryRun).toBe(true);
    expect(command.parameters.gradient).toMatchObject({
      center: { x: 0.25, y: 0.25 },
      feather: 0.35,
      gradientKind: 'radial',
      radiusX: 0.15,
      radiusY: 0.15,
    });
  });
});
