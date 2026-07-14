import type { Crop } from 'react-image-crop';
import {
  type PerceptualGradingSettingsV1,
  perceptualGradingSettingsV1Schema,
} from '../../packages/rawengine-schema/src/color/perceptualGradingSchemas';
import {
  POINT_COLOR_PROCESS_V1,
  type PointColorPlanV1,
  pointColorPlanV1Schema,
} from '../../packages/rawengine-schema/src/color/pointColorSchemas';
import {
  type MatchLookApplicationReceiptV1,
  matchLookApplicationReceiptV1Schema,
} from '../../packages/rawengine-schema/src/referenceMatchRuntime';
import { toneEqualizerSettingsV1Schema } from '../../packages/rawengine-schema/src/tone/toneEqualizerSchemas';
import { Mask, type SubMask, SubMaskMode } from '../components/panel/right/layers/Masks';
import type { LevelsSettings } from '../schemas/color/levelsSchemas';
import type { PerspectiveCorrectionSettings } from '../schemas/geometry/perspectiveSchemas';
import {
  INITIAL_TECHNICAL_WHITE_BALANCE,
  type TechnicalWhiteBalance,
  technicalWhiteBalanceSchema,
} from './color/whiteBalance';
import { toMaskParameterRecord } from './mask/maskParameterAccess';
import type { RawProcessingModeOverride } from './rawProcessingModes';
import {
  DEFAULT_SELECTIVE_COLOR_RANGE_CONTROLS,
  type SelectiveColorRangeControl,
  type SelectiveColorRangeKey,
} from './selectiveColorRanges';

export type JsonPrimitive = boolean | null | number | string;
export type JsonValue = JsonPrimitive | { [key: string]: JsonValue } | Array<JsonValue>;

export enum ActiveChannel {
  Blue = 'blue',
  Green = 'green',
  Luma = 'luma',
  Red = 'red',
}

export enum DisplayMode {
  Luma = 'luma',
  Rgb = 'rgb',
  Parade = 'parade',
  Vectorscope = 'vectorscope',
  Histogram = 'histogram',
}

export enum PasteMode {
  Merge = 'merge',
  Replace = 'replace',
}

export interface CopyPasteSettings {
  mode: PasteMode;
  includedAdjustments: Array<string>;
  knownAdjustments: Array<string>;
}

export enum BasicAdjustment {
  Blacks = 'blacks',
  Brightness = 'brightness',
  Contrast = 'contrast',
  Exposure = 'exposure',
  Highlights = 'highlights',
  Shadows = 'shadows',
  Whites = 'whites',
}

export enum ColorAdjustment {
  BlackWhiteMixer = 'blackWhiteMixer',
  CameraProfile = 'cameraProfile',
  ColorBalanceRgb = 'colorBalanceRgb',
  ChannelMixer = 'channelMixer',
  ColorGrading = 'colorGrading',
  Hsl = 'hsl',
  Hue = 'hue',
  Levels = 'levels',
  Luminance = 'luminance',
  Saturation = 'saturation',
  SkinToneUniformity = 'skinToneUniformity',
  Temperature = 'temperature',
  Tint = 'tint',
  ToneCurve = 'toneCurve',
  Vibrance = 'vibrance',
}

export enum ColorGrading {
  Balance = 'balance',
  Blending = 'blending',
  Global = 'global',
  Highlights = 'highlights',
  Midtones = 'midtones',
  Shadows = 'shadows',
}

export enum DetailsAdjustment {
  Clarity = 'clarity',
  Dehaze = 'dehaze',
  Structure = 'structure',
  Centré = 'centré',
  ColorNoiseReduction = 'colorNoiseReduction',
  DeblurEnabled = 'deblurEnabled',
  DeblurSigmaPx = 'deblurSigmaPx',
  DeblurStrength = 'deblurStrength',
  DenoiseContrastProtection = 'denoiseContrastProtection',
  DenoiseDetail = 'denoiseDetail',
  DenoiseNaturalGrain = 'denoiseNaturalGrain',
  DenoiseShadowBias = 'denoiseShadowBias',
  DustSpotOverlayEnabled = 'dustSpotOverlayEnabled',
  DustSpotSensitivity = 'dustSpotSensitivity',
  DustSpotMinRadiusPx = 'dustSpotMinRadiusPx',
  LumaNoiseReduction = 'lumaNoiseReduction',
  LocalContrastHaloGuard = 'localContrastHaloGuard',
  LocalContrastMidtoneMask = 'localContrastMidtoneMask',
  LocalContrastRadiusPx = 'localContrastRadiusPx',
  Sharpness = 'sharpness',
  SharpnessThreshold = 'sharpnessThreshold',
  ChromaticAberrationRedCyan = 'chromaticAberrationRedCyan',
  ChromaticAberrationBlueYellow = 'chromaticAberrationBlueYellow',
}

export enum Effect {
  GrainAmount = 'grainAmount',
  GrainRoughness = 'grainRoughness',
  GrainSize = 'grainSize',
  LutData = 'lutData',
  LutIntensity = 'lutIntensity',
  LutName = 'lutName',
  LutPath = 'lutPath',
  LutSize = 'lutSize',
  VignetteAmount = 'vignetteAmount',
  VignetteFeather = 'vignetteFeather',
  VignetteMidpoint = 'vignetteMidpoint',
  VignetteRoundness = 'vignetteRoundness',
}

export enum CreativeAdjustment {
  GlowAmount = 'glowAmount',
  HalationAmount = 'halationAmount',
  FlareAmount = 'flareAmount',
}

export enum TransformAdjustment {
  TransformDistortion = 'transformDistortion',
  TransformVertical = 'transformVertical',
  TransformHorizontal = 'transformHorizontal',
  TransformRotate = 'transformRotate',
  TransformAspect = 'transformAspect',
  TransformScale = 'transformScale',
  TransformXOffset = 'transformXOffset',
  TransformYOffset = 'transformYOffset',
}

export enum LensAdjustment {
  LensCorrectionMode = 'lensCorrectionMode',
  LensMaker = 'lensMaker',
  LensModel = 'lensModel',
  LensDistortionAmount = 'lensDistortionAmount',
  LensVignetteAmount = 'lensVignetteAmount',
  LensTcaAmount = 'lensTcaAmount',
  LensDistortionParams = 'lensDistortionParams',
  LensDistortionEnabled = 'lensDistortionEnabled',
  LensTcaEnabled = 'lensTcaEnabled',
  LensVignetteEnabled = 'lensVignetteEnabled',
}

export const ADJUSTMENT_FIELDS = {
  aiPatches: 'aiPatches',
  crop: 'crop',
  flipHorizontal: 'flipHorizontal',
  flipVertical: 'flipVertical',
  masks: 'masks',
  orientationSteps: 'orientationSteps',
  rotation: 'rotation',
  lens: {
    distortionAmount: LensAdjustment.LensDistortionAmount,
    distortionEnabled: LensAdjustment.LensDistortionEnabled,
    distortionParams: LensAdjustment.LensDistortionParams,
    maker: LensAdjustment.LensMaker,
    model: LensAdjustment.LensModel,
    tcaAmount: LensAdjustment.LensTcaAmount,
    tcaEnabled: LensAdjustment.LensTcaEnabled,
    vignetteAmount: LensAdjustment.LensVignetteAmount,
    vignetteEnabled: LensAdjustment.LensVignetteEnabled,
  },
  patch: {
    data: 'patchData',
    dataBase64: 'patchDataBase64',
    id: 'id',
    invert: 'invert',
    subMasks: 'subMasks',
    visible: 'visible',
  },
  transform: {
    aspect: TransformAdjustment.TransformAspect,
    distortion: TransformAdjustment.TransformDistortion,
    horizontal: TransformAdjustment.TransformHorizontal,
    rotate: TransformAdjustment.TransformRotate,
    scale: TransformAdjustment.TransformScale,
    vertical: TransformAdjustment.TransformVertical,
    xOffset: TransformAdjustment.TransformXOffset,
    yOffset: TransformAdjustment.TransformYOffset,
  },
} as const;

