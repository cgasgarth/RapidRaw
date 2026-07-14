import { describe, expect, test } from 'bun:test';
import { editDocumentV2Schema } from '../../packages/rawengine-schema/src/editDocumentV2';
import { INITIAL_ADJUSTMENTS } from '../../src/utils/adjustments';
import {
  editDocumentV2NodeInventory,
  editDocumentV2ToLegacyAdjustments,
  legacyAdjustmentsToEditDocumentV2,
} from '../../src/utils/editDocumentV2';

describe('EditDocumentV2 legacy adapter', () => {
  test('maps adjustment ownership into a stable node inventory', () => {
    const document = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      exposure: 0.75,
      crop: { unit: '%', x: 1, y: 2, width: 95, height: 90 },
    });

    expect(document.schemaVersion).toBe(2);
    expect(editDocumentV2NodeInventory(document)).toEqual([
      'scene_global_color_tone',
      'scene_curve',
      'display_creative',
      'detail_denoise_dehaze',
      'camera_input',
      'geometry',
      'layers',
      'source_artifacts',
    ]);
    expect(document.nodes.scene_global_color_tone?.params.exposure).toBe(0.75);
    expect(document.geometry.crop).toEqual({ unit: '%', x: 1, y: 2, width: 95, height: 90 });
  });

  test('legacy adapter is deterministic and preserves unmigrated fields in extensions', () => {
    const adjustments = { ...structuredClone(INITIAL_ADJUSTMENTS), customFutureField: { enabled: true } };
    const first = legacyAdjustmentsToEditDocumentV2(adjustments);
    const second = legacyAdjustmentsToEditDocumentV2(adjustments);

    expect(first).toEqual(second);
    const legacyExtensions = first.extensions.legacyAdjustments;
    expect(legacyExtensions && typeof legacyExtensions === 'object' && 'customFutureField' in legacyExtensions).toBe(
      true,
    );
    expect(editDocumentV2ToLegacyAdjustments(first).customFutureField).toEqual({ enabled: true });
  });

  test('strict document schema rejects unknown top-level fields', () => {
    const document = legacyAdjustmentsToEditDocumentV2(INITIAL_ADJUSTMENTS);
    expect(() => editDocumentV2Schema.parse({ ...document, unsupported: true })).toThrow();
  });

  test('node updates retain unrelated nodes and provenance domains', () => {
    const document = legacyAdjustmentsToEditDocumentV2(INITIAL_ADJUSTMENTS);
    const next = editDocumentV2Schema.parse({
      ...document,
      nodes: {
        ...document.nodes,
        scene_global_color_tone: {
          ...document.nodes.scene_global_color_tone,
          params: { ...document.nodes.scene_global_color_tone?.params, exposure: 1 },
        },
      },
      provenance: { source: 'test' },
    });

    expect(next.nodes.geometry).toEqual(document.nodes.geometry);
    expect(next.provenance).toEqual({ source: 'test' });
    expect(next.nodes.scene_global_color_tone?.params.exposure).toBe(1);
  });
});
