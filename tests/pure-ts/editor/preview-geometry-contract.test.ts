import { describe, expect, test } from 'bun:test';

import {
  buildPreviewGeometryIdentity,
  type PreviewGeometryParams,
  requestPreviewGeometry,
  toPreviewGeometryInvokeArgs,
} from '../../../src/tauri/previewGeometry';
import { createDefaultMaskEditNodes, INITIAL_MASK_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { createDefaultEditDocumentV2, patchEditDocumentV2Node } from '../../../src/utils/editDocumentV2';

const params: PreviewGeometryParams = {
  aspect: 0,
  distortion: 0,
  horizontal: 0,
  lens_dist_k1: 0,
  lens_dist_k2: 0,
  lens_dist_k3: 0,
  lens_distortion_amount: 1,
  lens_distortion_enabled: true,
  lens_model: 0,
  lens_tca_amount: 1,
  lens_tca_enabled: true,
  lens_vignette_amount: 1,
  lens_vignette_enabled: true,
  rotate: 0,
  scale: 100,
  tca_vb: 1,
  tca_vr: 1,
  vertical: 0,
  vig_k1: 0,
  vig_k2: 0,
  vig_k3: 0,
  x_offset: 0,
  y_offset: 0,
};

const request = () => ({
  editDocumentV2: createDefaultEditDocumentV2(),
  params,
  showLines: false,
  sourceIdentity: '/fixtures/source.raw@revision-1',
});

describe('preview geometry current authority contract', () => {
  test('maps the typed document request to native invocation', () => {
    const input = request();
    expect(toPreviewGeometryInvokeArgs(input)).toEqual({
      editDocumentV2: input.editDocumentV2,
      params,
      showLines: false,
      target: { kind: 'editor-setting', quality: 'interactive' },
    });
  });

  test('invokes native and validates the returned image payload', async () => {
    const calls: Array<{ args?: Record<string, unknown>; command: string }> = [];
    const result = await requestPreviewGeometry(request(), async (command, args) => {
      calls.push({ ...(args === undefined ? {} : { args }), command });
      return 'data:image/jpeg;base64,fixture';
    });
    expect(calls[0]).toEqual({ args: toPreviewGeometryInvokeArgs(request()), command: 'preview_geometry_transform' });
    expect(result.dataUrl).toBe('data:image/jpeg;base64,fixture');
    await expect(requestPreviewGeometry(request(), async () => 'invalid')).rejects.toThrow();
  });

  test('source, geometry, retouch, and target independently invalidate identity', () => {
    const baseline = buildPreviewGeometryIdentity(request());
    expect(buildPreviewGeometryIdentity({ ...request(), sourceIdentity: '/fixtures/other.raw@1' })).not.toEqual(
      baseline,
    );
    expect(buildPreviewGeometryIdentity({ ...request(), params: { ...params, rotate: 2 } })).not.toEqual(baseline);
    const patch = {
      id: 'patch-1',
      invert: false,
      isLoading: false,
      name: 'Patch',
      patchData: null,
      prompt: 'remove dust',
      subMasks: [],
      visible: true,
    };
    const retouched = {
      ...request(),
      editDocumentV2: patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'source_artifacts', {
        aiPatches: [patch],
      }),
    };
    expect(buildPreviewGeometryIdentity(retouched)).not.toEqual(baseline);
    expect(
      buildPreviewGeometryIdentity({
        ...request(),
        target: { kind: 'long-edge', longEdgePx: 2048, quality: 'settled' },
      }),
    ).not.toEqual(baseline);
  });

  test('GPU-only tone and local-mask edits preserve retouch identity', () => {
    const baseline = buildPreviewGeometryIdentity(request());
    const tone = patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'scene_global_color_tone', { exposure: 2 });
    expect(buildPreviewGeometryIdentity({ ...request(), editDocumentV2: tone })).toEqual(baseline);
    const localMask = {
      adjustments: {},
      editNodeSchemaVersion: 1 as const,
      editNodes: {
        basic: { enabled: true },
        color: { enabled: true },
        curves: { enabled: true },
        details: { enabled: true },
      },
      id: 'local-1',
      invert: false,
      name: 'Local exposure',
      opacity: 100,
      subMasks: [],
      visible: true,
    };
    const local = patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'layers', { masks: [localMask] });
    expect(buildPreviewGeometryIdentity({ ...request(), editDocumentV2: local })).toEqual(baseline);
  });

  test('rejects non-finite geometry before invoking native code', () => {
    expect(() => toPreviewGeometryInvokeArgs({ ...request(), params: { ...params, rotate: Number.NaN } })).toThrow();
  });
});