export interface ColorCalibration {
  shadowsTint: number;
  redHue: number;
  redSaturation: number;
  greenHue: number;
  greenSaturation: number;
  blueHue: number;
  blueSaturation: number;
}

export interface ParametricCurveSettings {
  darks: number;
  shadows: number;
  highlights: number;
  lights: number;
  whiteLevel: number;
  blackLevel: number;
  split1: number;
  split2: number;
  split3: number;
}

export interface ParametricCurve {
  [index: string]: ParametricCurveSettings;
  blue: ParametricCurveSettings;
  green: ParametricCurveSettings;
  luma: ParametricCurveSettings;
  red: ParametricCurveSettings;
}

export interface SceneCurvePointV1 {
  xEv: number;
  yEv: number;
}

export interface SceneCurveSettingsV1 {
  channelMode: 'luminance_preserving' | 'linked_rgb';
  middleGrey: number;
  points: Array<SceneCurvePointV1>;
}

export interface OutputCurvePointV1 {
  input: number;
  output: number;
}

export interface OutputCurveSettingsV1 {
  domain: 'view_encoded' | 'output_encoded';
  peakNits: number;
  points: Array<OutputCurvePointV1>;
  sdrReferenceWhiteNits: number;
  targetIdentity: string;
}

export interface Adjustments {
  [index: string]: unknown;
  aiPatches: Array<AiPatch>;
  aspectRatio: number | null;
  blacks: number;
  brightness: number;
  centré: number;
  clarity: number;
  chromaticAberrationBlueYellow: number;
  chromaticAberrationRedCyan: number;
  blackWhiteMixer: BlackWhiteMixerSettings;
  cameraProfile: CameraProfileId;
  cameraProfileAmount: number;
  colorBalanceRgb: ColorBalanceRgbSettings;
  channelMixer: ChannelMixerSettings;
  colorCalibration: ColorCalibration;
  colorGrading: ColorGradingProps;
  colorNoiseReduction: number;
  contrast: number;
  curves: Curves;
  pointCurves?: Curves;
  parametricCurve?: ParametricCurve;
  curveMode?: 'point' | 'parametric';
  sceneCurveV1?: SceneCurveSettingsV1;
  outputCurveV1?: OutputCurveSettingsV1;
  perceptualGradingV1?: PerceptualGradingSettingsV1;
  rawProcessingModeOverride: RawProcessingModeOverride;
  /** Persisted native edit-graph process version; legacy sidecars default to v1. */
  rawEngineEditGraphVersion: number;
  referenceMatchApplicationReceipt: MatchLookApplicationReceiptV1 | null;
  crop: Crop | null;
  deblurEnabled: boolean;
  deblurSigmaPx: number;
  deblurStrength: number;
  denoiseContrastProtection: number;
  denoiseDetail: number;
  denoiseNaturalGrain: number;
  denoiseShadowBias: number;
  dustSpotMinRadiusPx: number;
  dustSpotOverlayEnabled: boolean;
  dustSpotSensitivity: number;
  dehaze: number;
  exposure: number;
  flipHorizontal: boolean;
  flipVertical: boolean;
  flareAmount: number;
  filmLookId: string | null;
  filmLookStrength: number;
  glowAmount: number;
  grainAmount: number;
  grainRoughness: number;
  grainSize: number;
  halationAmount: number;
  highlights: number;
  hue: number;
  hsl: Hsl;
  levels: LevelsSettings;
  lensCorrectionMode: 'auto' | 'manual';
  lensDistortionAmount: number;
  lensVignetteAmount: number;
  lensTcaAmount: number;
  lensDistortionEnabled: boolean;
  lensTcaEnabled: boolean;
  lensVignetteEnabled: boolean;
  lensDistortionParams: {
    k1: number;
    k2: number;
    k3: number;
    model: number;
    tca_vr: number;
    tca_vb: number;
    vig_k1: number;
    vig_k2: number;
    vig_k3: number;
  } | null;
  lensMaker: string | null;
  lensModel: string | null;
  localContrastHaloGuard: number;
  localContrastMidtoneMask: number;
  localContrastRadiusPx: number;
  lumaNoiseReduction: number;
  lutData?: string | null;
  lutIntensity?: number;
  lutName?: string | null;
  lutPath?: string | null;
  lutSize?: number;
  masks: Array<MaskContainer>;
  orientationSteps: number;
  rotation: number;
  saturation: number;
  sectionVisibility: SectionVisibility;
  shadows: number;
  sharpness: number;
  sharpnessThreshold: number;
  showClipping: boolean;
  selectiveColorRangeControls: Record<SelectiveColorRangeKey, SelectiveColorRangeControl>;
  skinToneUniformity: SkinToneUniformitySettings;
  structure: number;
  /** Legacy creative offsets. Preserved byte-for-byte for old sidecars. */
  temperature: number;
  tint: number;
  creativeTemperature: number;
  creativeTint: number;
  whiteBalanceTechnical: TechnicalWhiteBalance;
  whiteBalanceMigration: 'native_v1' | 'legacy_creative_temperature_tint_v1';
  toneMapper: 'agx' | 'basic' | 'rapidView';
  toneEqualizer: ToneEqualizerSettingsV1;
  viewTransform: ViewTransformSettingsV1;
  toneCurve: ToneCurveId;
  transformDistortion: number;
  transformVertical: number;
  transformHorizontal: number;
  transformRotate: number;
  transformAspect: number;
  transformScale: number;
  transformXOffset: number;
  transformYOffset: number;
  perspectiveCorrection: PerspectiveCorrectionSettings;
  pointColor: PointColorPlanV1;
  vibrance: number;
  vignetteAmount: number;
  vignetteFeather: number;
  vignetteMidpoint: number;
  vignetteRoundness: number;
  whites: number;
}

export interface ViewTransformSettingsV1 {
  chromaCompression: number;
  contrast: number;
  latitude: number;
  middleGrey: number;
  shoulder: number;
  sourceBlackEv: number;
  sourceWhiteEv: number;
  toe: number;
}

export interface ToneEqualizerSettingsV1 {
  autoPlacement: boolean;
  bandEv: [number, number, number, number, number, number, number, number, number];
  detailPreservation: number;
  edgeRefinement: number;
  enabled: boolean;
  maskExposureCompensation: number;
  pivotEv: number;
  previewMode: 0 | 1 | 2 | 3 | 4;
  rangeEv: number;
  selectedBand: number;
  smoothingRadius: number;
}

export interface SkinToneUniformitySettings {
  enabled: boolean;
  hueUniformity: number;
  luminanceUniformity: number;
  maxHueShiftDegrees: number;
  saturationUniformity: number;
  targetHueDegrees: number;
  targetLuminance: number;
  targetSaturation: number;
}

export const INITIAL_POINT_COLOR: PointColorPlanV1 = {
  enabled: false,
  points: [],
  process: POINT_COLOR_PROCESS_V1,
  selectedPointId: null,
  skinUniformity: {
    chromaUniformity: 0,
    enabled: false,
    hueUniformity: 0,
    lightnessUniformity: 0,
    preserveExtremes: 0.5,
    range: null,
    target: null,
  },
  visualizeMode: 'image',
};

export interface AiPatch {
  id: string;
  isLoading: boolean;
  invert: boolean;
  name: string;
  patchData: JsonValue | null;
  prompt: string;
  subMasks: Array<SubMask>;
  visible: boolean;
}

export interface Color {
  color: string;
  name: string;
}

interface ColorGradingProps {
  [index: string]: number | HueSatLum;
  balance: number;
  blending: number;
  global: HueSatLum;
  highlights: HueSatLum;
  midtones: HueSatLum;
  shadows: HueSatLum;
}

