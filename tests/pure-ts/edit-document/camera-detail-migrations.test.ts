import { describe, expect, test } from 'bun:test';

import { editDocumentV2Schema } from '../../../packages/rawengine-schema/src/editDocumentV2';
import { selectEditDocumentNode } from '../../../src/utils/editDocumentSelectors';
import { createDefaultEditDocumentV2, patchEditDocumentV2Node } from '../../../src/utils/editDocumentV2';

describe('current camera and detail document authority', () => {
  test('stores camera input and detail controls only in their typed nodes', () => {
    const camera = patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'camera_input', {
      cameraProfile: 'camera_landscape',
      cameraProfileAmount: 72,
    });
    const document = patchEditDocumentV2Node(camera, 'detail_denoise_dehaze', {
      clarity: 18,
      dehaze: 7,
      sharpness: 35,
    });

    expect(selectEditDocumentNode(document, 'camera_input').params).toMatchObject({
      cameraProfile: 'camera_landscape',
      cameraProfileAmount: 72,
    });
    expect(selectEditDocumentNode(document, 'detail_denoise_dehaze').params).toMatchObject({
      clarity: 18,
      dehaze: 7,
      sharpness: 35,
    });
    expect(document.extensions).toEqual({});
  });

  test('rejects flat documents and malformed current node values', () => {
    expect(editDocumentV2Schema.safeParse({ exposure: 1 }).success).toBeFalse();
    const malformed = structuredClone(createDefaultEditDocumentV2());
    malformed.nodes['detail_denoise_dehaze']!.params['clarity'] = Number.NaN;
    expect(editDocumentV2Schema.safeParse(malformed).success).toBeFalse();
  });

  test('preserves unrelated node identity for focused patches', () => {
    const before = createDefaultEditDocumentV2();
    const after = patchEditDocumentV2Node(before, 'camera_input', { cameraProfileAmount: 65 });

    expect(after.nodes['camera_input']).not.toBe(before.nodes['camera_input']);
    expect(after.nodes['detail_denoise_dehaze']).toBe(before.nodes['detail_denoise_dehaze']);
    expect(after.geometry).toBe(before.geometry);
  });
});
