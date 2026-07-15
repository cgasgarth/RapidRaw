import { describe, expect, test } from 'bun:test';
import {
  resolveViewerInteractionRuntime,
  resolveViewerSamplerSuppression,
  type ViewerToolControllerSnapshot,
} from '../../../src/components/panel/editor/useViewerToolRuntimeController';
import type { ViewerActiveTool } from '../../../src/components/panel/editor/viewerInputResolver';

const interaction = (overrides: Record<string, unknown> = {}) => ({
  geometryEpoch: 11,
  imageSessionId: 'image-session:a:4',
  isCropping: false,
  isMaxZoom: true,
  isSliderDragging: false,
  isStraightenActive: false,
  isTemporaryHand: false,
  requestedActiveTool: 'none' as ViewerActiveTool,
  sourceIdentity: '/fixture/a.raw',
  sourceRevision: 'graph:9',
  ...overrides,
});

const snapshot = (overrides: Partial<ViewerToolControllerSnapshot> = {}): ViewerToolControllerSnapshot => ({
  focusRetouchActive: false,
  maskShapeActive: false,
  pickerActiveTool: null,
  retouchActive: false,
  whiteBalanceActive: false,
  ...overrides,
});

const suppression = (overrides: Record<string, unknown> = {}) => ({
  isAiEditing: false,
  isCropping: false,
  isMasking: false,
  isRotationActive: false,
  isSliderDragging: false,
  isStraightenActive: false,
  isToolActive: false,
  isWhiteBalanceActive: false,
  requestedActiveTool: 'none' as ViewerActiveTool,
  ...overrides,
});

describe('viewer tool runtime coordinator policy', () => {
  test('publishes one exact router context with deterministic tool precedence', () => {
    const picker = resolveViewerInteractionRuntime(
      interaction(),
      snapshot({
        focusRetouchActive: true,
        pickerActiveTool: 'point-color',
        retouchActive: true,
        whiteBalanceActive: true,
      }),
    );
    expect(picker).toEqual({
      activeTool: 'point-color',
      context: {
        activeTool: 'point-color',
        focusContext: 'viewer',
        geometryEpoch: 11,
        imageSessionId: 'image-session:a:4',
        isTemporaryHand: false,
        pointerCount: 1,
        sourceIdentity: '/fixture/a.raw',
        sourceRevision: 'graph:9',
        toolId: 'retouch',
        zoomed: true,
      },
    });

    expect(
      resolveViewerInteractionRuntime(
        interaction({ isCropping: true, isStraightenActive: true }),
        snapshot({ pickerActiveTool: 'point-color', whiteBalanceActive: true }),
      ).activeTool,
    ).toBe('straighten');
    expect(
      resolveViewerInteractionRuntime(interaction(), snapshot({ whiteBalanceActive: true, focusRetouchActive: true }))
        .activeTool,
    ).toBe('white-balance');
    expect(resolveViewerInteractionRuntime(interaction(), snapshot({ focusRetouchActive: true })).activeTool).toBe(
      'focus-retouch',
    );
    expect(resolveViewerInteractionRuntime(interaction(), snapshot({ retouchActive: true })).activeTool).toBe(
      'retouch',
    );
  });

  test('suppresses sampling for every competing runtime owner and leaves idle viewing observable', () => {
    expect(
      resolveViewerSamplerSuppression(suppression(), { maskShapeActive: false, pickerActiveTool: null }),
    ).toBeFalse();

    const policies = [
      { isAiEditing: true },
      { isCropping: true },
      { isMasking: true },
      { isRotationActive: true },
      { isSliderDragging: true },
      { isStraightenActive: true },
      { isToolActive: true },
      { isWhiteBalanceActive: true },
      { requestedActiveTool: 'retouch' as ViewerActiveTool },
    ];
    for (const policy of policies) {
      expect(
        resolveViewerSamplerSuppression(suppression(policy), {
          maskShapeActive: false,
          pickerActiveTool: null,
        }),
      ).toBeTrue();
    }
    expect(
      resolveViewerSamplerSuppression(suppression(), { maskShapeActive: true, pickerActiveTool: null }),
    ).toBeTrue();
    expect(
      resolveViewerSamplerSuppression(suppression(), {
        maskShapeActive: false,
        pickerActiveTool: 'tone-equalizer',
      }),
    ).toBeTrue();
  });
});