export interface Coord {
  x: number;
  y: number;
}

export interface Curves {
  [index: string]: Array<Coord>;
  blue: Array<Coord>;
  green: Array<Coord>;
  luma: Array<Coord>;
  red: Array<Coord>;
}

export interface HueSatLum {
  hue: number;
  saturation: number;
  luminance: number;
}

interface Hsl {
  [index: string]: HueSatLum;
  aquas: HueSatLum;
  blues: HueSatLum;
  greens: HueSatLum;
  magentas: HueSatLum;
  oranges: HueSatLum;
  purples: HueSatLum;
  reds: HueSatLum;
  yellows: HueSatLum;
}

export interface BlackWhiteMixerSettings {
  enabled: boolean;
  process: 'continuous_sensitivity_v1' | 'legacy_fixed_band_v1' | 'neutral_panchromatic_v1';
  presetId:
    | 'manual'
    | 'neutral_panchromatic'
    | 'yellow_filter'
    | 'orange_filter'
    | 'red_filter'
    | 'green_filter'
    | 'blue_filter';
  sourceClass: 'color_source' | 'monochrome_sensor' | 'encoded_grayscale' | 'already_monochrome_working';
  weights: {
    aquas: number;
    blues: number;
    greens: number;
    magentas: number;
    oranges: number;
    purples: number;
    reds: number;
    yellows: number;
  };
}

export interface ColorBalanceRgbRangeSettings {
  blue: number;
  green: number;
  red: number;
}

export interface ColorBalanceRgbSettings {
  enabled: boolean;
  highlights: ColorBalanceRgbRangeSettings;
  midtones: ColorBalanceRgbRangeSettings;
  preserveLuminance: boolean;
  shadows: ColorBalanceRgbRangeSettings;
}

export type CameraProfileId =
  | 'camera_standard'
  | 'camera_neutral'
  | 'camera_portrait'
  | 'camera_landscape'
  | 'linear_raw'
  | `dcp:${string}`;
export type ToneCurveId = 'auto_filmic' | 'linear' | 'soft_contrast' | 'high_contrast' | 'shadow_lift';

export interface ChannelMixerRow {
  blue: number;
  constant: number;
  green: number;
  red: number;
}

export interface ChannelMixerSettings {
  blue: ChannelMixerRow;
  enabled: boolean;
  green: ChannelMixerRow;
  preserveLuminance: boolean;
  red: ChannelMixerRow;
}

export interface MaskAdjustments {
  [index: string]: unknown;
  blacks: number;
  brightness: number;
  clarity: number;
  colorGrading: ColorGradingProps;
  colorNoiseReduction: number;
  contrast: number;
  curves: Curves;
  pointCurves?: Curves;
  parametricCurve?: ParametricCurve;
  curveMode?: 'point' | 'parametric';
  perceptualGradingV1?: PerceptualGradingSettingsV1;
  dehaze: number;
  exposure: number;
  flareAmount: number;
  glowAmount: number;
  halationAmount: number;
  highlights: number;
  hue: number;
  hsl: Hsl;
  id?: string;
  lumaNoiseReduction: number;
  saturation: number;
  sectionVisibility: SectionVisibility;
  shadows: number;
  sharpness: number;
  sharpnessThreshold: number;
  structure: number;
  temperature: number;
  tint: number;
  toneEqualizer: ToneEqualizerSettingsV1;
  vibrance: number;
  whites: number;
}

export const LAYER_BLEND_MODES = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'soft_light',
  'hue',
  'saturation',
  'luminosity',
  'color',
] as const;
export type LayerBlendMode = (typeof LAYER_BLEND_MODES)[number];
export const DEFAULT_LAYER_BLEND_MODE: LayerBlendMode = 'normal';

export interface MaskContainer {
  adjustments: MaskAdjustments;
  blendMode?: LayerBlendMode;
  id: string;
  invert: boolean;
  layerGroupId?: string;
  layerGroupName?: string;
  name: string;
  opacity: number;
  referenceMatchApplicationReceipt?: MatchLookApplicationReceiptV1;
  retouchCloneSource?: RetouchCloneSource;
  retouchRemoveSource?: RetouchRemoveSource;
  subMasks: Array<SubMask>;
  visible: boolean;
}

export interface RetouchCandidateProvenance {
  algorithmId: 'local_heal_v1';
  candidateId: string;
  candidateKind: 'dust_spot' | 'emulsion_scratch';
  changedPixelCount: number;
  confidence: number;
  confidenceSemantics: 'ranking_score_v1';
  origin: 'negative_lab_dust_candidate';
  outputHash: string;
  outputSampleHash: string;
  sourceFrameId: string;
  sourceSampleHash: string;
  statusAtAcceptance: 'acknowledged' | 'ignored' | 'pending';
}

export interface RetouchLayerRuntimeProvenance {
  algorithmId: 'local_clone_v1' | 'local_heal_v1' | 'local_patch_fill_v1';
  changedPixelCount: number;
  editableLayer: true;
  featherRadiusPx?: number | undefined;
  maskAlphaHash: string;
  mode: 'clone' | 'heal' | 'remove';
  outputHash: string;
  outputSampleHash?: string | undefined;
  proofSource: 'mask_aware_retouch_runtime_fixture_v1' | 'negative_lab_candidate_acceptance_v1';
  provenanceVersion: 1;
  radiusPx?: number | undefined;
  resolvedSourcePoint?:
    | {
        pressure?: number | undefined;
        x: number;
        y: number;
      }
    | undefined;
  sourcePoint?:
    | {
        pressure?: number | undefined;
        x: number;
        y: number;
      }
    | undefined;
  sourceSampleHash?: string | undefined;
  targetMaskId?: string | undefined;
  targetPoint: {
    pressure?: number | undefined;
    x: number;
    y: number;
  };
}

export interface RetouchCloneSource {
  alignmentErrorPx?: number | undefined;
  candidateProvenance?: RetouchCandidateProvenance | undefined;
  featherRadiusPx?: number | undefined;
  provenance?: RetouchLayerRuntimeProvenance | undefined;
  radiusPx?: number | undefined;
  retouchMode?: 'clone' | 'heal' | undefined;
  rotationDegrees: number;
  scale: number;
  sourcePoint: {
    x: number;
    y: number;
  };
  targetPoint: {
    x: number;
    y: number;
  };
}

export interface RetouchRemoveSource {
  featherRadiusPx?: number | undefined;
  generator: 'local_patch_fill_v1';
  generatorVersion: 1;
  provenance?: RetouchLayerRuntimeProvenance | undefined;
  radiusPx?: number | undefined;
  resolvedSourcePoint?:
    | {
        pressure?: number | undefined;
        x: number;
        y: number;
      }
    | undefined;
  searchRadiusMultiplier: number;
  seed: number;
  status?: 'fallback_unchanged' | 'needs_regeneration' | 'ready' | 'stale' | undefined;
  targetMaskId: string;
}

export interface Sections {
  [index: string]: Array<string>;
  basic: Array<string>;
  curves: Array<string>;
  color: Array<string>;
  details: Array<string>;
  effects: Array<string>;
  transformLens: Array<string>;
}

export interface SectionVisibility {
  [index: string]: boolean;
  basic: boolean;
  curves: boolean;
  color: boolean;
  details: boolean;
  effects: boolean;
}

export const COLOR_LABELS: Array<Color> = [
  { name: 'red', color: '#ef4444' },
  { name: 'yellow', color: '#facc15' },
  { name: 'green', color: '#4ade80' },
  { name: 'blue', color: '#60a5fa' },
  { name: 'purple', color: '#a78bfa' },
];

const INITIAL_COLOR_GRADING: ColorGradingProps = {
  balance: 0,
  blending: 50,
  global: { hue: 0, saturation: 0, luminance: 0 },
  highlights: { hue: 0, saturation: 0, luminance: 0 },
  midtones: { hue: 0, saturation: 0, luminance: 0 },
  shadows: { hue: 0, saturation: 0, luminance: 0 },
};

