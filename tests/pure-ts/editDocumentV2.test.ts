import { describe, expect, test } from 'bun:test';
import {
  editDocumentV2Schema,
  getEditDocumentNodeDescriptor,
  parseEditDocumentV2WithQuarantine,
} from '../../packages/rawengine-schema/src/editDocumentV2';
import { INITIAL_ADJUSTMENTS } from '../../src/utils/adjustments';
import {
  copyEditDocumentV2Node,
  editDocumentV2NodeInventory,
  editDocumentV2ToLegacyAdjustments,
  getEditDocumentV2NodeCapabilities,
  legacyAdjustmentsToEditDocumentV2,
  resetEditDocumentV2Node,
  pasteEditDocumentV2Node,
  updateEditDocumentV2Node,
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
    expect(document.migration?.mapped).toContain('scene_global_color_tone.exposure');
    expect(document.migration?.quarantined).toContain('sectionVisibility');
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

  test('descriptor capabilities and focused updates come from the shared registry', () => {
    const document = legacyAdjustmentsToEditDocumentV2(INITIAL_ADJUSTMENTS);
    const next = updateEditDocumentV2Node(document, 'scene_global_color_tone', (params) => ({
      ...params,
      exposure: 0.25,
    }));

    expect(getEditDocumentNodeDescriptor('scene_global_color_tone')?.renderStage).toBe('scene_global_color_tone');
    expect(getEditDocumentV2NodeCapabilities('source_artifacts')).toEqual({
      batch: false,
      copy: false,
      paste: false,
      provenance: 'regenerate',
      reset: false,
    });
    expect(next.nodes.geometry).toBe(document.nodes.geometry);
    expect(next.nodes.scene_global_color_tone?.params.exposure).toBe(0.25);
  });

  test('future node types are quarantined and non-finite node values are rejected', () => {
    const document = legacyAdjustmentsToEditDocumentV2(INITIAL_ADJUSTMENTS);
    const future = parseEditDocumentV2WithQuarantine({
      ...document,
      nodes: {
        ...document.nodes,
        future_color_v9: { enabled: true, params: { exposure: 2 }, process: 'future_v9', type: 'future_color_v9' },
      },
    });

    expect(future.quarantinedNodeTypes).toEqual(['future_color_v9']);
    expect('future_color_v9' in future.document.nodes).toBe(false);
    expect(future.document.extensions.quarantinedNodes).toEqual({
      future_color_v9: { enabled: true, params: { exposure: 2 }, process: 'future_v9', type: 'future_color_v9' },
    });
    expect(() =>
      editDocumentV2Schema.parse({
        ...document,
        nodes: {
          ...document.nodes,
          scene_global_color_tone: {
            ...document.nodes.scene_global_color_tone,
            params: { exposure: Number.NaN },
          },
        },
      }),
    ).toThrow('non-finite');
  });

  test('reset uses descriptor defaults and preserves unrelated domains', () => {
    const document = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      exposure: 1.5,
      contrast: 0.25,
    });
    const reset = resetEditDocumentV2Node(document, 'scene_global_color_tone');

    expect(reset.nodes.scene_global_color_tone?.params).toEqual({
      blacks: 0,
      brightness: 0,
      contrast: 0,
      exposure: 0,
      highlights: 0,
      saturation: 0,
      shadows: 0,
      whites: 0,
    });
    expect(reset.nodes.geometry).toEqual(document.nodes.geometry);
    expect(reset.provenance).toEqual(document.provenance);
  });

  test('non-resettable source artifacts remain unchanged', () => {
    const document = legacyAdjustmentsToEditDocumentV2(INITIAL_ADJUSTMENTS);
    expect(resetEditDocumentV2Node(document, 'source_artifacts')).toEqual(document);
  });

  test('copy and paste derive eligibility from descriptors and isolate node state', () => {
    const document = legacyAdjustmentsToEditDocumentV2({ ...structuredClone(INITIAL_ADJUSTMENTS), exposure: 0.5 });
    const clipboard = copyEditDocumentV2Node(document, 'scene_global_color_tone');
    expect(clipboard?.params.exposure).toBe(0.5);
    if (clipboard) clipboard.params.exposure = 2;
    expect(document.nodes.scene_global_color_tone?.params.exposure).toBe(0.5);

    const pasted = pasteEditDocumentV2Node(document, 'scene_global_color_tone', clipboard);
    expect(pasted.nodes.scene_global_color_tone?.params.exposure).toBe(2);
    expect(pasted.nodes.geometry).toEqual(document.nodes.geometry);
    expect(pasted.provenance).toEqual(document.provenance);
    expect(copyEditDocumentV2Node(document, 'source_artifacts')).toBeNull();
  });

  test('rejects malformed or cross-node clipboard payloads without mutation', () => {
    const document = legacyAdjustmentsToEditDocumentV2(INITIAL_ADJUSTMENTS);
    expect(
      pasteEditDocumentV2Node(document, 'scene_global_color_tone', {
        enabled: true,
        implementationVersion: 1,
        params: { exposure: 2 },
        process: 'scene_referred_v2',
        type: 'geometry',
      }),
    ).toEqual(document);
    expect(pasteEditDocumentV2Node(document, 'scene_global_color_tone', { invalid: true })).toEqual(document);
  });
});
