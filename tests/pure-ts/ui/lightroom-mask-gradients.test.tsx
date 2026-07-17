import { describe, expect, test } from 'bun:test';
import { Mask, SubMaskMode } from '../../../src/components/panel/right/layers/Masks';
import { createDefaultMaskEditNodes, INITIAL_MASK_CONTAINER } from '../../../src/utils/adjustments';
import { createDefaultEditDocumentV2, patchEditDocumentV2Node } from '../../../src/utils/editDocumentV2';
import {
  buildEditorPersistenceRequest,
  editorPersistenceRequestSchema,
} from '../../../src/utils/editorPersistenceEffectRunner';
import { buildLayerEditTransactionRequest } from '../../../src/utils/layers/layerEditTransaction';
import { buildLayerStackSidecarFromMasks } from '../../../src/utils/layers/layerStackCommandBridge';
import {
  hydrateLayerStackMasksInEditDocument,
  persistLayerStackSidecarInEditDocumentCandidate,
} from '../../../src/utils/layers/layerStackSidecarAdjustments';
import {
  buildGradientMaskEditTransaction,
  createGradientMaskWorkflow,
  type GradientMaskWorkflowIdentity,
} from '../../../src/utils/mask/gradientMaskInteraction';
import { buildRadialGradientMaskCommandFromParameters } from '../../../src/utils/mask/radialGradientMaskCommandBridge';

const sourcePath = '/fixture/gradient-workflow.ARW';
const baselineParameters = {
  endX: 400,
  endY: 800,
  imageHeight: 2000,
  imageWidth: 4000,
  range: 120,
  startX: 400,
  startY: 100,
};
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
  imageSessionId: 7,
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
    expect(operation.patch.masks[0]?.subMasks[0]?.parameters).toMatchObject({
      imageHeight: 2000,
      imageWidth: 4000,
    });
  });

  test('merges a partial geometry patch without dropping existing metadata', () => {
    const transaction = buildGradientMaskEditTransaction(
      state,
      identity,
      { parameters: { range: 240 } },
      'gradient:gesture:partial',
    );
    const operation = transaction.operations[0];
    if (operation === undefined || operation.type !== 'patch-edit-document-node' || operation.nodeType !== 'layers')
      throw new Error('Expected layers transaction.');
    expect(operation.patch.masks?.[0]?.subMasks?.[0]?.parameters).toEqual({
      endX: 400,
      endY: 800,
      imageHeight: 2000,
      imageWidth: 4000,
      range: 240,
      startX: 400,
      startY: 100,
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
      rotation: 22,
    });
  });

  test('keeps the validated artifact envelope at the gradient save boundary', () => {
    const documentWithArtifacts = structuredClone(editDocumentV2);
    documentWithArtifacts.extensions['rawEngineArtifacts'] = { layerStackSidecars: [], schemaVersion: 1 };
    const request = buildEditorPersistenceRequest({
      editDocumentV2: documentWithArtifacts,
      path: sourcePath,
    });
    const serializedRequest = JSON.parse(JSON.stringify(request)) as unknown;
    expect(editorPersistenceRequestSchema.parse(serializedRequest).editDocumentV2.extensions).toEqual({
      rawEngineArtifacts: { layerStackSidecars: [], schemaVersion: 1 },
    });
  });

  test('persists and rehydrates gradient masks through the typed sidecar transaction', () => {
    const gradientMasks = [
      {
        ...structuredClone(INITIAL_MASK_CONTAINER),
        id: identity.containerId,
        name: 'Gradient layer',
        subMasks: [structuredClone(linearSubMask)],
      },
    ];
    const sidecar = buildLayerStackSidecarFromMasks(gradientMasks, {
      graphRevision: 'layer_stack_panel_initial',
      imagePath: sourcePath,
      operationId: 'gradient:persistence:1',
      sessionId: identity.imageSessionId,
    });
    const candidate = persistLayerStackSidecarInEditDocumentCandidate(editDocumentV2, gradientMasks, sidecar);
    const transaction = buildLayerEditTransactionRequest(state, candidate, 'gradient:persistence:1');
    const artifactsOperation = transaction.operations.find(
      (operation) => operation.type === 'set-layer-stack-artifacts',
    );
    if (artifactsOperation === undefined || artifactsOperation.type !== 'set-layer-stack-artifacts') {
      throw new Error('Expected typed layer-stack artifacts operation.');
    }
    if (artifactsOperation.rawEngineArtifacts === null || artifactsOperation.rawEngineArtifacts === undefined) {
      throw new Error('Expected typed layer-stack artifact payload.');
    }
    expect(artifactsOperation.rawEngineArtifacts.layerStackSidecars).toHaveLength(1);
    const persistedDocument = structuredClone(editDocumentV2);
    persistedDocument.extensions['rawEngineArtifacts'] = candidate.rawEngineArtifacts;
    const reopened = hydrateLayerStackMasksInEditDocument(
      createDefaultEditDocumentV2(),
      { editDocumentV2: persistedDocument },
      sourcePath,
    );
    expect(reopened.layers.masks[0]?.subMasks[0]?.parameters).toMatchObject({
      imageHeight: 2000,
      imageWidth: 4000,
      range: 120,
    });
  });
});