const INITIAL_COLOR_CALIBRATION: ColorCalibration = {
  shadowsTint: 0,
  redHue: 0,
  redSaturation: 0,
  greenHue: 0,
  greenSaturation: 0,
  blueHue: 0,
  blueSaturation: 0,
};

const INITIAL_BLACK_WHITE_MIXER: BlackWhiteMixerSettings = {
  enabled: false,
  process: 'legacy_fixed_band_v1',
  presetId: 'manual',
  sourceClass: 'color_source',
  weights: {
    aquas: 0,
    blues: 0,
    greens: 0,
    magentas: 0,
    oranges: 0,
    purples: 0,
    reds: 0,
    yellows: 0,
  },
};

const INITIAL_COLOR_BALANCE_RGB: ColorBalanceRgbSettings = {
  enabled: false,
  highlights: { red: 0, green: 0, blue: 0 },
  midtones: { red: 0, green: 0, blue: 0 },
  preserveLuminance: true,
  shadows: { red: 0, green: 0, blue: 0 },
};

const INITIAL_CHANNEL_MIXER: ChannelMixerSettings = {
  blue: { red: 0, green: 0, blue: 100, constant: 0 },
  enabled: false,
  green: { red: 0, green: 100, blue: 0, constant: 0 },
  preserveLuminance: true,
  red: { red: 100, green: 0, blue: 0, constant: 0 },
};

const INITIAL_LEVELS: LevelsSettings = {
  enabled: false,
  gamma: 1,
  inputBlack: 0,
  inputWhite: 1,
  outputBlack: 0,
  outputWhite: 1,
};

export const DEFAULT_PARAMETRIC_CURVE_SETTINGS: ParametricCurveSettings = {
  darks: 0,
  shadows: 0,
  highlights: 0,
  lights: 0,
  whiteLevel: 0,
  blackLevel: 0,
  split1: 25,
  split2: 50,
  split3: 75,
};

export const getDefaultParametricCurve = (): ParametricCurve => ({
  luma: { ...DEFAULT_PARAMETRIC_CURVE_SETTINGS },
  red: { ...DEFAULT_PARAMETRIC_CURVE_SETTINGS },
  green: { ...DEFAULT_PARAMETRIC_CURVE_SETTINGS },
  blue: { ...DEFAULT_PARAMETRIC_CURVE_SETTINGS },
});

export const getDefaultCurves = (): Curves => ({
  blue: [
    { x: 0, y: 0 },
    { x: 255, y: 255 },
  ],
  green: [
    { x: 0, y: 0 },
    { x: 255, y: 255 },
  ],
  luma: [
    { x: 0, y: 0 },
    { x: 255, y: 255 },
  ],
  red: [
    { x: 0, y: 0 },
    { x: 255, y: 255 },
  ],
});

export const DEFAULT_PARAMETRIC_CURVE = getDefaultParametricCurve();

export const INITIAL_TONE_EQUALIZER: ToneEqualizerSettingsV1 = {
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
};

const normalizeToneEqualizer = (
  value: Partial<ToneEqualizerSettingsV1> | null | undefined,
): ToneEqualizerSettingsV1 => {
  const candidate = {
    ...INITIAL_TONE_EQUALIZER,
    ...(value || {}),
    bandEv: [...(value?.bandEv || INITIAL_TONE_EQUALIZER.bandEv)],
  };
  const parsed = toneEqualizerSettingsV1Schema.safeParse(candidate);
  return parsed.success ? parsed.data : structuredClone(INITIAL_TONE_EQUALIZER);
};

export const INITIAL_MASK_ADJUSTMENTS: MaskAdjustments = {
  blacks: 0,
  brightness: 0,
  clarity: 0,
  colorGrading: { ...INITIAL_COLOR_GRADING },
  colorNoiseReduction: 0,
  contrast: 0,
  curves: getDefaultCurves(),
  pointCurves: getDefaultCurves(),
  parametricCurve: getDefaultParametricCurve(),
  curveMode: 'point',
  dehaze: 0,
  exposure: 0,
  flareAmount: 0,
  glowAmount: 0,
  halationAmount: 0,
  highlights: 0,
  hue: 0,
  hsl: {
    aquas: { hue: 0, saturation: 0, luminance: 0 },
    blues: { hue: 0, saturation: 0, luminance: 0 },
    greens: { hue: 0, saturation: 0, luminance: 0 },
    magentas: { hue: 0, saturation: 0, luminance: 0 },
    oranges: { hue: 0, saturation: 0, luminance: 0 },
    purples: { hue: 0, saturation: 0, luminance: 0 },
    reds: { hue: 0, saturation: 0, luminance: 0 },
    yellows: { hue: 0, saturation: 0, luminance: 0 },
  },
  selectiveColorRangeControls: structuredClone(DEFAULT_SELECTIVE_COLOR_RANGE_CONTROLS),
  lumaNoiseReduction: 0,
  saturation: 0,
  sectionVisibility: {
    basic: true,
    curves: true,
    color: true,
    details: true,
    effects: true,
  },
  shadows: 0,
  sharpness: 0,
  sharpnessThreshold: 15,
  structure: 0,
  temperature: 0,
  tint: 0,
  toneEqualizer: structuredClone(INITIAL_TONE_EQUALIZER),
  vibrance: 0,
  whites: 0,
};

export const INITIAL_MASK_CONTAINER: MaskContainer = {
  adjustments: INITIAL_MASK_ADJUSTMENTS,
  blendMode: DEFAULT_LAYER_BLEND_MODE,
  id: '',
  invert: false,
  name: 'New Mask',
  opacity: 100,
  subMasks: [],
  visible: true,
};

