import { describe, expect, test } from 'bun:test';
import type {
  EditDocumentNodeEnvelopeV2,
  EditDocumentNodeTypeV2,
  EditDocumentV2,
} from '../../../packages/rawengine-schema/src/editDocumentV2';
import {
  compileEditDocumentNodeV2,
  editDocumentColorCalibrationV2Schema,
  editDocumentDisplayCreativeV2Schema,
  editDocumentGeometryV2Schema,
  editDocumentPerceptualGradingV2Schema,
  editDocumentPointColorV2Schema,
  editDocumentSceneCurveV2Schema,
  editDocumentToneEqualizerV2Schema,
  editDocumentV2Schema,
} from '../../../packages/rawengine-schema/src/editDocumentV2';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { perceptualGradingFromWheelSurface } from '../../../src/utils/color/perceptualGrading';
import {
  editDocumentV2ToLegacyAdjustments,
  legacyAdjustmentsToEditDocumentV2,
  updateEditDocumentV2Node,
} from '../../../src/utils/editDocumentV2';

const requireNode = (document: EditDocumentV2, nodeType: EditDocumentNodeTypeV2): EditDocumentNodeEnvelopeV2 => {
  const node = document.nodes[nodeType];
  if (node === undefined) throw new Error(`expected ${nodeType} fixture`);
  return node;
};

