import { beforeEach, describe, expect, test } from 'bun:test';

import type {
  EditCommandBusContext,
  EditCommandDispatchResult,
} from '../../../packages/rawengine-schema/src/editCommandBus';
import { RawEngineLocalAppServerBridge } from '../../../packages/rawengine-schema/src/localAppServerBridge';
import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { buildAgentImageContextSnapshot } from '../../../src/utils/agent/context/agentImageContextSnapshot';
import {
  agentCurveLevelsApplyRequestSchema,
  applyAgentCurveLevels,
} from '../../../src/utils/agent/tools/agentCurveLevelsApplyTool';
import { legacyAdjustmentsToEditDocumentV2 } from '../../../src/utils/editDocumentV2';

const sourcePath = '/fixtures/agent-curve-levels.ARW';
const session = createEditorImageSession({ generation: 51, path: sourcePath, source: 'cache' });

class DeferredCurveLevelsBridge extends RawEngineLocalAppServerBridge {
  private releaseApplyGate: () => void = () => undefined;
  private signalApplyEntered: () => void = () => undefined;
  readonly applyEntered = new Promise<void>((resolve) => {
    this.signalApplyEntered = resolve;
  });
  private readonly applyGate = new Promise<void>((resolve) => {
    this.releaseApplyGate = resolve;
  });

  releaseApply(): void {
    this.releaseApplyGate();
  }

  override async dispatch(command: unknown, context?: EditCommandBusContext): Promise<EditCommandDispatchResult> {
    if (
      typeof command === 'object' &&
      command !== null &&
      'commandType' in command &&
      command.commandType === 'editGraph.applyParameterPatch' &&
      'dryRun' in command &&
      command.dryRun === false
    ) {
      this.signalApplyEntered();
      await this.applyGate;
    }
    return super.dispatch(command, context);
  }
}

describe('agent curve/levels EditTransaction bridge', () => {
  beforeEach(() => {
    const adjustments = structuredClone(INITIAL_ADJUSTMENTS);
    const editDocumentV2 = legacyAdjustmentsToEditDocumentV2(adjustments);
    useEditorStore.getState().hydrateEditorRenderAuthority({
      adjustmentRevision: 0,
      editDocumentV2,
      finalPreviewUrl: 'blob:agent-curve-levels-current',
      hasRenderedFirstFrame: true,
      historyCheckpoints: [],
      historyIndex: 0,
      imageSession: session,
      imageSessionId: session.generation,
      lastEditApplicationReceipt: null,
      selectedImage: {
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
      },
      uncroppedAdjustedPreviewUrl: 'blob:agent-curve-levels-uncropped',
      history: [editDocumentV2],
    });
  });

  test('enforces the canonical black and white level directions at the agent boundary', () => {
    const request = {
      curveLevels: {
        parametricCurve: {
          luma: {
            blackLevel: 2,
            darks: -4,
            highlights: 6,
            lights: 5,
            shadows: 8,
            split1: 20,
            split2: 52,
            split3: 82,
            whiteLevel: -2,
          },
        },
      },
      expectedRecipeHash: 'recipe:test',
      operationId: 'agent-curve-levels-schema',
      requestId: 'agent-curve-levels-schema-request',
      sessionId: 'agent-curve-levels-test',
    };

    expect(agentCurveLevelsApplyRequestSchema.safeParse(request).success).toBe(true);
    expect(
      agentCurveLevelsApplyRequestSchema.safeParse({
        ...request,
        curveLevels: {
          parametricCurve: {
            luma: { ...request.curveLevels.parametricCurve.luma, blackLevel: -1 },
          },
        },
      }).success,
    ).toBe(false);
    expect(
      agentCurveLevelsApplyRequestSchema.safeParse({
        ...request,
        curveLevels: {
          parametricCurve: {
            luma: { ...request.curveLevels.parametricCurve.luma, whiteLevel: 1 },
          },
        },
      }).success,
    ).toBe(false);
  });

  test('rejects an accepted typed result after an intervening editor revision', async () => {
    const snapshot = buildAgentImageContextSnapshot();
    const bridge = new DeferredCurveLevelsBridge();
    const pending = applyAgentCurveLevels(
      {
        curveLevels: { toneCurve: 'soft_contrast' },
        expectedRecipeHash: snapshot.initialPreview.recipeHash,
        operationId: 'delayed-agent-curve-levels',
        requestId: 'delayed-agent-curve-levels-request',
        sessionId: 'agent-curve-levels-test',
      },
      bridge,
    );
    await bridge.applyEntered;
    const state = useEditorStore.getState();
    state.applyEditTransaction({
      baseAdjustmentRevision: state.adjustmentRevision,
      history: 'single-entry',
      imageSessionId: session.id,
      operations: [{ patch: { exposure: 0.2 }, type: 'patch-adjustments' }],
      persistence: 'commit',
      source: 'manual-control',
      transactionId: 'intervening-curve-levels-edit',
    });
    bridge.releaseApply();

    await expect(pending).rejects.toThrow('agent_tool_transaction.stale_revision:0:1');
    const after = useEditorStore.getState();
    expect(after.adjustmentSnapshot.value.exposure).toBe(0.2);
    expect(after.adjustmentSnapshot.value.toneCurve).toBe(INITIAL_ADJUSTMENTS.toneCurve);
    expect(after.lastEditApplicationReceipt?.transactionId).toBe('intervening-curve-levels-edit');
  });
});