export const INITIAL_ADJUSTMENTS: Adjustments = {
  aiPatches: [],
  aspectRatio: null,
  blacks: 0,
  brightness: 0,
  centré: 0,
  clarity: 0,
  chromaticAberrationBlueYellow: 0,
  chromaticAberrationRedCyan: 0,
  blackWhiteMixer: structuredClone(INITIAL_BLACK_WHITE_MIXER),
  cameraProfile: 'camera_standard',
  cameraProfileAmount: 100,
  colorBalanceRgb: structuredClone(INITIAL_COLOR_BALANCE_RGB),
  channelMixer: structuredClone(INITIAL_CHANNEL_MIXER),
  colorCalibration: { ...INITIAL_COLOR_CALIBRATION },
  colorGrading: { ...INITIAL_COLOR_GRADING },
  colorNoiseReduction: 0,
  contrast: 0,
  crop: null,
  curves: getDefaultCurves(),
  pointCurves: getDefaultCurves(),
  parametricCurve: getDefaultParametricCurve(),
  curveMode: 'point',
  rawProcessingModeOverride: null,
  rawEngineEditGraphVersion: 1,
  referenceMatchApplicationReceipt: null,
  deblurEnabled: false,
  deblurSigmaPx: 0.8,
  deblurStrength: 0,
  denoiseContrastProtection: 50,
  denoiseDetail: 50,
  denoiseNaturalGrain: 0,
  denoiseShadowBias: 0,
  dustSpotMinRadiusPx: 2,
  dustSpotOverlayEnabled: false,
  dustSpotSensitivity: 50,
  dehaze: 0,
  exposure: 0,
  flipHorizontal: false,
  flipVertical: false,
  flareAmount: 0,
  filmLookId: null,
  filmLookStrength: 100,
  glowAmount: 0,
  grainAmount: 0,
  grainRoughness: 50,
  grainSize: 25,
  halationAmount: 0,
  highlights: 0,
  hue: 0,
  hsl: {
    aquas: { hue: 0, saturation: 0, luminance: 0 },
    blues: { hue: 0, saturation: 0, luminance: 0 },
    greens: { hue: 0, saturation: 0, luminance: 0 },
    magentas: { hue: 0, saturation: 0, luminance: 0 },
    oranges: { hue: 0, saturation: 0, luminance: 0 },
    purples: { hue: 0, saturation: 0, luminance: 0 },
    reds: { hue: 0, saturation: 0, luminance: 0 },
    yellows: { hue: 0, saturation: 0, luminance: 0 },
  },
  selectiveColorRangeControls: structuredClone(DEFAULT_SELECTIVE_COLOR_RANGE_CONTROLS),
  levels: structuredClone(INITIAL_LEVELS),
  lensCorrectionMode: 'manual',
  lensDistortionAmount: 100,
  lensVignetteAmount: 100,
  lensTcaAmount: 100,
  lensDistortionEnabled: true,
  lensTcaEnabled: true,
  lensVignetteEnabled: true,
  lensDistortionParams: null,
  lensMaker: null,
  lensModel: null,
  localContrastHaloGuard: 50,
  localContrastMidtoneMask: 50,
  localContrastRadiusPx: 24,
  lumaNoiseReduction: 0,
  lutData: null,
  lutIntensity: 100,
  lutName: null,
  lutPath: null,
  lutSize: 0,
  masks: [],
  orientationSteps: 0,
  rotation: 0,
  saturation: 0,
  sectionVisibility: {
    basic: true,
    curves: true,
    color: true,
    details: true,
    effects: true,
  },
  shadows: 0,
  sharpness: 0,
  sharpnessThreshold: 15,
  showClipping: false,
  skinToneUniformity: {
    enabled: false,
    hueUniformity: 0.42,
    luminanceUniformity: 0.18,
    maxHueShiftDegrees: 16,
    saturationUniformity: 0.31,
    targetHueDegrees: 24,
    targetLuminance: 0.56,
    targetSaturation: 0.38,
  },
  structure: 0,
  temperature: 0,
  tint: 0,
  creativeTemperature: 0,
  creativeTint: 0,
  whiteBalanceTechnical: structuredClone(INITIAL_TECHNICAL_WHITE_BALANCE),
  whiteBalanceMigration: 'native_v1',
  toneMapper: 'rapidView',
  toneEqualizer: structuredClone(INITIAL_TONE_EQUALIZER),
  viewTransform: {
    chromaCompression: 0.25,
    contrast: 1.15,
    latitude: 0.55,
    middleGrey: 0.18,
    shoulder: 0.5,
    sourceBlackEv: -10,
    sourceWhiteEv: 6.5,
    toe: 0.35,
  },
  toneCurve: 'auto_filmic',
  transformDistortion: 0,
  transformVertical: 0,
  transformHorizontal: 0,
  transformRotate: 0,
  transformAspect: 0,
  transformScale: 100,
  transformXOffset: 0,
  transformYOffset: 0,
  perspectiveCorrection: {
    amount: 100,
    cropPolicy: 'auto_crop',
    guides: [],
    mode: 'off',
    resolvedPlan: null,
  },
  pointColor: structuredClone(INITIAL_POINT_COLOR),
  vibrance: 0,
  vignetteAmount: 0,
  vignetteFeather: 50,
  vignetteMidpoint: 50,
  vignetteRoundness: 0,
  whites: 0,
};

const deepCloneCurves = (curves?: Partial<Curves> | null): Curves => ({
  blue: curves?.blue?.map((p: Coord) => ({ ...p })) || [
    { x: 0, y: 0 },
    { x: 255, y: 255 },
  ],
  green: curves?.green?.map((p: Coord) => ({ ...p })) || [
    { x: 0, y: 0 },
    { x: 255, y: 255 },
  ],
  luma: curves?.luma?.map((p: Coord) => ({ ...p })) || [
    { x: 0, y: 0 },
    { x: 255, y: 255 },
  ],
  red: curves?.red?.map((p: Coord) => ({ ...p })) || [
    { x: 0, y: 0 },
    { x: 255, y: 255 },
  ],
});

const deepCloneParametric = (pCurve?: Partial<ParametricCurve> | null): ParametricCurve => ({
  luma: { ...DEFAULT_PARAMETRIC_CURVE_SETTINGS, ...(pCurve?.luma || {}) },
  red: { ...DEFAULT_PARAMETRIC_CURVE_SETTINGS, ...(pCurve?.red || {}) },
  green: { ...DEFAULT_PARAMETRIC_CURVE_SETTINGS, ...(pCurve?.green || {}) },
  blue: { ...DEFAULT_PARAMETRIC_CURVE_SETTINGS, ...(pCurve?.blue || {}) },
});

