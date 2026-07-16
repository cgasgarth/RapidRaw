import { describe, expect, test } from 'bun:test';

import { compileEditDocumentNodeV2, editDocumentV2Schema } from '../../../packages/rawengine-schema/src/editDocumentV2';
import { selectEditDocumentGeometry, selectEditDocumentNode } from '../../../src/utils/editDocumentSelectors';
import { createDefaultEditDocumentV2, patchEditDocumentV2Node } from '../../../src/utils/editDocumentV2';

describe('current creative, curve, and geometry authority', () => {
  test('owns creative effects in display_creative', () => {
    const document = patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'display_creative', {
      grainAmount: 24,
      vignetteAmount: -18,
    });
    expect(selectEditDocumentNode(document, 'display_creative').params).toMatchObject({
      grainAmount: 24,
      vignetteAmount: -18,
    });
  });

  test('owns point and parametric curves in scene_curve', () => {
    const document = patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'scene_curve', {
      curveMode: 'parametric',
      toneCurve: 'linear',
    });
    expect(selectEditDocumentNode(document, 'scene_curve').params).toMatchObject({
      curveMode: 'parametric',
      toneCurve: 'linear',
    });
    expect(compileEditDocumentNodeV2(document.nodes['scene_curve'])).toMatchObject({ nodeType: 'scene_curve' });
  });

  test('synchronizes geometry domain and node params', () => {
    const crop = { height: 0.7, unit: 'normalized' as const, width: 0.8, x: 0.1, y: 0.15 };
    const document = patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'geometry', {
      crop,
      flipHorizontal: true,
      rotation: 3.5,
    });
    expect(selectEditDocumentGeometry(document)).toMatchObject({ crop, flipHorizontal: true, rotation: 3.5 });
    expect(JSON.stringify(document.geometry)).toBe(JSON.stringify(document.nodes['geometry']!.params));
  });

  test('rejects impossible geometry and flat creative fields', () => {
    expect(() => patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'geometry', { rotation: 90 })).toThrow();
    expect(editDocumentV2Schema.safeParse({ ...createDefaultEditDocumentV2(), grainAmount: 30 }).success).toBeFalse();
  });
});
