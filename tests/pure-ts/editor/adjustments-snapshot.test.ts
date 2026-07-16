import { describe, expect, test } from 'bun:test';
import { areEditDocumentsEqual } from '../../../src/utils/adjustmentsSnapshot';
import { createDefaultEditDocumentV2, patchEditDocumentV2Node } from '../../../src/utils/editDocumentV2';

describe('adjustment snapshots', () => {
  test('treats identical adjustment payloads as unchanged', () => {
    const document = createDefaultEditDocumentV2();
    expect(areEditDocumentsEqual(document, structuredClone(document))).toBe(true);
  });

  test('treats an edit as changed', () => {
    expect(
      areEditDocumentsEqual(
        createDefaultEditDocumentV2(),
        patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'scene_global_color_tone', { exposure: 0.25 }),
      ),
    ).toBe(false);
  });
});