export const normalizeLoadedAdjustments = (loadedAdjustments: Partial<Adjustments> | null | undefined): Adjustments => {
  if (!loadedAdjustments) {
    return INITIAL_ADJUSTMENTS;
  }

  const normalizeSubMasks = (subMasks?: Array<Partial<SubMask>>): Array<SubMask> => {
    return (subMasks || []).map((subMask: Partial<SubMask>) => ({
      id: subMask.id || crypto.randomUUID(),
      invert: subMask.invert ?? false,
      mode: subMask.mode ?? SubMaskMode.Additive,
      opacity: subMask.opacity ?? 100,
      type: subMask.type ?? Mask.Brush,
      visible: subMask.visible ?? true,
      ...(subMask.name !== undefined ? { name: subMask.name } : {}),
      ...(subMask.parameters !== undefined ? { parameters: toMaskParameterRecord(subMask.parameters) } : {}),
    }));
  };

  const normalizedMasks = (loadedAdjustments.masks || []).map((maskContainer: MaskContainer) => {
    const containerAdjustments = maskContainer.adjustments;
    const normalizedSubMasks = normalizeSubMasks(maskContainer.subMasks);

    const parsedLayerReferenceMatchReceipt = matchLookApplicationReceiptV1Schema.safeParse(
      maskContainer.referenceMatchApplicationReceipt,
    );
    const normalizedMask: MaskContainer = {
      ...INITIAL_MASK_CONTAINER,
      ...maskContainer,
      id: maskContainer.id || crypto.randomUUID(),
      adjustments: {
        ...INITIAL_MASK_ADJUSTMENTS,
        ...containerAdjustments,
        flareAmount: containerAdjustments.flareAmount,
        glowAmount: containerAdjustments.glowAmount,
        halationAmount: containerAdjustments.halationAmount,
        colorGrading: { ...INITIAL_MASK_ADJUSTMENTS.colorGrading, ...containerAdjustments.colorGrading },
        ...(perceptualGradingSettingsV1Schema.safeParse(containerAdjustments.perceptualGradingV1).success
          ? { perceptualGradingV1: perceptualGradingSettingsV1Schema.parse(containerAdjustments.perceptualGradingV1) }
          : {}),
        hsl: { ...INITIAL_MASK_ADJUSTMENTS.hsl, ...containerAdjustments.hsl },
        curves: deepCloneCurves(containerAdjustments.curves),
        pointCurves: containerAdjustments.pointCurves
          ? deepCloneCurves(containerAdjustments.pointCurves)
          : getDefaultCurves(),
        parametricCurve: containerAdjustments.parametricCurve
          ? deepCloneParametric(containerAdjustments.parametricCurve)
          : getDefaultParametricCurve(),
        curveMode: containerAdjustments.curveMode ?? 'point',
        sectionVisibility: {
          ...INITIAL_MASK_ADJUSTMENTS.sectionVisibility,
          ...containerAdjustments.sectionVisibility,
        },
        sharpnessThreshold: containerAdjustments.sharpnessThreshold,
        toneEqualizer: normalizeToneEqualizer(containerAdjustments.toneEqualizer),
      },
      subMasks: normalizedSubMasks,
    };
    if (
      parsedLayerReferenceMatchReceipt.success &&
      parsedLayerReferenceMatchReceipt.data.destination === 'adjustment-layer'
    ) {
      normalizedMask.referenceMatchApplicationReceipt = parsedLayerReferenceMatchReceipt.data;
    } else {
      delete normalizedMask.referenceMatchApplicationReceipt;
    }
    return normalizedMask;
  });

  const normalizedAiPatches = (loadedAdjustments.aiPatches || []).map(
    (patch: Partial<AiPatch>) =>
      ({
        visible: true,
        ...patch,
        subMasks: normalizeSubMasks(patch.subMasks),
      }) as AiPatch,
  );

  const parsedTechnicalWhiteBalance = technicalWhiteBalanceSchema.safeParse(loadedAdjustments.whiteBalanceTechnical);
  const parsedReferenceMatchReceipt = matchLookApplicationReceiptV1Schema.safeParse(
    loadedAdjustments.referenceMatchApplicationReceipt,
  );
  const isLegacyWhiteBalance = !parsedTechnicalWhiteBalance.success;
  const loadedCameraProfileAmount = loadedAdjustments.cameraProfileAmount;
  const cameraProfileAmount =
    loadedCameraProfileAmount !== undefined && Number.isFinite(loadedCameraProfileAmount)
      ? Math.min(100, Math.max(0, loadedCameraProfileAmount))
      : INITIAL_ADJUSTMENTS.cameraProfileAmount;

  return {
    ...INITIAL_ADJUSTMENTS,
    ...loadedAdjustments,
    flareAmount: loadedAdjustments.flareAmount ?? INITIAL_ADJUSTMENTS.flareAmount,
    filmLookId: loadedAdjustments.filmLookId ?? INITIAL_ADJUSTMENTS.filmLookId,
    filmLookStrength: loadedAdjustments.filmLookStrength ?? INITIAL_ADJUSTMENTS.filmLookStrength,
    glowAmount: loadedAdjustments.glowAmount ?? INITIAL_ADJUSTMENTS.glowAmount,
    halationAmount: loadedAdjustments.halationAmount ?? INITIAL_ADJUSTMENTS.halationAmount,
    hue: loadedAdjustments.hue ?? INITIAL_ADJUSTMENTS.hue,
    creativeTemperature: isLegacyWhiteBalance
      ? (loadedAdjustments.temperature ?? INITIAL_ADJUSTMENTS.temperature)
      : (loadedAdjustments.creativeTemperature ?? INITIAL_ADJUSTMENTS.creativeTemperature),
    creativeTint: isLegacyWhiteBalance
      ? (loadedAdjustments.tint ?? INITIAL_ADJUSTMENTS.tint)
      : (loadedAdjustments.creativeTint ?? INITIAL_ADJUSTMENTS.creativeTint),
    whiteBalanceTechnical: parsedTechnicalWhiteBalance.success
      ? parsedTechnicalWhiteBalance.data
      : structuredClone(INITIAL_TECHNICAL_WHITE_BALANCE),
    whiteBalanceMigration: isLegacyWhiteBalance ? 'legacy_creative_temperature_tint_v1' : 'native_v1',
    referenceMatchApplicationReceipt: parsedReferenceMatchReceipt.success ? parsedReferenceMatchReceipt.data : null,
    lensCorrectionMode: loadedAdjustments.lensCorrectionMode || 'manual',
    lensMaker: loadedAdjustments.lensMaker ?? INITIAL_ADJUSTMENTS.lensMaker,
    lensModel: loadedAdjustments.lensModel ?? INITIAL_ADJUSTMENTS.lensModel,
    lensDistortionAmount: loadedAdjustments.lensDistortionAmount ?? INITIAL_ADJUSTMENTS.lensDistortionAmount,
    lensVignetteAmount: loadedAdjustments.lensVignetteAmount ?? INITIAL_ADJUSTMENTS.lensVignetteAmount,
    lensTcaAmount: loadedAdjustments.lensTcaAmount ?? INITIAL_ADJUSTMENTS.lensTcaAmount,
    lensDistortionEnabled: loadedAdjustments.lensDistortionEnabled ?? INITIAL_ADJUSTMENTS.lensDistortionEnabled,
    lensTcaEnabled: loadedAdjustments.lensTcaEnabled ?? INITIAL_ADJUSTMENTS.lensTcaEnabled,
    lensVignetteEnabled: loadedAdjustments.lensVignetteEnabled ?? INITIAL_ADJUSTMENTS.lensVignetteEnabled,
    lensDistortionParams: loadedAdjustments.lensDistortionParams ?? INITIAL_ADJUSTMENTS.lensDistortionParams,
    localContrastHaloGuard: loadedAdjustments.localContrastHaloGuard ?? INITIAL_ADJUSTMENTS.localContrastHaloGuard,
    localContrastMidtoneMask:
      loadedAdjustments.localContrastMidtoneMask ?? INITIAL_ADJUSTMENTS.localContrastMidtoneMask,
    localContrastRadiusPx: loadedAdjustments.localContrastRadiusPx ?? INITIAL_ADJUSTMENTS.localContrastRadiusPx,
    transformDistortion: loadedAdjustments.transformDistortion ?? INITIAL_ADJUSTMENTS.transformDistortion,
    transformVertical: loadedAdjustments.transformVertical ?? INITIAL_ADJUSTMENTS.transformVertical,
    transformHorizontal: loadedAdjustments.transformHorizontal ?? INITIAL_ADJUSTMENTS.transformHorizontal,
    transformRotate: loadedAdjustments.transformRotate ?? INITIAL_ADJUSTMENTS.transformRotate,
    transformAspect: loadedAdjustments.transformAspect ?? INITIAL_ADJUSTMENTS.transformAspect,
    transformScale: loadedAdjustments.transformScale ?? INITIAL_ADJUSTMENTS.transformScale,
    transformXOffset: loadedAdjustments.transformXOffset ?? INITIAL_ADJUSTMENTS.transformXOffset,
    transformYOffset: loadedAdjustments.transformYOffset ?? INITIAL_ADJUSTMENTS.transformYOffset,
    perspectiveCorrection: loadedAdjustments.perspectiveCorrection ?? INITIAL_ADJUSTMENTS.perspectiveCorrection,
    cameraProfile: loadedAdjustments.cameraProfile ?? INITIAL_ADJUSTMENTS.cameraProfile,
    cameraProfileAmount,
    toneMapper: loadedAdjustments.toneMapper ?? 'basic',
    toneEqualizer: normalizeToneEqualizer(loadedAdjustments.toneEqualizer),
    viewTransform: {
      ...INITIAL_ADJUSTMENTS.viewTransform,
      ...(loadedAdjustments.viewTransform || {}),
    },
    toneCurve: loadedAdjustments.toneCurve ?? INITIAL_ADJUSTMENTS.toneCurve,
    blackWhiteMixer: {
      ...INITIAL_ADJUSTMENTS.blackWhiteMixer,
      ...(loadedAdjustments.blackWhiteMixer || {}),
      weights: {
        ...INITIAL_ADJUSTMENTS.blackWhiteMixer.weights,
        ...(loadedAdjustments.blackWhiteMixer?.weights || {}),
      },
    },
    colorBalanceRgb: {
      ...INITIAL_ADJUSTMENTS.colorBalanceRgb,
      ...(loadedAdjustments.colorBalanceRgb || {}),
      highlights: {
        ...INITIAL_ADJUSTMENTS.colorBalanceRgb.highlights,
        ...(loadedAdjustments.colorBalanceRgb?.highlights || {}),
      },
      midtones: {
        ...INITIAL_ADJUSTMENTS.colorBalanceRgb.midtones,
        ...(loadedAdjustments.colorBalanceRgb?.midtones || {}),
      },
      shadows: {
        ...INITIAL_ADJUSTMENTS.colorBalanceRgb.shadows,
        ...(loadedAdjustments.colorBalanceRgb?.shadows || {}),
      },
    },
    channelMixer: {
      ...INITIAL_ADJUSTMENTS.channelMixer,
      ...(loadedAdjustments.channelMixer || {}),
      blue: { ...INITIAL_ADJUSTMENTS.channelMixer.blue, ...(loadedAdjustments.channelMixer?.blue || {}) },
      green: { ...INITIAL_ADJUSTMENTS.channelMixer.green, ...(loadedAdjustments.channelMixer?.green || {}) },
      red: { ...INITIAL_ADJUSTMENTS.channelMixer.red, ...(loadedAdjustments.channelMixer?.red || {}) },
    },
    colorCalibration: { ...INITIAL_ADJUSTMENTS.colorCalibration, ...(loadedAdjustments.colorCalibration || {}) },
    colorGrading: { ...INITIAL_ADJUSTMENTS.colorGrading, ...(loadedAdjustments.colorGrading || {}) },
    ...(perceptualGradingSettingsV1Schema.safeParse(loadedAdjustments.perceptualGradingV1).success
      ? { perceptualGradingV1: perceptualGradingSettingsV1Schema.parse(loadedAdjustments.perceptualGradingV1) }
      : {}),
    hsl: { ...INITIAL_ADJUSTMENTS.hsl, ...(loadedAdjustments.hsl || {}) },
    selectiveColorRangeControls: {
      ...INITIAL_ADJUSTMENTS.selectiveColorRangeControls,
      ...(loadedAdjustments.selectiveColorRangeControls || {}),
    },
    skinToneUniformity: {
      ...INITIAL_ADJUSTMENTS.skinToneUniformity,
      ...(loadedAdjustments.skinToneUniformity || {}),
    },
    pointColor: pointColorPlanV1Schema.safeParse(loadedAdjustments.pointColor).success
      ? pointColorPlanV1Schema.parse(loadedAdjustments.pointColor)
      : structuredClone(INITIAL_POINT_COLOR),
    levels: { ...INITIAL_ADJUSTMENTS.levels, ...(loadedAdjustments.levels || {}) },
    curves: loadedAdjustments.curves ? deepCloneCurves(loadedAdjustments.curves) : getDefaultCurves(),
    pointCurves: loadedAdjustments.pointCurves ? deepCloneCurves(loadedAdjustments.pointCurves) : getDefaultCurves(),
    parametricCurve: loadedAdjustments.parametricCurve
      ? deepCloneParametric(loadedAdjustments.parametricCurve)
      : getDefaultParametricCurve(),
    curveMode: loadedAdjustments.curveMode ?? 'point',
    ...(loadedAdjustments.sceneCurveV1 ? { sceneCurveV1: structuredClone(loadedAdjustments.sceneCurveV1) } : {}),
    ...(loadedAdjustments.outputCurveV1 ? { outputCurveV1: structuredClone(loadedAdjustments.outputCurveV1) } : {}),
    deblurEnabled: loadedAdjustments.deblurEnabled ?? INITIAL_ADJUSTMENTS.deblurEnabled,
    deblurSigmaPx: loadedAdjustments.deblurSigmaPx ?? INITIAL_ADJUSTMENTS.deblurSigmaPx,
    deblurStrength: loadedAdjustments.deblurStrength ?? INITIAL_ADJUSTMENTS.deblurStrength,
    dustSpotMinRadiusPx: loadedAdjustments.dustSpotMinRadiusPx ?? INITIAL_ADJUSTMENTS.dustSpotMinRadiusPx,
    dustSpotOverlayEnabled: loadedAdjustments.dustSpotOverlayEnabled ?? INITIAL_ADJUSTMENTS.dustSpotOverlayEnabled,
    dustSpotSensitivity: loadedAdjustments.dustSpotSensitivity ?? INITIAL_ADJUSTMENTS.dustSpotSensitivity,
    masks: normalizedMasks,
    aiPatches: normalizedAiPatches,
    sectionVisibility: {
      ...INITIAL_ADJUSTMENTS.sectionVisibility,
      ...(loadedAdjustments.sectionVisibility || {}),
    },
    sharpnessThreshold: loadedAdjustments.sharpnessThreshold ?? INITIAL_ADJUSTMENTS.sharpnessThreshold,
  };
};

