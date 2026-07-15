import { describe, expect, test } from 'bun:test';
import {
  compileEditDocumentNodeV2,
  compileEditDocumentV2,
  editDocumentV2Schema,
  getEditDocumentNodeDescriptor,
  parseEditDocumentV2WithQuarantine,
} from '../../packages/rawengine-schema/src/editDocumentV2';
import { matchLookApplicationReceiptV1Schema } from '../../packages/rawengine-schema/src/referenceMatchRuntime';
import { INITIAL_ADJUSTMENTS } from '../../src/utils/adjustments';
import {
  batchUpdateEditDocumentV2Nodes,
  buildEditDocumentV2Diagnostics,
  copyEditDocumentV2Node,
  editDocumentV2NodeInventory,
  editDocumentV2ToLegacyAdjustments,
  getEditDocumentV2NodeCapabilities,
  legacyAdjustmentsToEditDocumentV2,
  pasteEditDocumentV2Node,
  prepareEditDocumentV2ForRender,
  replaceEditDocumentV2SourceArtifacts,
  resetEditDocumentV2Node,
  updateEditDocumentV2Node,
} from '../../src/utils/editDocumentV2';

const referenceMatchReceipt = matchLookApplicationReceiptV1Schema.parse({
  appliedDiffs: [{ after: 0.75, before: 0, key: 'exposure' }],
  appliedAt: '2026-07-14T20:00:00.000Z',
  baseGraphFingerprint: `fnv1a64:${'0'.repeat(16)}`,
  destination: 'global-adjustments',
  effectiveReferences: [{ role: 'creative', sourceFingerprint: `fnv1a64:${'4'.repeat(16)}`, weight: 1 }],
  enabledGroups: ['tone'],
  historyEntriesAdded: 1,
  impact: 75,
  proposalFingerprint: `fnv1a64:${'1'.repeat(16)}`,
  resultingGraphFingerprint: `fnv1a64:${'2'.repeat(16)}`,
  schemaVersion: 1,
  targetAnalysisFingerprint: `fnv1a64:${'3'.repeat(16)}`,
});

