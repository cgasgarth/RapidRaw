import { beforeEach, describe, expect, test } from 'bun:test';

import {
  type EditDocumentV2,
  type EditDocumentV2CopyPayload,
  editDocumentV2CopyPayloadSchema,
} from '../../../packages/rawengine-schema/src/editDocumentV2';
import type { Preset } from '../../../src/components/ui/AppProperties';
import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import {
  BUILT_IN_COLOR_STYLE_PRESETS,
  buildBuiltInColorStylePreset,
} from '../../../src/utils/color/style/colorStylePresetCatalog';
import {
  buildPresetEditTransaction,
  buildPresetPreviewAdjustments,
  configureEditDocumentPresetPayload,
  createEditDocumentPresetPayload,
  parseExternalPresetImportResult,
  parsePresetLibrary,
  RAPIDRAW_PRESET_FORMAT,
  RAPIDRAW_PRESET_SCHEMA_VERSION,
  resolveEditDocumentPresetPayload,
} from '../../../src/utils/editDocumentPreset';
import { selectEditDocumentGeometry, selectEditDocumentNode } from '../../../src/utils/editDocumentSelectors';
import {
  createDefaultEditDocumentV2,
  patchEditDocumentV2Node,
  replaceEditDocumentV2SourceArtifacts,
  setEditDocumentV2NodeEnabled,
} from '../../../src/utils/editDocumentV2';
import { classifyPresetLibraryLoadState } from '../../../src/utils/presetLibraryLoadState';

const targetPath = '/fixture/preset-target.ARW';
const session = createEditorImageSession({ generation: 41, path: targetPath, source: 'cache' });
const selectedImage = {
  exif: null,
  height: 3000,
  isRaw: true,
  isReady: true,
  metadata: null,
  originalUrl: null,
  path: targetPath,
  rawDevelopmentReport: null,
  thumbnailUrl: '',
  width: 4000,
};

const envelope = (
  editDocumentV2: EditDocumentV2CopyPayload,
  overrides: Partial<Omit<Preset, 'editDocumentV2'>> = {},
): Preset => ({
  editDocumentV2,
  format: RAPIDRAW_PRESET_FORMAT,
  id: 'current-preset',
  includeCropTransform: false,
  includeMasks: false,
  name: 'Current preset',
  presetType: 'style',
  schemaVersion: RAPIDRAW_PRESET_SCHEMA_VERSION,
  ...overrides,
});

const toneOnlyPayload = (document: EditDocumentV2, exposure: number): EditDocumentV2CopyPayload => {
  const node = document.nodes['scene_global_color_tone'];
  if (node === undefined) throw new Error('Expected scene-global tone node.');
  return {
    nodes: {
      scene_global_color_tone: {
        ...node,
        params: { ...node.params, exposure },
      },
    },
    schemaVersion: 2,
  };
};

