import { describe, expect, test } from 'bun:test';

import { compileEditDocumentNodeV2, editDocumentV2Schema } from '../../../packages/rawengine-schema/src/editDocumentV2';
import { createDefaultMaskEditNodes, INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import {
  editDocumentV2ToLegacyAdjustments,
  legacyAdjustmentsToEditDocumentV2,
  setEditDocumentV2NodeEnabled,
} from '../../../src/utils/editDocumentV2';
import { referenceMatchReceipt, sourcePatch } from './authority-fixtures';

describe('EditDocumentV2 source and layer authority', () => {
  test('legacy adapter is deterministic and preserves unmigrated fields in extensions', () => {
    const adjustments = { ...structuredClone(INITIAL_ADJUSTMENTS), customFutureField: { enabled: true } };
    const first = legacyAdjustmentsToEditDocumentV2(adjustments);
    const second = legacyAdjustmentsToEditDocumentV2(adjustments);

    expect(first).toEqual(second);
    const legacyExtensions = first.extensions['legacyAdjustments'];
    expect(legacyExtensions && typeof legacyExtensions === 'object' && 'customFutureField' in legacyExtensions).toBe(
      true,
    );
    expect(editDocumentV2ToLegacyAdjustments(first)['customFutureField']).toEqual({ enabled: true });
  });

  test('migrates legacy Effects visibility into render node enablement without losing latent parameters', () => {
    const legacy = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      effectsEnabled: undefined,
      grainAmount: 42,
      sectionVisibility: { basic: true, color: true, curves: true, details: true, effects: false },
    });

    const legacyDisplayCreative = legacy.nodes['display_creative'];
    expect(legacyDisplayCreative).toBeDefined();
    if (legacyDisplayCreative === undefined) throw new Error('expected display creative fixture');
    expect(legacyDisplayCreative.enabled).toBeFalse();
    expect(legacyDisplayCreative.params['grainAmount']).toBe(42);
    expect(legacy.migration).toMatchObject({ disabled: ['display_creative'] });
    expect(legacy.migration?.mapped).toContain('display_creative.enabled');
    expect(legacy.extensions['legacyAdjustments']).not.toHaveProperty('effectsEnabled');

    const reenabled = setEditDocumentV2NodeEnabled(legacy, 'display_creative', true);
    const reenabledDisplayCreative = reenabled.nodes['display_creative'];
    expect(reenabledDisplayCreative).toBeDefined();
    if (reenabledDisplayCreative === undefined) throw new Error('expected reenabled display creative fixture');
    expect(reenabledDisplayCreative.enabled).toBeTrue();
    expect(reenabledDisplayCreative.params).toEqual(legacyDisplayCreative.params);
    expect(editDocumentV2ToLegacyAdjustments(reenabled)).toMatchObject({ effectsEnabled: true, grainAmount: 42 });
  });

  test('separates strict source artifacts from provenance and round-trips idempotently', () => {
    const adjustments = {
      ...structuredClone(INITIAL_ADJUSTMENTS),
      aiPatches: [sourcePatch],
      generatedProfile: { obsolete: true },
      referenceMatchApplicationReceipt: referenceMatchReceipt,
    };
    const first = legacyAdjustmentsToEditDocumentV2(adjustments);
    const reopened = legacyAdjustmentsToEditDocumentV2(editDocumentV2ToLegacyAdjustments(first));

    expect(first.sourceArtifacts.aiPatches).toEqual([sourcePatch]);
    expect(first.nodes['source_artifacts']?.params).toEqual(first.sourceArtifacts);
    expect(first.nodes['source_artifacts']?.params).not.toHaveProperty('referenceMatchApplicationReceipt');
    expect(first.provenance.referenceMatchApplicationReceipt).toEqual(referenceMatchReceipt);
    expect(first.extensions['legacyAdjustments']).toMatchObject({ generatedProfile: { obsolete: true } });
    expect(reopened).toEqual(first);
  });

  test('defaults and strictly validates the render-authoritative layers domain', () => {
    const { masks: _legacyMasks, ...legacyWithoutMasks } = structuredClone(INITIAL_ADJUSTMENTS);
    const defaulted = legacyAdjustmentsToEditDocumentV2(legacyWithoutMasks);
    expect(defaulted.layers).toEqual({ masks: [] });
    expect(defaulted.nodes['layers']?.params).toEqual(defaulted.layers);

    const layer = {
      adjustments: { exposure: 0.4 },
      blendMode: 'overlay' as const,
      editNodes: createDefaultMaskEditNodes(),
      editNodeSchemaVersion: 1 as const,
      id: 'layer-1',
      invert: false,
      name: 'Local sky',
      opacity: 72,
      subMasks: [
        {
          id: 'sub-mask-1',
          invert: false,
          mode: 'additive' as const,
          opacity: 100,
          parameters: { feather: 0.5 },
          type: 'brush' as const,
          visible: true,
        },
      ],
      visible: true,
    };
    const document = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      masks: [layer],
    });
    expect(document.layers.masks).toEqual([layer]);
    expect(compileEditDocumentNodeV2(document.nodes['layers']).params).toEqual(document.layers);

    expect(() =>
      editDocumentV2Schema.parse({
        ...document,
        layers: { masks: [layer, layer] },
        nodes: { ...document.nodes, layers: { ...document.nodes['layers'], params: { masks: [layer, layer] } } },
      }),
    ).toThrow('unique');
    expect(() =>
      editDocumentV2Schema.parse({
        ...document,
        layers: { masks: [{ ...layer, opacity: 101 }] },
        nodes: { ...document.nodes, layers: { ...document.nodes['layers'], params: document.layers } },
      }),
    ).toThrow();
    expect(() => editDocumentV2Schema.parse({ ...document, layers: { masks: [] } })).toThrow('disagrees');
  });

  test('rejects pre-envelope, legacy-visibility, malformed, and split layer authority', () => {
    const document = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      masks: [
        {
          adjustments: { exposure: 0.4 },
          editNodes: createDefaultMaskEditNodes(),
          editNodeSchemaVersion: 1,
          id: 'legacy-v2-layer',
          invert: false,
          name: 'Legacy V2 layer',
          opacity: 72,
          subMasks: [],
          visible: true,
        },
      ],
    });
    const currentLayer = document.layers.masks[0];
    expect(currentLayer).toBeDefined();
    if (currentLayer === undefined) throw new Error('expected current layer fixture');

    const rejectBothDomains = (layer: Record<string, unknown>) =>
      editDocumentV2Schema.parse({
        ...document,
        layers: { masks: [layer] },
        nodes: { ...document.nodes, layers: { ...document.nodes['layers'], params: { masks: [layer] } } },
      });

    const { editNodes: _editNodes, ...missingNodes } = currentLayer;
    expect(() => rejectBothDomains(missingNodes)).toThrow();
    const { editNodeSchemaVersion: _schemaVersion, ...missingSchemaVersion } = currentLayer;
    expect(() => rejectBothDomains(missingSchemaVersion)).toThrow();
    expect(() => rejectBothDomains({ ...currentLayer, editNodeSchemaVersion: 0 })).toThrow();
    expect(() => rejectBothDomains({ ...currentLayer, editNodes: { basic: { enabled: true } } })).toThrow();
    expect(() =>
      rejectBothDomains({
        ...currentLayer,
        adjustments: {
          ...currentLayer.adjustments,
          sectionVisibility: { basic: false, color: true, curves: false, details: true },
        },
      }),
    ).toThrow('sectionVisibility');

    const splitLayer = {
      ...currentLayer,
      editNodes: { ...currentLayer.editNodes, basic: { enabled: false } },
    };
    expect(() =>
      editDocumentV2Schema.parse({
        ...document,
        nodes: { ...document.nodes, layers: { ...document.nodes['layers'], params: { masks: [splitLayer] } } },
      }),
    ).toThrow('disagrees');
  });

  test('rejects malformed, duplicate, and ambiguous source artifacts', () => {
    const document = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      aiPatches: [sourcePatch],
    });
    expect(() =>
      editDocumentV2Schema.parse({
        ...document,
        sourceArtifacts: { aiPatches: [{ ...sourcePatch, unsupported: true }] },
      }),
    ).toThrow();
    expect(() =>
      editDocumentV2Schema.parse({
        ...document,
        sourceArtifacts: { aiPatches: [sourcePatch, sourcePatch] },
      }),
    ).toThrow('unique');
    expect(() => editDocumentV2Schema.parse({ ...document, sourceArtifacts: { aiPatches: [] } })).toThrow('disagrees');
  });

  test('strict document schema rejects unknown top-level fields', () => {
    const document = legacyAdjustmentsToEditDocumentV2(INITIAL_ADJUSTMENTS);
    expect(() => editDocumentV2Schema.parse({ ...document, unsupported: true })).toThrow();
  });
});