const sourcePatch = {
  id: 'patch-1',
  invert: false,
  isLoading: false,
  name: 'Repair',
  patchData: { pixels: 'resident-payload' },
  prompt: 'remove distraction',
  subMasks: [
    {
      id: 'mask-1',
      invert: false,
      mode: 'additive' as const,
      opacity: 80,
      parameters: { mask_data_base64: 'encoded-mask' },
      type: 'brush' as const,
      visible: true,
    },
  ],
  visible: true,
};

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
      'tone_equalizer',
      'display_creative',
      'detail_denoise_dehaze',
      'point_color',
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
    expect(first.nodes.source_artifacts?.params).toEqual(first.sourceArtifacts);
    expect(first.nodes.source_artifacts?.params).not.toHaveProperty('referenceMatchApplicationReceipt');
    expect(first.provenance.referenceMatchApplicationReceipt).toEqual(referenceMatchReceipt);
    expect(first.extensions.legacyAdjustments).toMatchObject({ generatedProfile: { obsolete: true } });
    expect(reopened).toEqual(first);
  });

  test('defaults and strictly validates the render-authoritative layers domain', () => {
    const { masks: _legacyMasks, ...legacyWithoutMasks } = structuredClone(INITIAL_ADJUSTMENTS);
    const defaulted = legacyAdjustmentsToEditDocumentV2(legacyWithoutMasks);
    expect(defaulted.layers).toEqual({ masks: [] });
    expect(defaulted.nodes.layers?.params).toEqual(defaulted.layers);

    const layer = {
      adjustments: { exposure: 0.4 },
      blendMode: 'overlay' as const,
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
    expect(compileEditDocumentNodeV2(document.nodes.layers).params).toEqual(document.layers);

    expect(() =>
      editDocumentV2Schema.parse({
        ...document,
        layers: { masks: [layer, layer] },
        nodes: { ...document.nodes, layers: { ...document.nodes.layers, params: { masks: [layer, layer] } } },
      }),
    ).toThrow('unique');
    expect(() =>
      editDocumentV2Schema.parse({
        ...document,
        layers: { masks: [{ ...layer, opacity: 101 }] },
        nodes: { ...document.nodes, layers: { ...document.nodes.layers, params: document.layers } },
      }),
    ).toThrow();
    expect(() => editDocumentV2Schema.parse({ ...document, layers: { masks: [] } })).toThrow('disagrees');
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

  test('scene global tone params are strict, finite, and bounded', () => {
    const document = legacyAdjustmentsToEditDocumentV2(INITIAL_ADJUSTMENTS);
    const node = document.nodes.scene_global_color_tone;
    expect(() =>
      editDocumentV2Schema.parse({
        ...document,
        nodes: {
          ...document.nodes,
          scene_global_color_tone: { ...node, params: { ...node?.params, exposure: 6 } },
        },
      }),
    ).toThrow();
    expect(() =>
      editDocumentV2Schema.parse({
        ...document,
        nodes: {
          ...document.nodes,
          scene_global_color_tone: { ...node, params: { ...node?.params, futureTone: 1 } },
        },
      }),
    ).toThrow();
  });

  test('camera input defaults legacy state and rejects malformed render authority', () => {
    const {
      cameraProfileAmount: _cameraProfileAmount,
      whiteBalanceMigration: _whiteBalanceMigration,
      whiteBalanceTechnical: _whiteBalanceTechnical,
      ...legacyCameraInput
    } = structuredClone(INITIAL_ADJUSTMENTS);
    const defaulted = legacyAdjustmentsToEditDocumentV2(legacyCameraInput);
    expect(defaulted.nodes.camera_input?.params).toMatchObject({
      cameraProfile: 'camera_standard',
      cameraProfileAmount: 100,
      whiteBalanceMigration: 'native_v1',
      whiteBalanceTechnical: { contract: 'rapidraw.white_balance.v1', mode: 'as_shot', source: 'as_shot' },
    });
    expect(defaulted.migration?.defaulted).toEqual(
      expect.arrayContaining([
        'camera_input.cameraProfileAmount',
        'camera_input.whiteBalanceMigration',
        'camera_input.whiteBalanceTechnical',
      ]),
    );

    const document = legacyAdjustmentsToEditDocumentV2(INITIAL_ADJUSTMENTS);
    const cameraNode = document.nodes.camera_input;
    expect(compileEditDocumentNodeV2(cameraNode).params).toEqual(cameraNode?.params);
    expect(() =>
      editDocumentV2Schema.parse({
        ...document,
        nodes: {
          ...document.nodes,
          camera_input: { ...cameraNode, params: { ...cameraNode?.params, cameraProfileAmount: 101 } },
        },
      }),
    ).toThrow();
    expect(() =>
      editDocumentV2Schema.parse({
        ...document,
        nodes: {
          ...document.nodes,
          camera_input: {
            ...cameraNode,
            params: {
              ...cameraNode?.params,
              whiteBalanceTechnical: { ...INITIAL_ADJUSTMENTS.whiteBalanceTechnical, kelvin: 1200 },
            },
          },
        },
      }),
    ).toThrow();
    expect(() =>
      editDocumentV2Schema.parse({
        ...document,
        nodes: {
          ...document.nodes,
          camera_input: { ...cameraNode, params: { ...cameraNode?.params, futureInput: 1 } },
        },
      }),
    ).toThrow();
  });

  test('detail defaults legacy state and rejects malformed render authority', () => {
    const {
      clarity: _clarity,
      colorNoiseReduction: _colorNoiseReduction,
      dehaze: _dehaze,
      denoiseContrastProtection: _denoiseContrastProtection,
      denoiseDetail: _denoiseDetail,
      denoiseNaturalGrain: _denoiseNaturalGrain,
      denoiseShadowBias: _denoiseShadowBias,
      lumaNoiseReduction: _lumaNoiseReduction,
      ...legacyDetail
    } = structuredClone(INITIAL_ADJUSTMENTS);
    const defaulted = legacyAdjustmentsToEditDocumentV2({ ...legacyDetail, sharpness: 24 });
    expect(defaulted.nodes.detail_denoise_dehaze?.params).toEqual({
      clarity: 0,
      colorNoiseReduction: 0,
      dehaze: 0,
      denoiseContrastProtection: 50,
      denoiseDetail: 50,
      denoiseNaturalGrain: 0,
      denoiseShadowBias: 0,
      lumaNoiseReduction: 0,
      sharpness: 24,
    });
    expect(defaulted.migration?.defaulted).toEqual(
      expect.arrayContaining([
        'detail_denoise_dehaze.clarity',
        'detail_denoise_dehaze.denoiseContrastProtection',
        'detail_denoise_dehaze.denoiseDetail',
      ]),
    );
    expect(compileEditDocumentNodeV2(defaulted.nodes.detail_denoise_dehaze).params.sharpness).toBe(24);

    const detailNode = defaulted.nodes.detail_denoise_dehaze;
    expect(() =>
      editDocumentV2Schema.parse({
        ...defaulted,
        nodes: {
          ...defaulted.nodes,
          detail_denoise_dehaze: { ...detailNode, params: { ...detailNode?.params, futureDetail: true } },
        },
      }),
    ).toThrow();
    expect(() =>
      editDocumentV2Schema.parse({
        ...defaulted,
        nodes: {
          ...defaulted.nodes,
          detail_denoise_dehaze: {
            ...detailNode,
            params: { ...detailNode?.params, lumaNoiseReduction: -1 },
          },
        },
      }),
    ).toThrow();
  });

  test('display creative owns current Effects state and quarantines stale fields', () => {
    const {
      flareAmount: _flareAmount,
      glowAmount: _glowAmount,
      grainAmount: _grainAmount,
      grainRoughness: _grainRoughness,
      grainSize: _grainSize,
      halationAmount: _halationAmount,
      lutData: _lutData,
      lutIntensity: _lutIntensity,
      lutName: _lutName,
      lutPath: _lutPath,
      lutSize: _lutSize,
      vignetteAmount: _vignetteAmount,
      vignetteFeather: _vignetteFeather,
      vignetteMidpoint: _vignetteMidpoint,
      vignetteRoundness: _vignetteRoundness,
      ...legacyDisplay
    } = structuredClone(INITIAL_ADJUSTMENTS);
    const defaulted = legacyAdjustmentsToEditDocumentV2({
      ...legacyDisplay,
      filmCurve: { obsolete: true },
      vignetteAmount: -32,
    });
    expect(defaulted.nodes.display_creative?.params).toEqual({
      flareAmount: 0,
      glowAmount: 0,
      grainAmount: 0,
      grainRoughness: 50,
      grainSize: 25,
      halationAmount: 0,
      lutData: null,
      lutIntensity: 100,
      lutName: null,
      lutPath: null,
      lutSize: 0,
      vignetteAmount: -32,
      vignetteFeather: 50,
      vignetteMidpoint: 50,
      vignetteRoundness: 0,
    });
    expect(defaulted.extensions.legacyAdjustments).toMatchObject({ filmCurve: { obsolete: true } });
    expect(defaulted.migration?.quarantined).toContain('filmCurve');
    expect(defaulted.migration?.defaulted).toEqual(
      expect.arrayContaining([
        'display_creative.grainAmount',
        'display_creative.lutIntensity',
        'display_creative.vignetteFeather',
      ]),
    );
    expect(compileEditDocumentNodeV2(defaulted.nodes.display_creative).params.vignetteAmount).toBe(-32);

    const displayNode = defaulted.nodes.display_creative;
    expect(() =>
      editDocumentV2Schema.parse({
        ...defaulted,
        nodes: {
          ...defaulted.nodes,
          display_creative: { ...displayNode, params: { ...displayNode?.params, futureDisplay: true } },
        },
      }),
    ).toThrow();
    expect(() =>
      editDocumentV2Schema.parse({
        ...defaulted,
        nodes: {
          ...defaulted.nodes,
          display_creative: { ...displayNode, params: { ...displayNode?.params, vignetteAmount: 101 } },
        },
      }),
    ).toThrow();
  });

  test('tone equalizer defaults legacy state and rejects malformed render authority', () => {
    const { toneEqualizer: _toneEqualizer, ...legacyToneEqualizer } = structuredClone(INITIAL_ADJUSTMENTS);
    const defaulted = legacyAdjustmentsToEditDocumentV2(legacyToneEqualizer);
    expect(defaulted.nodes.tone_equalizer?.params).toEqual({
      toneEqualizer: {
        autoPlacement: false,
        bandEv: [0, 0, 0, 0, 0, 0, 0, 0, 0],
        detailPreservation: 0.65,
        edgeRefinement: 2,
        enabled: false,
        maskExposureCompensation: 0,
        pivotEv: 0,
        previewMode: 0,
        rangeEv: 16,
        selectedBand: 4,
        smoothingRadius: 32,
      },
    });
    expect(defaulted.migration?.defaulted).toContain('tone_equalizer.toneEqualizer');
    expect(compileEditDocumentNodeV2(defaulted.nodes.tone_equalizer).params.toneEqualizer).toEqual(
      defaulted.nodes.tone_equalizer?.params.toneEqualizer,
    );

    const node = defaulted.nodes.tone_equalizer;
    expect(() =>
      editDocumentV2Schema.parse({
        ...defaulted,
        nodes: {
          ...defaulted.nodes,
          tone_equalizer: {
            ...node,
            params: {
              toneEqualizer: { ...defaulted.nodes.tone_equalizer?.params.toneEqualizer, futureBand: true },
            },
          },
        },
      }),
    ).toThrow();
    expect(() =>
      editDocumentV2Schema.parse({
        ...defaulted,
        nodes: {
          ...defaulted.nodes,
          tone_equalizer: {
            ...node,
            params: {
              toneEqualizer: { ...defaulted.nodes.tone_equalizer?.params.toneEqualizer, selectedBand: 9 },
            },
          },
        },
      }),
    ).toThrow();
  });

  test('point color defaults legacy state and rejects malformed render authority', () => {
    const { pointColor: _pointColor, ...legacyPointColor } = structuredClone(INITIAL_ADJUSTMENTS);
    const defaulted = legacyAdjustmentsToEditDocumentV2(legacyPointColor);
    expect(defaulted.nodes.point_color?.params).toEqual({ pointColor: INITIAL_ADJUSTMENTS.pointColor });
    expect(defaulted.migration?.defaulted).toContain('point_color.pointColor');
    expect(compileEditDocumentNodeV2(defaulted.nodes.point_color).params.pointColor).toEqual(
      defaulted.nodes.point_color?.params.pointColor,
    );

    const node = defaulted.nodes.point_color;
    expect(() =>
      editDocumentV2Schema.parse({
        ...defaulted,
        nodes: {
          ...defaulted.nodes,
          point_color: {
            ...node,
            params: { pointColor: { ...defaulted.nodes.point_color?.params.pointColor, futurePoint: true } },
          },
        },
      }),
    ).toThrow();
    expect(() =>
      editDocumentV2Schema.parse({
        ...defaulted,
        nodes: {
          ...defaulted.nodes,
          point_color: {
            ...node,
            params: {
              pointColor: { ...defaulted.nodes.point_color?.params.pointColor, visualizeMode: 'heatmap' },
            },
          },
        },
      }),
    ).toThrow();
  });

  test('scene curves default legacy state and reject malformed render authority', () => {
    const {
      curveMode: _curveMode,
      curves: _curves,
      parametricCurve: _parametricCurve,
      pointCurves: _pointCurves,
      toneCurve: _toneCurve,
      ...legacyCurves
    } = structuredClone(INITIAL_ADJUSTMENTS);
    const defaulted = legacyAdjustmentsToEditDocumentV2(legacyCurves);
    expect(defaulted.nodes.scene_curve?.params).toMatchObject({
      curveMode: 'point',
      toneCurve: 'auto_filmic',
    });
    expect(defaulted.migration?.defaulted).toEqual(
      expect.arrayContaining([
        'scene_curve.curveMode',
        'scene_curve.curves',
        'scene_curve.parametricCurve',
        'scene_curve.pointCurves',
        'scene_curve.toneCurve',
      ]),
    );

    const document = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      outputCurveV1: {
        domain: 'view_encoded',
        peakNits: 203,
        points: [
          { input: 0, output: 0 },
          { input: 1, output: 1 },
        ],
        sdrReferenceWhiteNits: 203,
        targetIdentity: 'rapid-view-default',
      },
      sceneCurveV1: {
        channelMode: 'luminance_preserving',
        middleGrey: 0.18,
        points: [
          { xEv: -16, yEv: -16 },
          { xEv: 16, yEv: 16 },
        ],
      },
    });
    const sceneNode = document.nodes.scene_curve;
    expect(compileEditDocumentNodeV2(sceneNode).params).toEqual(sceneNode?.params);

    expect(() =>
      editDocumentV2Schema.parse({
        ...document,
        nodes: {
          ...document.nodes,
          scene_curve: {
            ...sceneNode,
            params: {
              ...sceneNode?.params,
              curves: {
                ...INITIAL_ADJUSTMENTS.curves,
                luma: Array.from({ length: 17 }, (_, index) => ({ x: index, y: index })),
              },
            },
          },
        },
      }),
    ).toThrow();
    expect(() =>
      editDocumentV2Schema.parse({
        ...document,
        nodes: {
          ...document.nodes,
          scene_curve: {
            ...sceneNode,
            params: {
              ...sceneNode?.params,
              parametricCurve: {
                ...INITIAL_ADJUSTMENTS.parametricCurve,
                luma: { ...INITIAL_ADJUSTMENTS.parametricCurve?.luma, split2: 20 },
              },
            },
          },
        },
      }),
    ).toThrow();
    expect(() =>
      editDocumentV2Schema.parse({
        ...document,
        nodes: {
          ...document.nodes,
          scene_curve: {
            ...sceneNode,
            params: {
              ...sceneNode?.params,
              sceneCurveV1: {
                channelMode: 'linked_rgb',
                middleGrey: 0.18,
                points: [
                  { xEv: -1, yEv: 1 },
                  { xEv: 1, yEv: 0 },
                ],
              },
            },
          },
        },
      }),
    ).toThrow();
    expect(() =>
      editDocumentV2Schema.parse({
        ...document,
        nodes: {
          ...document.nodes,
          scene_curve: { ...sceneNode, params: { ...sceneNode?.params, futureCurve: true } },
        },
      }),
    ).toThrow();
  });

  test('geometry is strict, bounded, unit-explicit, and atomically mirrored into its domain', () => {
    const legacyPixelCrop = { height: 1800, width: 2400, x: 400, y: 300 };
    const document = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      crop: legacyPixelCrop,
    });
    expect(document.geometry.crop).toEqual({ ...legacyPixelCrop, unit: 'px' });
    expect(document.migration?.defaulted).toContain('geometry.crop.unit');
    const reopened = legacyAdjustmentsToEditDocumentV2(editDocumentV2ToLegacyAdjustments(document));
    expect(reopened.geometry).toEqual(document.geometry);
    expect(reopened.nodes.geometry).toEqual(document.nodes.geometry);

    const next = updateEditDocumentV2Node(document, 'geometry', (params) => ({
      ...params,
      crop: { height: 0.7, width: 0.8, x: 0.1, y: 0.2 },
      rotation: 2.5,
    }));
    expect(next.geometry).toEqual(next.nodes.geometry?.params);
    expect(next.geometry.crop).toEqual({ height: 0.7, unit: 'normalized', width: 0.8, x: 0.1, y: 0.2 });
    expect(next.nodes.scene_global_color_tone).toBe(document.nodes.scene_global_color_tone);
    expect(next.provenance).toBe(document.provenance);

    expect(() =>
      editDocumentV2Schema.parse({
        ...next,
        geometry: { ...next.geometry, rotation: 46 },
        nodes: { ...next.nodes, geometry: { ...next.nodes.geometry, params: { ...next.geometry, rotation: 46 } } },
      }),
    ).toThrow();
    expect(() =>
      editDocumentV2Schema.parse({
        ...next,
        geometry: { ...next.geometry, unsupported: true },
        nodes: {
          ...next.nodes,
          geometry: { ...next.nodes.geometry, params: { ...next.geometry, unsupported: true } },
        },
      }),
    ).toThrow();
    expect(() => editDocumentV2Schema.parse({ ...next, geometry: document.geometry })).toThrow('disagrees');
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
      provenance: { referenceMatchApplicationReceipt: null },
    });

    expect(next.nodes.geometry).toEqual(document.nodes.geometry);
    expect(next.provenance).toEqual({ referenceMatchApplicationReceipt: null });
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

  test('render preparation keeps payload residency while overlaying authoritative migrated nodes', () => {
    const authoritative = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      crop: { height: 1800, unit: 'px', width: 2400, x: 400, y: 300 },
      exposure: 1.25,
    });
    const prepared = {
      ...structuredClone(INITIAL_ADJUSTMENTS),
      aiPatches: [],
      exposure: -2,
    };
    const renderDocument = prepareEditDocumentV2ForRender(prepared, authoritative, [
      'geometry',
      'scene_global_color_tone',
    ]);

    expect(renderDocument.nodes.geometry).toBe(authoritative.nodes.geometry);
    expect(renderDocument.geometry).toEqual(authoritative.geometry);
    expect(renderDocument.nodes.scene_global_color_tone).toBe(authoritative.nodes.scene_global_color_tone);
    expect(renderDocument.nodes.scene_global_color_tone?.params.exposure).toBe(1.25);
    expect(renderDocument.nodes.source_artifacts?.params.aiPatches).toEqual([]);
  });

  test('render preparation overlays the authoritative camera-input envelope', () => {
    const authoritative = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      cameraProfile: 'camera_neutral',
      whiteBalanceTechnical: {
        ...structuredClone(INITIAL_ADJUSTMENTS.whiteBalanceTechnical),
        mode: 'chromaticity',
        source: 'picker',
      },
    });
    const prepared = structuredClone(INITIAL_ADJUSTMENTS);
    const preparedDocument = legacyAdjustmentsToEditDocumentV2(prepared);
    const renderDocument = prepareEditDocumentV2ForRender(prepared, authoritative, ['camera_input']);

    expect(renderDocument.nodes.camera_input).toBe(authoritative.nodes.camera_input);
    expect(renderDocument.nodes.camera_input?.params).toMatchObject({
      cameraProfile: 'camera_neutral',
      whiteBalanceTechnical: { mode: 'chromaticity', source: 'picker' },
    });
    expect(renderDocument.nodes.geometry).toEqual(preparedDocument.nodes.geometry);
    expect(renderDocument.nodes.scene_global_color_tone).toEqual(preparedDocument.nodes.scene_global_color_tone);
  });

  test('render preparation overlays the authoritative scene-curve envelope', () => {
    const authoritative = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      curveMode: 'parametric',
      toneCurve: 'shadow_lift',
    });
    const prepared = structuredClone(INITIAL_ADJUSTMENTS);
    const preparedDocument = legacyAdjustmentsToEditDocumentV2(prepared);
    const renderDocument = prepareEditDocumentV2ForRender(prepared, authoritative, ['scene_curve']);

    expect(renderDocument.nodes.scene_curve).toBe(authoritative.nodes.scene_curve);
    expect(renderDocument.nodes.scene_curve?.params).toMatchObject({
      curveMode: 'parametric',
      toneCurve: 'shadow_lift',
    });
    expect(renderDocument.nodes.camera_input).toEqual(preparedDocument.nodes.camera_input);
    expect(renderDocument.nodes.geometry).toEqual(preparedDocument.nodes.geometry);
  });

  test('render preparation overlays the authoritative detail envelope', () => {
    const authoritative = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      clarity: 26,
      denoiseShadowBias: -18,
      sharpness: 42,
    });
    const prepared = structuredClone(INITIAL_ADJUSTMENTS);
    const preparedDocument = legacyAdjustmentsToEditDocumentV2(prepared);
    const renderDocument = prepareEditDocumentV2ForRender(prepared, authoritative, ['detail_denoise_dehaze']);

    expect(renderDocument.nodes.detail_denoise_dehaze).toBe(authoritative.nodes.detail_denoise_dehaze);
    expect(renderDocument.nodes.detail_denoise_dehaze?.params).toMatchObject({
      clarity: 26,
      denoiseShadowBias: -18,
      sharpness: 42,
    });
    expect(renderDocument.nodes.camera_input).toEqual(preparedDocument.nodes.camera_input);
    expect(renderDocument.nodes.scene_curve).toEqual(preparedDocument.nodes.scene_curve);
  });

  test('render preparation overlays the authoritative display-creative envelope', () => {
    const authoritative = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      glowAmount: 12,
      grainAmount: 28,
      vignetteAmount: -32,
    });
    const prepared = structuredClone(INITIAL_ADJUSTMENTS);
    const preparedDocument = legacyAdjustmentsToEditDocumentV2(prepared);
    const renderDocument = prepareEditDocumentV2ForRender(prepared, authoritative, ['display_creative']);

    expect(renderDocument.nodes.display_creative).toBe(authoritative.nodes.display_creative);
    expect(renderDocument.nodes.display_creative?.params).toMatchObject({
      glowAmount: 12,
      grainAmount: 28,
      vignetteAmount: -32,
    });
    expect(renderDocument.nodes.detail_denoise_dehaze).toEqual(preparedDocument.nodes.detail_denoise_dehaze);
    expect(renderDocument.nodes.scene_curve).toEqual(preparedDocument.nodes.scene_curve);
  });

  test('render preparation overlays the authoritative tone-equalizer envelope', () => {
    const authoritative = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      toneEqualizer: {
        ...structuredClone(INITIAL_ADJUSTMENTS.toneEqualizer),
        bandEv: [0, 0, 0, 0, 0.75, 0, 0, 0, 0],
        enabled: true,
      },
    });
    const prepared = structuredClone(INITIAL_ADJUSTMENTS);
    const preparedDocument = legacyAdjustmentsToEditDocumentV2(prepared);
    const renderDocument = prepareEditDocumentV2ForRender(prepared, authoritative, ['tone_equalizer']);

    expect(renderDocument.nodes.tone_equalizer).toBe(authoritative.nodes.tone_equalizer);
    expect(renderDocument.nodes.tone_equalizer?.params.toneEqualizer).toMatchObject({
      bandEv: [0, 0, 0, 0, 0.75, 0, 0, 0, 0],
      enabled: true,
    });
    expect(renderDocument.nodes.display_creative).toEqual(preparedDocument.nodes.display_creative);
    expect(renderDocument.nodes.scene_curve).toEqual(preparedDocument.nodes.scene_curve);
  });

  test('render preparation overlays the authoritative point-color envelope', () => {
    const authoritative = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      pointColor: { ...structuredClone(INITIAL_ADJUSTMENTS.pointColor), enabled: true, visualizeMode: 'range' },
    });
    const prepared = structuredClone(INITIAL_ADJUSTMENTS);
    const preparedDocument = legacyAdjustmentsToEditDocumentV2(prepared);
    const renderDocument = prepareEditDocumentV2ForRender(prepared, authoritative, ['point_color']);

    expect(renderDocument.nodes.point_color).toBe(authoritative.nodes.point_color);
    expect(renderDocument.nodes.point_color?.params.pointColor).toMatchObject({
      enabled: true,
      visualizeMode: 'range',
    });
    expect(renderDocument.nodes.display_creative).toEqual(preparedDocument.nodes.display_creative);
    expect(renderDocument.nodes.scene_curve).toEqual(preparedDocument.nodes.scene_curve);
  });

  test('render preparation transfers the layers envelope and explicit domain together', () => {
    const layer = {
      adjustments: { saturation: 12 },
      id: 'authoritative-layer',
      invert: false,
      name: 'Authoritative layer',
      opacity: 80,
      subMasks: [],
      visible: true,
    };
    const authoritative = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      masks: [layer],
    });
    const prepared = { ...structuredClone(INITIAL_ADJUSTMENTS), masks: [] };
    const renderDocument = prepareEditDocumentV2ForRender(prepared, authoritative, ['layers']);

    expect(renderDocument.nodes.layers).toBe(authoritative.nodes.layers);
    expect(renderDocument.layers).toEqual({ masks: [layer] });
    expect(renderDocument.nodes.layers?.params).toEqual(renderDocument.layers);
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

  test('batch edits honor descriptor capability and preserve each document domain', () => {
    const documents = [
      legacyAdjustmentsToEditDocumentV2({ ...structuredClone(INITIAL_ADJUSTMENTS), exposure: 0.1 }),
      legacyAdjustmentsToEditDocumentV2({ ...structuredClone(INITIAL_ADJUSTMENTS), exposure: 0.2 }),
    ];
    const updated = batchUpdateEditDocumentV2Nodes(documents, 'scene_global_color_tone', (params, index) => ({
      ...params,
      exposure: index + 1,
    }));
    expect(updated?.map((document) => document.nodes.scene_global_color_tone?.params.exposure)).toEqual([1, 2]);
    expect(updated?.[0]?.nodes.geometry).toEqual(documents[0]?.nodes.geometry);
    expect(batchUpdateEditDocumentV2Nodes(documents, 'layers', () => ({}))).toBeNull();
    expect(batchUpdateEditDocumentV2Nodes(documents, 'source_artifacts', () => ({}))).toBeNull();
  });

  test('diagnostics expose node ownership, migration, quarantine, and render fingerprints', () => {
    const document = legacyAdjustmentsToEditDocumentV2({ ...structuredClone(INITIAL_ADJUSTMENTS), exposure: 0.75 });
    const diagnostics = buildEditDocumentV2Diagnostics({
      ...document,
      extensions: { ...document.extensions, quarantinedNodes: { future_color_v9: { enabled: true } } },
      nodes: {
        ...document.nodes,
        scene_curve: { ...document.nodes.scene_curve, enabled: false },
      },
    });

    expect(diagnostics.schemaVersion).toBe(2);
    expect(diagnostics.activeNodeTypes).toEqual(editDocumentV2NodeInventory(document));
    expect(diagnostics.legacyNodeTypes).toEqual(['geometry']);
    expect(diagnostics.nodeDiagnostics.find(({ nodeType }) => nodeType === 'scene_curve')?.status).toBe('disabled');
    expect(diagnostics.quarantinedNodeTypes).toEqual(['future_color_v9']);
    expect(diagnostics.renderStageFingerprints[0]?.fingerprint).toContain('scene_global_color_tone');
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

  test('source-artifact replacement is atomic and structurally isolates unrelated nodes', () => {
    const document = legacyAdjustmentsToEditDocumentV2(INITIAL_ADJUSTMENTS);
    const next = replaceEditDocumentV2SourceArtifacts(document, { aiPatches: [sourcePatch] });

    expect(next.sourceArtifacts.aiPatches).toEqual([sourcePatch]);
    expect(next.nodes.source_artifacts?.params).toEqual(next.sourceArtifacts);
    expect(next.nodes.scene_global_color_tone).toBe(document.nodes.scene_global_color_tone);
    expect(next.nodes.geometry).toBe(document.nodes.geometry);
    expect(next.provenance).toEqual(document.provenance);
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

  test('compiles graph nodes in descriptor order with render-stage authority', () => {
    const document = legacyAdjustmentsToEditDocumentV2(INITIAL_ADJUSTMENTS);
    const compiled = compileEditDocumentV2(document);
    expect(compiled.map(({ nodeType }) => nodeType)).toEqual(editDocumentV2NodeInventory(document));
    expect(compiled.find(({ nodeType }) => nodeType === 'geometry')).toMatchObject({
      nodeType: 'geometry',
      process: 'legacy_pipeline_v1',
      renderStage: 'geometry',
    });
  });

  test('rejects unsupported node process/version before render compilation', () => {
    const document = legacyAdjustmentsToEditDocumentV2(INITIAL_ADJUSTMENTS);
    expect(() =>
      compileEditDocumentNodeV2({
        ...document.nodes.geometry,
        process: 'scene_referred_v2',
      }),
    ).toThrow('incompatible process');
    expect(() =>
      compileEditDocumentNodeV2({
        ...document.nodes.geometry,
        implementationVersion: 2,
      }),
    ).toThrow('unsupported version');
    expect(() =>
      compileEditDocumentNodeV2({
        ...document.nodes.scene_global_color_tone,
        params: { ...document.nodes.scene_global_color_tone?.params, exposure: 6 },
      }),
    ).toThrow();
  });
});