export interface AdjustmentGroup {
  label: string;
  keys: string[];
}

export const ADJUSTMENT_GROUPS: Record<string, AdjustmentGroup[]> = {
  basic: [
    {
      label: 'modals.copyPaste.groups.exposureToneMapper',
      keys: [BasicAdjustment.Exposure, 'toneMapper'],
    },
    {
      label: 'modals.copyPaste.groups.tone',
      keys: [
        BasicAdjustment.Brightness,
        BasicAdjustment.Contrast,
        BasicAdjustment.Highlights,
        BasicAdjustment.Shadows,
        BasicAdjustment.Whites,
        BasicAdjustment.Blacks,
      ],
    },
    {
      label: 'modals.copyPaste.groups.curves',
      keys: ['curves', 'pointCurves', 'parametricCurve', 'curveMode', 'sceneCurveV1', 'outputCurveV1'],
    },
  ],
  color: [
    {
      label: 'modals.copyPaste.groups.profileTone',
      keys: [ColorAdjustment.CameraProfile, ColorAdjustment.ToneCurve, 'parametricCurve', 'curveMode'],
    },
    {
      label: 'modals.copyPaste.groups.whiteBalance',
      keys: [
        'whiteBalanceTechnical',
        'creativeTemperature',
        'creativeTint',
        ColorAdjustment.Temperature,
        ColorAdjustment.Tint,
      ],
    },
    { label: 'modals.copyPaste.groups.presence', keys: [ColorAdjustment.Saturation, ColorAdjustment.Vibrance] },
    { label: 'modals.copyPaste.groups.hueShift', keys: [ColorAdjustment.Hue] },
    { label: 'modals.copyPaste.groups.colorBalanceRgb', keys: [ColorAdjustment.ColorBalanceRgb] },
    { label: 'modals.copyPaste.groups.colorGrading', keys: [ColorAdjustment.ColorGrading] },
    { label: 'modals.copyPaste.groups.levels', keys: [ColorAdjustment.Levels] },
    { label: 'modals.copyPaste.groups.colorMixer', keys: [ColorAdjustment.Hsl] },
    { label: 'modals.copyPaste.groups.blackWhiteMixer', keys: [ColorAdjustment.BlackWhiteMixer] },
    { label: 'modals.copyPaste.groups.channelMixer', keys: [ColorAdjustment.ChannelMixer] },
    { label: 'modals.copyPaste.groups.colorCalibration', keys: ['colorCalibration'] },
  ],
  details: [
    {
      label: 'modals.copyPaste.groups.clarityDehaze',
      keys: [
        DetailsAdjustment.Clarity,
        DetailsAdjustment.Structure,
        DetailsAdjustment.Dehaze,
        DetailsAdjustment.Centré,
        DetailsAdjustment.LocalContrastRadiusPx,
        DetailsAdjustment.LocalContrastHaloGuard,
        DetailsAdjustment.LocalContrastMidtoneMask,
      ],
    },
    {
      label: 'modals.copyPaste.groups.sharpness',
      keys: [DetailsAdjustment.Sharpness, DetailsAdjustment.SharpnessThreshold],
    },
    {
      label: 'modals.copyPaste.groups.noiseReduction',
      keys: [DetailsAdjustment.LumaNoiseReduction, DetailsAdjustment.ColorNoiseReduction],
    },
    {
      label: 'modals.copyPaste.groups.deblur',
      keys: [DetailsAdjustment.DeblurEnabled, DetailsAdjustment.DeblurStrength, DetailsAdjustment.DeblurSigmaPx],
    },
    {
      label: 'modals.copyPaste.groups.dustSpotVisualization',
      keys: [
        DetailsAdjustment.DustSpotOverlayEnabled,
        DetailsAdjustment.DustSpotSensitivity,
        DetailsAdjustment.DustSpotMinRadiusPx,
      ],
    },
    {
      label: 'modals.copyPaste.groups.chromaticAberration',
      keys: [DetailsAdjustment.ChromaticAberrationRedCyan, DetailsAdjustment.ChromaticAberrationBlueYellow],
    },
  ],
  effects: [
    {
      label: 'modals.copyPaste.groups.vignette',
      keys: [Effect.VignetteAmount, Effect.VignetteFeather, Effect.VignetteMidpoint, Effect.VignetteRoundness],
    },
    { label: 'modals.copyPaste.groups.grain', keys: [Effect.GrainAmount, Effect.GrainRoughness, Effect.GrainSize] },
    {
      label: 'modals.copyPaste.groups.halationGlow',
      keys: [CreativeAdjustment.GlowAmount, CreativeAdjustment.HalationAmount, CreativeAdjustment.FlareAmount],
    },
    {
      label: 'modals.copyPaste.groups.lut',
      keys: [Effect.LutIntensity, Effect.LutName, Effect.LutPath, Effect.LutSize, Effect.LutData],
    },
  ],
  geometry: [
    { label: 'modals.copyPaste.groups.cropAspectRatio', keys: ['crop', 'aspectRatio'] },
    {
      label: 'modals.copyPaste.groups.transformRotation',
      keys: [
        'rotation',
        'flipHorizontal',
        'flipVertical',
        'orientationSteps',
        TransformAdjustment.TransformDistortion,
        TransformAdjustment.TransformVertical,
        TransformAdjustment.TransformHorizontal,
        TransformAdjustment.TransformRotate,
        TransformAdjustment.TransformAspect,
        TransformAdjustment.TransformScale,
        TransformAdjustment.TransformXOffset,
        TransformAdjustment.TransformYOffset,
      ],
    },
    {
      label: 'modals.copyPaste.groups.lensCorrection',
      keys: [
        LensAdjustment.LensCorrectionMode,
        LensAdjustment.LensMaker,
        LensAdjustment.LensModel,
        LensAdjustment.LensDistortionAmount,
        LensAdjustment.LensVignetteAmount,
        LensAdjustment.LensTcaAmount,
        LensAdjustment.LensDistortionParams,
        LensAdjustment.LensDistortionEnabled,
        LensAdjustment.LensTcaEnabled,
        LensAdjustment.LensVignetteEnabled,
      ],
    },
  ],
  masks: [{ label: 'modals.copyPaste.groups.masks', keys: ['masks'] }],
};

