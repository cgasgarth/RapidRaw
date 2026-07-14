import { describe, expect, test } from 'bun:test';
import {
  buildPointColorPickerPoint,
  createViewerAdjustmentCommandServices,
  updateRetouchCloneInAdjustments,
  updateRetouchRemoveInAdjustments,
  updateSubMaskInAdjustments,
} from '../../../src/components/panel/editor/viewerAdjustmentCommandService';
import { Mask, SubMaskMode } from '../../../src/components/panel/right/layers/Masks';
import {
  type Adjustments,
  INITIAL_ADJUSTMENTS,
  INITIAL_MASK_CONTAINER,
  type MaskContainer,
  type RetouchRemoveSource,
} from '../../../src/utils/adjustments';

const makeMask = (): MaskContainer => ({
  ...structuredClone(INITIAL_MASK_CONTAINER),
  id: 'layer-1',
  name: 'Retouch',
  retouchCloneSource: {
    rotationDegrees: 0,
    scale: 1,
    sourcePoint: { x: 0.2, y: 0.2 },
    targetPoint: { x: 0.4, y: 0.4 },
  },
  retouchRemoveSource: undefined,
  subMasks: [
    {
      id: 'radial-1',
      invert: false,
      mode: SubMaskMode.Additive,
      opacity: 100,
      parameters: {},
      type: Mask.Radial,
      visible: true,
    },
    {
      id: 'radial-2',
      invert: false,
      mode: SubMaskMode.Additive,
      opacity: 100,
      parameters: {},
      type: Mask.Radial,
      visible: true,
    },
  ],
});

const withMask = (mask: MaskContainer): Adjustments => ({
  ...structuredClone(INITIAL_ADJUSTMENTS),
  masks: [mask],
});

describe('viewer adjustment command authority', () => {
  test('builds and commits a sampled point through a semantic command', () => {
    const ids = ['point-7', 'sample-7'];
    const result = {
      chroma: 0.3,
      confidence: 0.92,
      graphFingerprint: 'graph-fp',
      graphRevision: 'graph:7',
      hueDegrees: 210,
      lightness: 0.4,
      sampleRadiusPx: 8,
      sourceFingerprint: 'source-fp',
      sourceIdentity: 'image-a',
    };
    const point = buildPointColorPickerPoint(result, 7, () => ids.shift() ?? 'unexpected');
    expect(point).toMatchObject({
      id: 'point-7',
      name: 'Point 7',
      samples: [{ id: 'sample-7', sourceColor: { chroma: 0.3, hueDegrees: 210, lightness: 0.4 } }],
    });

    let state = structuredClone(INITIAL_ADJUSTMENTS);
    const serviceIds = ['point-1', 'sample-1'];
    const services = createViewerAdjustmentCommandServices(
      (updater) => {
        state = updater(state);
      },
      () => serviceIds.shift() ?? 'unexpected',
    );
    services.commitPointColorPicker(result, 1);
    expect(state.pointColor).toMatchObject({ enabled: true, selectedPointId: 'point-1' });
    expect(state.pointColor.points[0]).toMatchObject({ id: 'point-1', samples: [{ id: 'sample-1' }] });
  });

  test('updates one sub-mask through a pure command transformation', () => {
    const state = withMask(makeMask());
    const next = updateSubMaskInAdjustments(state, 'radial-1', { opacity: 42 });
    expect(next.masks[0]?.subMasks[0]?.opacity).toBe(42);
    expect(next.masks[0]?.subMasks[1]?.opacity).toBe(100);
    expect(state.masks[0]?.subMasks[0]?.opacity).toBe(100);
  });

  test('synchronizes only the first radial target and preserves source geometry', () => {
    const state = withMask(makeMask());
    const next = updateRetouchCloneInAdjustments(
      state,
      'layer-1',
      'targetPoint',
      { x: 0.7, y: 0.8 },
      { width: 1000, height: 500 },
    );
    expect(next.masks[0]?.retouchCloneSource?.targetPoint).toEqual({ x: 0.7, y: 0.8 });
    expect(next.masks[0]?.subMasks[0]?.parameters).toEqual({ centerX: 700, centerY: 400 });
    expect(next.masks[0]?.subMasks[1]?.parameters).toEqual({});
  });

  test('invalidates remove provenance and moves the target radial point', () => {
    const removeSource: RetouchRemoveSource = {
      generator: 'local_patch_fill_v1',
      generatorVersion: 1,
      resolvedSourcePoint: { x: 0.1, y: 0.2 },
      searchRadiusMultiplier: 2,
      seed: 7,
      status: 'ready',
      targetMaskId: 'radial-1',
    };
    const state = withMask({ ...makeMask(), retouchCloneSource: undefined, retouchRemoveSource: removeSource });
    const next = updateRetouchRemoveInAdjustments(
      state,
      'layer-1',
      removeSource,
      { x: 0.3, y: 0.4 },
      { width: 1000, height: 500 },
    );
    expect(next.masks[0]?.retouchRemoveSource?.status).toBe('needs_regeneration');
    expect(next.masks[0]?.retouchRemoveSource?.resolvedSourcePoint).toBeUndefined();
    expect(next.masks[0]?.subMasks[0]?.parameters).toEqual({ centerX: 300, centerY: 200 });
  });

  test('dispatches point-color and mask commands through one authority', () => {
    let state = structuredClone(INITIAL_ADJUSTMENTS);
    const services = createViewerAdjustmentCommandServices((updater) => {
      state = updater(state);
    });
    services.updateSubMask(null, { opacity: 1 });
    services.appendPointColorSample({
      chromaRadius: 0.1,
      chromaShift: 0,
      enabled: true,
      feather: 0.2,
      hueRadiusDegrees: 20,
      hueShiftDegrees: 0,
      id: 'point-1',
      lightnessRadius: 0.2,
      lightnessShift: 0,
      name: 'Point 1',
      opacity: 1,
      samples: [],
      saturationShift: 0,
      variance: 1,
    });
    expect(state.pointColor.selectedPointId).toBe('point-1');
    expect(state.pointColor.points).toHaveLength(1);
  });
});