describe('current RapidRaw preset envelope', () => {
  beforeEach(() => {
    const adjustments = { ...structuredClone(INITIAL_ADJUSTMENTS), brightness: 0.2, exposure: -0.5 };
    const editDocumentV2 = patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'scene_global_color_tone', {
      brightness: adjustments.brightness,
      exposure: adjustments.exposure,
    });
    useEditorStore.getState().hydrateEditorRenderAuthority({
      adjustmentRevision: 0,
      editDocumentV2,
      historyCheckpoints: [],
      historyIndex: 0,
      imageSession: session,
      lastEditApplicationReceipt: null,
      selectedImage,
      history: [editDocumentV2],
    });
  });

  test('serializes descriptor-approved nodes, disabled state, and optional geometry without source domains', () => {
    const artifacts = replaceEditDocumentV2SourceArtifacts(
      patchEditDocumentV2Node(
        patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'scene_global_color_tone', { exposure: 1.25 }),
        'geometry',
        { rotation: 3 },
      ),
      { aiPatches: [] },
    );
    const source = setEditDocumentV2NodeEnabled(artifacts, 'scene_global_color_tone', false);
    const style = createEditDocumentPresetPayload(source, false, 'style');

    expect(editDocumentV2CopyPayloadSchema.parse(style)).toEqual(style);
    expect(style.nodes['scene_global_color_tone']).toMatchObject({ enabled: false, params: { exposure: 1.25 } });
    expect(style.nodes).not.toHaveProperty('geometry');
    expect(style.nodes).not.toHaveProperty('lens_correction');
    expect(style.nodes).not.toHaveProperty('layers');
    expect(style.nodes).not.toHaveProperty('source_artifacts');

    const withGeometry = createEditDocumentPresetPayload(source, true, 'style');
    expect(withGeometry.nodes['geometry']?.params['rotation']).toBe(3);
    expect(withGeometry.nodes).toHaveProperty('lens_correction');
    const preview = buildPresetPreviewAdjustments(envelope(withGeometry, { includeCropTransform: true }));
    if (preview === null) throw new Error('Expected geometry preset preview.');
    expect(selectEditDocumentGeometry(preview).rotation).toBe(3);
  });

  test('preserves disabled authored nodes in tool presets', () => {
    const defaults = createDefaultEditDocumentV2();
    const source = setEditDocumentV2NodeEnabled(defaults, 'scene_global_color_tone', false);
    const tool = createEditDocumentPresetPayload(source, false, 'tool');

    expect(tool.nodes['scene_global_color_tone']?.enabled).toBeFalse();
  });

  test('applies only current nodes, preserves unrelated authority, and supports undo/redo', () => {
    const state = useEditorStore.getState();
    const sourceArtifactsBefore = state.editDocumentV2.nodes['source_artifacts'];
    const payload = resolveEditDocumentPresetPayload(
      envelope(toneOnlyPayload(state.editDocumentV2, 0.75)),
      state.editDocumentV2,
    );
    if (payload === null) throw new Error('Expected current preset payload.');
    const request = buildPresetEditTransaction(state, payload, 'preset-apply');
    if (request === null) throw new Error('Expected preset transaction.');

    const result = state.applyEditTransaction(request);
    expect(result).toMatchObject({ nextAdjustmentRevision: 1, noOp: false, source: 'preset' });
    expect(result.after).toMatchObject({ brightness: 0.2, exposure: 0.75 });
    expect(result.afterEditDocumentV2.nodes['source_artifacts']).toBe(sourceArtifactsBefore);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().editDocumentV2.nodes['scene_global_color_tone']!.params['exposure']).toBe(-0.5);
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().editDocumentV2.nodes['scene_global_color_tone']!.params['exposure']).toBe(0.75);
  });

  test('is an exact no-op on reapply and reopens the same strict payload', () => {
    const state = useEditorStore.getState();
    const payload = toneOnlyPayload(state.editDocumentV2, -0.5);
    const resolved = resolveEditDocumentPresetPayload(envelope(payload), state.editDocumentV2);
    if (resolved === null) throw new Error('Expected current preset payload.');
    const request = buildPresetEditTransaction(state, resolved, 'preset-no-op');
    if (request === null) throw new Error('Expected preset transaction.');
    const result = state.applyEditTransaction(request);

    expect(result.noOp).toBeTrue();
    expect(useEditorStore.getState().adjustmentRevision).toBe(0);
    expect(useEditorStore.getState().history).toHaveLength(1);
    expect(editDocumentV2CopyPayloadSchema.parse(structuredClone(payload))).toEqual(payload);
  });

  test('previews only strict current authority and never promotes flat data', () => {
    const document = patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'scene_global_color_tone', {
      exposure: 1.25,
    });
    const current = envelope(createEditDocumentPresetPayload(document, false, 'style'));
    const preview = buildPresetPreviewAdjustments(current);
    if (preview === null) throw new Error('Expected current preset preview.');
    expect(selectEditDocumentNode(preview, 'scene_global_color_tone').params['exposure']).toBe(1.25);

    const flatOnly = { ...current, adjustments: { exposure: -1.75 } };
    const parsed = parsePresetLibrary([{ preset: flatOnly }]);
    expect(parsed).toEqual({ items: [], quarantinedCount: 1 });
  });

  test('mixed current and obsolete native values retain current presets and quarantine obsolete entries', () => {
    const current = envelope(
      createEditDocumentPresetPayload(legacyAdjustmentsToEditDocumentV2(INITIAL_ADJUSTMENTS), false, 'style'),
      { id: 'current', name: 'Current' },
    );
    const obsolete = { preset: { adjustments: { exposure: 0.75 }, id: 'obsolete', name: 'Alaska Proof Look' } };

    const parsed = parsePresetLibrary([{ preset: current }, obsolete]);

    expect(parsed.items).toEqual([{ preset: current }]);
    expect(parsed.quarantinedCount).toBe(1);
    expect(classifyPresetLibraryLoadState('Quarantined 1 invalid preset entries.')).toEqual({
      fatalLoadError: null,
      quarantineNotice: 'Quarantined 1 invalid preset entries.',
    });
    expect(classifyPresetLibraryLoadState('native preset storage unavailable')).toEqual({
      fatalLoadError: 'native preset storage unavailable',
      quarantineNotice: null,
    });
  });

  test('compiles every built-in color style into the same strict current envelope', () => {
    const destination = useEditorStore.getState().editDocumentV2;
    for (const builtIn of BUILT_IN_COLOR_STYLE_PRESETS) {
      const current = buildBuiltInColorStylePreset(builtIn, destination);
      const parsed = parsePresetLibrary([{ preset: current }]);
      expect(parsed.quarantinedCount).toBe(0);
      expect(parsed.items[0]?.preset).toEqual(current);
      expect(current).not.toHaveProperty('adjustments');
      expect(Object.keys(current.editDocumentV2.nodes).length).toBeGreaterThan(0);
    }
  });

  test('configures current authority between style, tool, and optional geometry policies', () => {
    const document = patchEditDocumentV2Node(
      patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'scene_global_color_tone', { exposure: 1 }),
      'geometry',
      { rotation: 4 },
    );
    const style = createEditDocumentPresetPayload(document, false, 'style');
    const configured = configureEditDocumentPresetPayload(envelope(style), true, 'style');
    if (configured === null) throw new Error('Expected current preset configuration.');
    expect(configured.nodes['scene_global_color_tone']?.params['exposure']).toBe(1);
    expect(configured.nodes).toHaveProperty('geometry');
    expect(configured.nodes).not.toHaveProperty('layers');
    expect(configured.nodes).not.toHaveProperty('source_artifacts');

    const tool = configureEditDocumentPresetPayload(
      envelope(configured, { includeCropTransform: true }),
      false,
      'tool',
    );
    if (tool === null) throw new Error('Expected current tool configuration.');
    expect(tool.nodes).not.toHaveProperty('geometry');
    expect(Object.keys(tool.nodes).length).toBeLessThan(Object.keys(configured.nodes).length);
  });

  test('quarantines flat, incomplete, future, malformed, provenance-leaking, and disallowed-node entries', () => {
    const destination = useEditorStore.getState().editDocumentV2;
    const valid = envelope(toneOnlyPayload(destination, 0.25));
    const invalidEntries = [
      { id: 'flat', name: 'Flat', adjustments: { exposure: 1 } },
      { ...valid, editDocumentV2: undefined },
      { ...valid, schemaVersion: 2 },
      { ...valid, editDocumentV2: { nodes: {}, schemaVersion: 2 } },
      { ...valid, editDocumentV2: { ...valid.editDocumentV2, provenance: { source: 'leak' } } },
      {
        ...valid,
        editDocumentV2: { nodes: { source_artifacts: destination.nodes['source_artifacts'] }, schemaVersion: 2 },
      },
    ];
    const parsed = parsePresetLibrary([
      { preset: valid },
      { folder: { children: invalidEntries, id: 'folder', name: 'Folder' } },
      ...invalidEntries.map((preset) => ({ preset })),
    ]);

    expect(parsed.items[0]?.preset).toEqual(valid);
    expect(parsed.items[1]?.folder?.children).toEqual([]);
    expect(parsed.quarantinedCount).toBe(invalidEntries.length * 2);
  });

  test('accepts Lightroom/XMP import only after it returns a current envelope', () => {
    const destination = useEditorStore.getState().editDocumentV2;
    const imported = envelope(toneOnlyPayload(destination, 0.8), {
      id: 'lightroom-current',
      name: 'Lightroom Current',
    });
    const result = parseExternalPresetImportResult({
      diagnostics: [
        {
          code: 'unsupported_external_field',
          field: 'SharpenRadius',
          message: "Lightroom/XMP field 'SharpenRadius' is not supported and was not imported",
        },
      ],
      presets: [{ preset: imported }],
    });

    expect(result.library.quarantinedCount).toBe(0);
    expect(result.library.items[0]?.preset).toEqual(imported);
    const resolved = resolveEditDocumentPresetPayload(imported, destination);
    if (resolved === null) throw new Error('Expected strict imported payload.');
    const transaction = buildPresetEditTransaction(useEditorStore.getState(), resolved, 'external-preset-apply');
    if (transaction === null) throw new Error('Expected imported preset transaction.');
    expect(
      useEditorStore.getState().applyEditTransaction(transaction).after.nodes['scene_global_color_tone']?.params[
        'exposure'
      ],
    ).toBe(0.8);
    const preview = buildPresetPreviewAdjustments(imported);
    if (preview === null) throw new Error('Expected imported preset preview.');
    expect(selectEditDocumentNode(preview, 'scene_global_color_tone').params['exposure']).toBe(0.8);
  });
});