export const COPYABLE_ADJUSTMENT_KEYS: string[] = Object.values(ADJUSTMENT_GROUPS)
  .flat()
  .flatMap((group) => group.keys);

export interface PickAdjustmentValuesOptions {
  excludedKeys?: ReadonlySet<string> | readonly string[];
  requireExistingKey?: boolean;
  skipDefaultValues?: boolean;
}

export const cloneAdjustmentValue = <Value>(value: Value): Value => structuredClone(value);

export const bindTypedCurveGraphVersion = (adjustments: Partial<Adjustments>): Partial<Adjustments> =>
  adjustments.sceneCurveV1 !== undefined || adjustments.outputCurveV1 !== undefined
    ? { ...adjustments, rawEngineEditGraphVersion: 2 }
    : adjustments;

export const hasAdjustmentKey = (source: Partial<Adjustments>, key: string): boolean => Object.hasOwn(source, key);

export const pickAdjustmentValues = (
  keys: readonly string[],
  source: Partial<Adjustments>,
  options: PickAdjustmentValuesOptions = {},
): Partial<Adjustments> => {
  const values: Partial<Adjustments> = {};
  const excludedKeys =
    options.excludedKeys instanceof Set ? options.excludedKeys : new Set<string>(options.excludedKeys ?? []);

  for (const key of keys) {
    if (excludedKeys.has(key)) continue;
    if (options.requireExistingKey && !hasAdjustmentKey(source, key)) continue;

    const value = cloneAdjustmentValue(source[key]);
    if (options.skipDefaultValues && JSON.stringify(value) === JSON.stringify(INITIAL_ADJUSTMENTS[key])) continue;
    values[key] = value;
  }

  return values;
};

export const hasAdjustmentValueChanges = (
  keys: readonly string[],
  source: Partial<Adjustments>,
  defaults: Partial<Adjustments> = INITIAL_ADJUSTMENTS,
): boolean =>
  keys.some((key) => {
    const currentValue = (source as Record<string, unknown>)[key];
    const defaultValue = (defaults as Record<string, unknown>)[key];
    return JSON.stringify(currentValue) !== JSON.stringify(defaultValue);
  });

export const ADJUSTMENT_SECTIONS: Sections = {
  basic: [
    BasicAdjustment.Brightness,
    BasicAdjustment.Contrast,
    BasicAdjustment.Highlights,
    BasicAdjustment.Shadows,
    BasicAdjustment.Whites,
    BasicAdjustment.Blacks,
    BasicAdjustment.Exposure,
    'toneMapper',
  ],
  curves: ['curves', 'pointCurves', 'parametricCurve', 'curveMode', 'sceneCurveV1', 'outputCurveV1'],
  color: [
    ColorAdjustment.Saturation,
    ColorAdjustment.CameraProfile,
    ColorAdjustment.ToneCurve,
    ColorAdjustment.Temperature,
    ColorAdjustment.Tint,
    ColorAdjustment.Vibrance,
    ColorAdjustment.Hue,
    ColorAdjustment.BlackWhiteMixer,
    ColorAdjustment.ColorBalanceRgb,
    ColorAdjustment.ChannelMixer,
    ColorAdjustment.Levels,
    ColorAdjustment.Hsl,
    ColorAdjustment.ColorGrading,
    'colorCalibration',
  ],
  details: [
    DetailsAdjustment.Clarity,
    DetailsAdjustment.Dehaze,
    DetailsAdjustment.Structure,
    DetailsAdjustment.Centré,
    DetailsAdjustment.Sharpness,
    DetailsAdjustment.SharpnessThreshold,
    DetailsAdjustment.LumaNoiseReduction,
    DetailsAdjustment.ColorNoiseReduction,
    DetailsAdjustment.DustSpotOverlayEnabled,
    DetailsAdjustment.DustSpotSensitivity,
    DetailsAdjustment.DustSpotMinRadiusPx,
    DetailsAdjustment.ChromaticAberrationRedCyan,
    DetailsAdjustment.ChromaticAberrationBlueYellow,
  ],
  effects: [
    CreativeAdjustment.GlowAmount,
    CreativeAdjustment.HalationAmount,
    CreativeAdjustment.FlareAmount,
    Effect.GrainAmount,
    Effect.GrainRoughness,
    Effect.GrainSize,
    Effect.LutIntensity,
    Effect.LutName,
    Effect.LutPath,
    Effect.LutSize,
    Effect.VignetteAmount,
    Effect.VignetteFeather,
    Effect.VignetteMidpoint,
    Effect.VignetteRoundness,
  ],
  transformLens: [
    TransformAdjustment.TransformDistortion,
    TransformAdjustment.TransformVertical,
    TransformAdjustment.TransformHorizontal,
    TransformAdjustment.TransformRotate,
    TransformAdjustment.TransformAspect,
    TransformAdjustment.TransformScale,
    TransformAdjustment.TransformXOffset,
    TransformAdjustment.TransformYOffset,
    LensAdjustment.LensCorrectionMode,
    LensAdjustment.LensMaker,
    LensAdjustment.LensModel,
    LensAdjustment.LensDistortionAmount,
    LensAdjustment.LensVignetteAmount,
    LensAdjustment.LensTcaAmount,
    LensAdjustment.LensDistortionParams,
    LensAdjustment.LensDistortionEnabled,
    LensAdjustment.LensTcaEnabled,
    LensAdjustment.LensVignetteEnabled,
  ],
};
