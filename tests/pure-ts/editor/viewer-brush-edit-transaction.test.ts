import { beforeEach, describe, expect, test } from 'bun:test';

import { createViewerBrushCommandAdapter } from '../../../src/components/panel/editor/viewerBrushCommandAdapter';
import {
  createViewerBrushInteractionController,
  type ViewerBrushCurrentContext,
} from '../../../src/components/panel/editor/viewerBrushInteractionController';
import { Mask, SubMaskMode } from '../../../src/components/panel/right/layers/Masks';
import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots';
import { createDefaultMaskEditNodes, INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { legacyAdjustmentsToEditDocumentV2 } from '../../../src/utils/editDocumentV2';
import { buildViewerBrushEditTransaction } from '../../../src/utils/viewerBrushEditTransaction';

const sourcePath = '/fixture/viewer-brush.ARW';
const containerId = 'layer:brush';
const subMaskId = 'submask:brush';
const geometryEpoch = 4;
const sourceRevision = 'graph:brush:0';
const selectedImage = {
  exif: null,
  height: 3000,
  isRaw: true,
  isReady: true,
  metadata: null,
  originalUrl: null,
  path: sourcePath,
  rawDevelopmentReport: null,
  thumbnailUrl: '',
  width: 4000,
};

const requireStoredBrushLines = (parameters: Record<string, unknown> | undefined): readonly unknown[] => {
  const lines = parameters?.['lines'];
  if (!Array.isArray(lines)) throw new Error('Expected stored brush lines.');
  return lines;
};

const installState = (explicitSession: boolean): string => {
  const imageSession = explicitSession
    ? createEditorImageSession({ generation: 51, path: sourcePath, source: 'cache' })
    : null;
  const imageSessionId = 51;
  const adjustments = {
    ...structuredClone(INITIAL_ADJUSTMENTS),
    masks: [
      {
        adjustments: {},
        blendMode: 'normal' as const,
        editNodes: createDefaultMaskEditNodes(),
        editNodeSchemaVersion: 1 as const,
        id: containerId,
        invert: false,
        name: 'Brush layer',
        opacity: 100,
        subMasks: [
          {
            id: subMaskId,
            invert: false,
            mode: SubMaskMode.Additive,
            opacity: 100,
            parameters: { lines: [] },
            type: Mask.Brush,
            visible: true,
          },
        ],
        visible: true,
      },
    ],
  };
  const editDocumentV2 = legacyAdjustmentsToEditDocumentV2(adjustments);
  useEditorStore.getState().hydrateEditorRenderAuthority({
    adjustmentRevision: 0,
    editDocumentV2,
    finalPreviewUrl: 'blob:brush-before-final',
    historyCheckpoints: [],
    historyIndex: 0,
    imageSession,
    imageSessionId,
    lastEditApplicationReceipt: null,
    navigatorPreviewArtifact: {
      graphIdentity: 'brush-before-graph',
      id: 'brush-before-navigator',
      imageSessionId: imageSession?.id ?? `editor-image-session:${String(imageSessionId)}`,
      url: 'blob:brush-before-navigator',
    },
    selectedImage,
    history: [editDocumentV2],
  });
  return imageSession?.id ?? `editor-image-session:${String(imageSessionId)}`;
};

const captureCommit = (imageSessionId: string, overrides: Partial<ViewerBrushCurrentContext> = {}) => {
  const state = useEditorStore.getState();
  const current: ViewerBrushCurrentContext = {
    active: true,
    adjustmentRevision: state.adjustmentRevision,
    containerId,
    containerKind: 'masks',
    geometryEpoch,
    imageSessionId,
    maskId: subMaskId,
    sourceIdentity: sourcePath,
    sourceRevision,
    toolId: 'brush',
    ...overrides,
  };
  const controller = createViewerBrushInteractionController();
  controller.begin(
    current,
    {
      altKey: false,
      imagePoint: { pressure: 0.25, x: 100, y: 120 },
      pointerId: 7,
      pointerType: 'pen',
      shiftKey: false,
      viewPoint: { x: 10, y: 12 },
    },
    { canonicalTool: 'brush', feather: 0.5, imageSpaceSize: 24 },
  );
  controller.move(current, {
    altKey: false,
    imagePoint: { pressure: 0.8, x: 180, y: 220 },
    pointerId: 7,
    pointerType: 'pen',
    shiftKey: false,
    viewPoint: { x: 20, y: 22 },
  });
  const [command] = controller.end(current);
  if (command?.kind !== 'commit') throw new Error('expected brush commit');
  const containers =
    current.containerKind === 'masks' ? state.adjustmentSnapshot.value.masks : state.adjustmentSnapshot.value.aiPatches;
  const subMask = containers
    .find((container) => container.id === current.containerId)
    ?.subMasks.find((candidate) => candidate.id === current.maskId);
  if (subMask === undefined) throw new Error('expected brush sub-mask');
  const result = createViewerBrushCommandAdapter().commit(command, {
    current,
    imagePath: sourcePath,
    imageSize: { height: selectedImage.height, width: selectedImage.width },
    parameters: subMask.parameters ?? {},
    subMask,
  });
  if (result === null) throw new Error('expected semantic brush commit');
  return result;
};

describe('viewer brush edit transaction', () => {
  beforeEach(() => {
    installState(true);
  });

  test.each([true, false])('commits one explicit/fallback-session stroke atomically (explicit=%s)', (explicit) => {
    const imageSessionId = installState(explicit);
    const command = captureCommit(imageSessionId);
    const before = useEditorStore.getState();
    const result = before.applyEditTransaction(
      buildViewerBrushEditTransaction(
        { ...before, geometryEpoch, sourceRevision },
        command,
        `viewer-brush:${explicit ? 'explicit' : 'fallback'}`,
      ),
    );
    const state = useEditorStore.getState();

    expect(result).toMatchObject({ changedKeys: ['masks'], nextAdjustmentRevision: 1, noOp: false });
    const storedLines = requireStoredBrushLines(state.adjustmentSnapshot.value.masks[0]?.subMasks[0]?.parameters);
    expect(storedLines).toHaveLength(1);
    const firstLine = storedLines[0];
    const storedPoints =
      typeof firstLine === 'object' && firstLine !== null && 'points' in firstLine ? firstLine.points : undefined;
    expect(storedPoints).toMatchObject([{ pressure: 0.25 }, { pressure: 0.8 }]);
    expect(state.history).toHaveLength(2);
    expect(state.historyIndex).toBe(1);
    expect(state.lastEditApplicationReceipt).toMatchObject({
      imageSessionId,
      persistence: 'commit',
      source: 'layer-command',
    });
    expect(state.finalPreviewUrl).toBeNull();
    expect(state.navigatorPreviewArtifact).toBeNull();

    state.undo();
    expect(
      requireStoredBrushLines(useEditorStore.getState().adjustmentSnapshot.value.masks[0]?.subMasks[0]?.parameters),
    ).toEqual([]);
  });

  test('treats an exact current-state replay as a no-op without history or output invalidation', () => {
    const command = captureCommit(useEditorStore.getState().imageSession!.id);
    const before = useEditorStore.getState();
    before.applyEditTransaction(
      buildViewerBrushEditTransaction({ ...before, geometryEpoch, sourceRevision }, command, 'viewer-brush:first'),
    );
    useEditorStore.setState({
      finalPreviewUrl: 'blob:brush-current-final',
      navigatorPreviewArtifact: {
        graphIdentity: 'brush-current-graph',
        id: 'brush-current-navigator',
        imageSessionId: before.imageSession!.id,
        url: 'blob:brush-current-navigator',
      },
    });
    const current = useEditorStore.getState();
    const replay = {
      ...command,
      key: { ...command.key, adjustmentRevision: current.adjustmentRevision, sourceRevision: 'graph:brush:1' },
    };
    const result = current.applyEditTransaction(
      buildViewerBrushEditTransaction(
        { ...current, geometryEpoch, sourceRevision: 'graph:brush:1' },
        replay,
        'viewer-brush:noop',
      ),
    );

    expect(result.noOp).toBe(true);
    expect(useEditorStore.getState().history).toHaveLength(2);
    expect(useEditorStore.getState().finalPreviewUrl).toBe('blob:brush-current-final');
    expect(useEditorStore.getState().navigatorPreviewArtifact?.id).toBe('brush-current-navigator');
  });

  test('commits a Flow stroke to its exact aiPatches container transaction', () => {
    const state = useEditorStore.getState();
    const aiContainerId = 'patch:brush';
    const aiSubMaskId = 'submask:flow';
    const adjustments = {
      ...state.adjustmentSnapshot.value,
      masks: [],
      aiPatches: [
        {
          id: aiContainerId,
          invert: false,
          isLoading: false,
          name: 'AI flow patch',
          patchData: null,
          prompt: '',
          subMasks: [
            {
              id: aiSubMaskId,
              invert: false,
              mode: SubMaskMode.Additive,
              opacity: 100,
              parameters: { flow: 20, lines: [] },
              type: Mask.Flow,
              visible: true,
            },
          ],
          visible: true,
        },
      ],
    };
    const editDocumentV2 = legacyAdjustmentsToEditDocumentV2(adjustments);
    useEditorStore.getState().hydrateEditorRenderAuthority({
      editDocumentV2,
      historyIndex: 0,
      history: [editDocumentV2],
    });
    const current = useEditorStore.getState();
    const command = captureCommit(current.imageSession!.id, {
      containerId: aiContainerId,
      containerKind: 'aiPatches',
      maskId: aiSubMaskId,
    });
    const result = current.applyEditTransaction(
      buildViewerBrushEditTransaction({ ...current, geometryEpoch, sourceRevision }, command, 'viewer-brush:ai-flow'),
    );

    expect(result).toMatchObject({ changedKeys: ['aiPatches'], nextAdjustmentRevision: 1, noOp: false });
    expect(
      requireStoredBrushLines(useEditorStore.getState().adjustmentSnapshot.value.aiPatches[0]?.subMasks[0]?.parameters),
    ).toHaveLength(1);
    expect(useEditorStore.getState().history).toHaveLength(2);
  });

  test('rejects stale revision, source, session, graph, geometry, and target before mutation', () => {
    const command = captureCommit(useEditorStore.getState().imageSession!.id);
    const state = useEditorStore.getState();
    const variants = [
      { command: { ...command, key: { ...command.key, adjustmentRevision: 1 } }, reason: 'stale_adjustment_revision' },
      {
        command: { ...command, key: { ...command.key, imageSessionId: 'session:other' } },
        reason: 'stale_image_session',
      },
      {
        command: { ...command, key: { ...command.key, sourceIdentity: '/fixture/other.ARW' } },
        reason: 'stale_source',
      },
      {
        command: { ...command, key: { ...command.key, sourceRevision: 'graph:other' } },
        reason: 'stale_source_revision',
      },
      { command: { ...command, key: { ...command.key, geometryEpoch: 5 } }, reason: 'stale_geometry' },
      { command: { ...command, key: { ...command.key, containerId: 'layer:other' } }, reason: 'stale_target' },
      { command: { ...command, key: { ...command.key, maskId: 'submask:other' } }, reason: 'stale_target' },
    ];
    for (const variant of variants) {
      expect(() =>
        buildViewerBrushEditTransaction(
          { ...state, geometryEpoch, sourceRevision },
          variant.command,
          `viewer-brush:${variant.reason}`,
        ),
      ).toThrow(`viewer_brush_transaction.${variant.reason}`);
    }
    expect(useEditorStore.getState().adjustmentRevision).toBe(0);
    expect(useEditorStore.getState().history).toHaveLength(1);
  });
});