describe('EditDocumentV2 creative curves and geometry', () => {
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
    expect(editDocumentDisplayCreativeV2Schema.parse(requireNode(defaulted, 'display_creative').params)).toEqual({
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
    expect(defaulted.extensions['legacyAdjustments']).toMatchObject({ filmCurve: { obsolete: true } });
    expect(defaulted.migration?.quarantined).toContain('filmCurve');
    expect(defaulted.migration?.defaulted).toEqual(
      expect.arrayContaining([
        'display_creative.grainAmount',
        'display_creative.lutIntensity',
        'display_creative.vignetteFeather',
      ]),
    );
    expect(
      editDocumentDisplayCreativeV2Schema.parse(
        compileEditDocumentNodeV2(requireNode(defaulted, 'display_creative')).params,
      ).vignetteAmount,
    ).toBe(-32);

    const displayNode = requireNode(defaulted, 'display_creative');
    expect(() =>
      editDocumentV2Schema.parse({
        ...defaulted,
        nodes: {
          ...defaulted.nodes,
          display_creative: { ...displayNode, params: { ...displayNode.params, futureDisplay: true } },
        },
      }),
    ).toThrow();
    expect(() =>
      editDocumentV2Schema.parse({
        ...defaulted,
        nodes: {
          ...defaulted.nodes,
          display_creative: { ...displayNode, params: { ...displayNode.params, vignetteAmount: 101 } },
        },
      }),
    ).toThrow();
  });

  test('tone equalizer defaults legacy state and rejects malformed render authority', () => {
    const { toneEqualizer: _toneEqualizer, ...legacyToneEqualizer } = structuredClone(INITIAL_ADJUSTMENTS);
    const defaulted = legacyAdjustmentsToEditDocumentV2(legacyToneEqualizer);
    expect(editDocumentToneEqualizerV2Schema.parse(requireNode(defaulted, 'tone_equalizer').params)).toEqual({
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
    const toneEqualizerParams = editDocumentToneEqualizerV2Schema.parse(
      requireNode(defaulted, 'tone_equalizer').params,
    );
    expect(
      editDocumentToneEqualizerV2Schema.parse(
        compileEditDocumentNodeV2(requireNode(defaulted, 'tone_equalizer')).params,
      ).toneEqualizer,
    ).toEqual(toneEqualizerParams.toneEqualizer);

    const node = requireNode(defaulted, 'tone_equalizer');
    expect(() =>
      editDocumentV2Schema.parse({
        ...defaulted,
        nodes: {
          ...defaulted.nodes,
          tone_equalizer: {
            ...node,
            params: {
              toneEqualizer: { ...toneEqualizerParams.toneEqualizer, futureBand: true },
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
              toneEqualizer: { ...toneEqualizerParams.toneEqualizer, selectedBand: 9 },
            },
          },
        },
      }),
    ).toThrow();
  });

  test('point color defaults legacy state and rejects malformed render authority', () => {
    const { pointColor: _pointColor, ...legacyPointColor } = structuredClone(INITIAL_ADJUSTMENTS);
    const defaulted = legacyAdjustmentsToEditDocumentV2(legacyPointColor);
    expect(editDocumentPointColorV2Schema.parse(requireNode(defaulted, 'point_color').params)).toEqual({
      pointColor: INITIAL_ADJUSTMENTS.pointColor,
    });
    expect(defaulted.migration?.defaulted).toContain('point_color.pointColor');
    const pointColorParams = editDocumentPointColorV2Schema.parse(requireNode(defaulted, 'point_color').params);
    expect(
      editDocumentPointColorV2Schema.parse(compileEditDocumentNodeV2(requireNode(defaulted, 'point_color')).params)
        .pointColor,
    ).toEqual(pointColorParams.pointColor);

    const node = requireNode(defaulted, 'point_color');
    expect(() =>
      editDocumentV2Schema.parse({
        ...defaulted,
        nodes: {
          ...defaulted.nodes,
          point_color: {
            ...node,
            params: { pointColor: { ...pointColorParams.pointColor, futurePoint: true } },
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
              pointColor: { ...pointColorParams.pointColor, visualizeMode: 'heatmap' },
            },
          },
        },
      }),
    ).toThrow();
  });

  test('perceptual grading defaults legacy state and rejects malformed render authority', () => {
    const {
      colorGrading: _colorGrading,
      perceptualGradingV1: _perceptualGradingV1,
      ...legacyGrading
    } = structuredClone(INITIAL_ADJUSTMENTS);
    const defaulted = legacyAdjustmentsToEditDocumentV2(legacyGrading);
    expect(editDocumentPerceptualGradingV2Schema.parse(requireNode(defaulted, 'perceptual_grading').params)).toEqual({
      colorGrading: INITIAL_ADJUSTMENTS.colorGrading,
      perceptualGradingV1: perceptualGradingFromWheelSurface(INITIAL_ADJUSTMENTS.colorGrading),
    });
    expect(defaulted.migration?.defaulted).toEqual(
      expect.arrayContaining(['perceptual_grading.colorGrading', 'perceptual_grading.perceptualGradingV1']),
    );
    const perceptualParams = editDocumentPerceptualGradingV2Schema.parse(
      requireNode(defaulted, 'perceptual_grading').params,
    );
    expect(
      editDocumentPerceptualGradingV2Schema.parse(
        compileEditDocumentNodeV2(requireNode(defaulted, 'perceptual_grading')).params,
      ),
    ).toEqual(perceptualParams);

    const node = requireNode(defaulted, 'perceptual_grading');
    expect(() =>
      editDocumentV2Schema.parse({
        ...defaulted,
        nodes: {
          ...defaulted.nodes,
          perceptual_grading: {
            ...node,
            params: { ...node.params, futureGrading: true },
          },
        },
      }),
    ).toThrow();
    expect(() =>
      editDocumentV2Schema.parse({
        ...defaulted,
        nodes: {
          ...defaulted.nodes,
          perceptual_grading: {
            ...node,
            params: {
              ...node.params,
              perceptualGradingV1: { ...perceptualParams.perceptualGradingV1, highlightFulcrumEv: -3 },
            },
          },
        },
      }),
    ).toThrow();
  });

  test('color calibration defaults legacy state and rejects malformed render authority', () => {
    const { colorCalibration: _colorCalibration, ...legacyCalibration } = structuredClone(INITIAL_ADJUSTMENTS);
    const defaulted = legacyAdjustmentsToEditDocumentV2(legacyCalibration);
    expect(editDocumentColorCalibrationV2Schema.parse(requireNode(defaulted, 'color_calibration').params)).toEqual({
      colorCalibration: INITIAL_ADJUSTMENTS.colorCalibration,
    });
    expect(defaulted.migration?.defaulted).toContain('color_calibration.colorCalibration');
    expect(
      editDocumentColorCalibrationV2Schema.parse(
        compileEditDocumentNodeV2(requireNode(defaulted, 'color_calibration')).params,
      ),
    ).toEqual(editDocumentColorCalibrationV2Schema.parse(requireNode(defaulted, 'color_calibration').params));

    const node = requireNode(defaulted, 'color_calibration');
    expect(() =>
      editDocumentV2Schema.parse({
        ...defaulted,
        nodes: {
          ...defaulted.nodes,
          color_calibration: {
            ...node,
            params: { colorCalibration: { ...INITIAL_ADJUSTMENTS.colorCalibration, redHue: 101 } },
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
    expect(editDocumentSceneCurveV2Schema.parse(requireNode(defaulted, 'scene_curve').params)).toMatchObject({
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
    const sceneNode = requireNode(document, 'scene_curve');
    expect(editDocumentSceneCurveV2Schema.parse(compileEditDocumentNodeV2(sceneNode).params)).toEqual(
      editDocumentSceneCurveV2Schema.parse(sceneNode.params),
    );

    expect(() =>
      editDocumentV2Schema.parse({
        ...document,
        nodes: {
          ...document.nodes,
          scene_curve: {
            ...sceneNode,
            params: {
              ...sceneNode.params,
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
              ...sceneNode.params,
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
              ...sceneNode.params,
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
          scene_curve: { ...sceneNode, params: { ...sceneNode.params, futureCurve: true } },
        },
      }),
    ).toThrow();
  });

  test('geometry is strict, bounded, unit-explicit, and atomically mirrored into its domain', () => {
    const currentCrop = { height: 0.6, unit: 'normalized' as const, width: 0.6, x: 0.1, y: 0.1 };
    const document = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      crop: currentCrop,
    });
    expect(document.geometry.crop).toEqual(currentCrop);
    expect(document.migration?.defaulted).not.toContain('geometry.crop.unit');
    for (const crop of [
      { height: 0.6, width: 0.6, x: 0.1, y: 0.1 },
      { ...currentCrop, unit: 'px' },
      { ...currentCrop, unit: '%' },
      { ...currentCrop, width: 0.95 },
    ]) {
      expect(() =>
        legacyAdjustmentsToEditDocumentV2({
          ...structuredClone(INITIAL_ADJUSTMENTS),
          crop,
        }),
      ).toThrow();
    }
    const reopened = legacyAdjustmentsToEditDocumentV2(editDocumentV2ToLegacyAdjustments(document));
    expect(reopened.geometry).toEqual(document.geometry);
    expect(requireNode(reopened, 'geometry')).toEqual(requireNode(document, 'geometry'));

    const next = updateEditDocumentV2Node(document, 'geometry', (params) => ({
      ...params,
      crop: { height: 0.7, unit: 'normalized', width: 0.8, x: 0.1, y: 0.2 },
      rotation: 2.5,
    }));
    expect(next.geometry).toEqual(editDocumentGeometryV2Schema.parse(requireNode(next, 'geometry').params));
    expect(next.geometry.crop).toEqual({ height: 0.7, unit: 'normalized', width: 0.8, x: 0.1, y: 0.2 });
    expect(requireNode(next, 'scene_global_color_tone')).toBe(requireNode(document, 'scene_global_color_tone'));
    expect(next.provenance).toBe(document.provenance);

    expect(() =>
      editDocumentV2Schema.parse({
        ...next,
        geometry: { ...next.geometry, rotation: 46 },
        nodes: {
          ...next.nodes,
          geometry: { ...requireNode(next, 'geometry'), params: { ...next.geometry, rotation: 46 } },
        },
      }),
    ).toThrow();
    expect(() =>
      editDocumentV2Schema.parse({
        ...next,
        geometry: { ...next.geometry, unsupported: true },
        nodes: {
          ...next.nodes,
          geometry: { ...requireNode(next, 'geometry'), params: { ...next.geometry, unsupported: true } },
        },
      }),
    ).toThrow();
    expect(() => editDocumentV2Schema.parse({ ...next, geometry: document.geometry })).toThrow('disagrees');
  });
});
