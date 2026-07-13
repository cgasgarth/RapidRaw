import { describe, expect, test } from 'bun:test';

import {
  buildPreviewGeometryIdentity,
  type PreviewGeometryParams,
  requestPreviewGeometry,
  toPreviewGeometryInvokeArgs,
} from '../../../src/tauri/previewGeometry';
import { INITIAL_ADJUSTMENTS, INITIAL_MASK_ADJUSTMENTS } from '../../../src/utils/adjustments';

const params: PreviewGeometryParams = {
  distortion: 0,
  vertical: 0,
  horizontal: 0,
  rotate: 0,
  aspect: 0,
  scale: 100,
  x_offset: 0,
  y_offset: 0,
  lens_distortion_amount: 1,
  lens_vignette_amount: 1,
  lens_tca_amount: 1,
  lens_dist_k1: 0,
  lens_dist_k2: 0,
  lens_dist_k3: 0,
  lens_model: 0,
  tca_vr: 1,
  tca_vb: 1,
  vig_k1: 0,
  vig_k2: 0,
  vig_k3: 0,
  lens_distortion_enabled: true,
  lens_tca_enabled: true,
  lens_vignette_enabled: true,
};

const request = () =>
  ({
    sourceIdentity: '/fixtures/source.raw@revision-1',
    params,
    adjustments: structuredClone(INITIAL_ADJUSTMENTS),
    showLines: false,
  }) as const;

describe('preview geometry authority contract', () => {
  test('maps the typed request to the existing native command boundary', () => {
    const input = request();
    expect(toPreviewGeometryInvokeArgs(input)).toEqual({
      params,
      jsAdjustments: input.adjustments,
      showLines: false,
      target: { kind: 'editor-setting', quality: 'interactive' },
    });
  });

  test('invokes the typed boundary and validates the native data URL payload', async () => {
    const calls: Array<{ args?: Record<string, unknown>; command: string }> = [];
    const result = await requestPreviewGeometry(request(), async (command, args) => {
      calls.push({ args, command });
      return 'data:image/jpeg;base64,fixture';
    });
    expect(calls).toEqual([
      {
        args: toPreviewGeometryInvokeArgs(request()),
        command: 'preview_geometry_transform',
      },
    ]);
    expect(result.dataUrl).toBe('data:image/jpeg;base64,fixture');
    await expect(requestPreviewGeometry(request(), async () => 'not-an-image')).rejects.toThrow();
  });

  test('source, geometry, retouch, and target independently invalidate identity', () => {
    const baseline = buildPreviewGeometryIdentity(request());
    expect(
      buildPreviewGeometryIdentity({ ...request(), sourceIdentity: '/fixtures/other.raw@revision-1' }),
    ).not.toEqual(baseline);
    expect(buildPreviewGeometryIdentity({ ...request(), params: { ...params, rotate: 2 } })).not.toEqual(baseline);

    const retouched = request();
    retouched.adjustments.aiPatches.push({
      id: 'patch-1',
      isLoading: false,
      invert: false,
      name: 'Patch',
      patchData: null,
      prompt: 'remove dust',
      subMasks: [],
      visible: true,
    });
    expect(buildPreviewGeometryIdentity(retouched)).not.toEqual(baseline);

    expect(
      buildPreviewGeometryIdentity({
        ...request(),
        target: { kind: 'long-edge', longEdgePx: 2048, quality: 'settled' },
      }),
    ).not.toEqual(baseline);
  });

  test('GPU-only tone changes preserve geometry and retouch authority', () => {
    const baseline = buildPreviewGeometryIdentity(request());
    const toneChanged = request();
    toneChanged.adjustments.exposure = 42;
    expect(buildPreviewGeometryIdentity(toneChanged)).toEqual(baseline);
  });

  test('GPU-only local masks preserve retouch authority', () => {
    const baseline = buildPreviewGeometryIdentity(request());
    const localMask = request();
    localMask.adjustments.masks.push({
      adjustments: structuredClone(INITIAL_MASK_ADJUSTMENTS),
      id: 'local-1',
      invert: false,
      name: 'Local exposure',
      opacity: 100,
      subMasks: [],
      visible: true,
    });
    expect(buildPreviewGeometryIdentity(localMask)).toEqual(baseline);
  });

  test('source-anchored CPU retouch changes invalidate authority', () => {
    const first = request();
    first.adjustments.masks.push({
      adjustments: structuredClone(INITIAL_MASK_ADJUSTMENTS),
      id: 'clone-1',
      invert: false,
      name: 'Clone',
      opacity: 100,
      retouchCloneSource: {
        retouchMode: 'clone',
        rotationDegrees: 0,
        scale: 1,
        sourcePoint: { x: 0.1, y: 0.2 },
        targetPoint: { x: 0.8, y: 0.7 },
      },
      subMasks: [],
      visible: true,
    });
    const second = structuredClone(first);
    const cloneSource = second.adjustments.masks[0]?.retouchCloneSource;
    if (!cloneSource) throw new Error('missing clone source fixture');
    cloneSource.sourcePoint.x = 0.3;
    expect(buildPreviewGeometryIdentity(second)).not.toEqual(buildPreviewGeometryIdentity(first));
  });

  test('rejects non-finite geometry before invoking native code', () => {
    expect(() => toPreviewGeometryInvokeArgs({ ...request(), params: { ...params, rotate: Number.NaN } })).toThrow();
  });

  test('passes an explicit target through to the native preview contract', () => {
    expect(
      toPreviewGeometryInvokeArgs({
        ...request(),
        target: { kind: 'long-edge', longEdgePx: 4096, quality: 'settled' },
      }).target,
    ).toEqual({ kind: 'long-edge', longEdgePx: 4096, quality: 'settled' });
  });
});
