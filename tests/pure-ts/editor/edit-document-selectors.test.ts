import { describe, expect, test } from 'bun:test';
import {
  selectEditDocumentGeometry,
  selectEditDocumentNode,
  selectEditDocumentSourceArtifacts,
} from '../../../src/utils/editDocumentSelectors';
import { createDefaultEditDocumentV2, updateEditDocumentV2Node } from '../../../src/utils/editDocumentV2';

describe('typed edit-document node selectors', () => {
  test('exposes schema-inferred node parameters', () => {
    const document = createDefaultEditDocumentV2();
    const tone = selectEditDocumentNode(document, 'scene_global_color_tone');
    const exposure: number = tone.params['exposure'];
    const geometry = selectEditDocumentGeometry(document);

    expect(exposure).toBe(0);
    expect(geometry.crop).toBeNull();
    expect(selectEditDocumentSourceArtifacts(document).aiPatches).toEqual([]);
  });

  test('preserves node and domain identity across unrelated edits', () => {
    const initial = createDefaultEditDocumentV2();
    const tone = selectEditDocumentNode(initial, 'scene_global_color_tone');
    const layers = selectEditDocumentNode(initial, 'layers');
    const geometry = selectEditDocumentGeometry(initial);
    const edited = updateEditDocumentV2Node(initial, 'display_creative', (params) => ({
      ...params,
      grainAmount: 20,
    }));

    expect(selectEditDocumentNode(edited, 'scene_global_color_tone')).toBe(tone);
    expect(selectEditDocumentNode(edited, 'layers')).toBe(layers);
    expect(selectEditDocumentGeometry(edited)).toBe(geometry);
  });

  test('changes only the edited node identity and notifies only its consumer', () => {
    const initial = createDefaultEditDocumentV2();
    const initialTone = selectEditDocumentNode(initial, 'scene_global_color_tone');
    const initialGeometry = selectEditDocumentNode(initial, 'geometry');
    const edited = updateEditDocumentV2Node(initial, 'scene_global_color_tone', (params) => ({
      ...params,
      exposure: 0.5,
    }));

    const nextTone = selectEditDocumentNode(edited, 'scene_global_color_tone');
    expect(nextTone).not.toBe(initialTone);
    expect(nextTone.params['exposure']).toBe(0.5);
    expect(selectEditDocumentNode(edited, 'geometry')).toBe(initialGeometry);
  });
});
