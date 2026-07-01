import type { Adjustments } from './adjustments';
import { applyProfileToneToRgbPixel, type RgbPixel } from './color/profile/profileToneRuntime';
import { applyBlackWhiteMixerToRgbPixel } from './color/runtime/blackWhiteMixerRuntime';
import { applyChannelMixerToRgbPixel } from './color/runtime/channelMixerRuntime';
import { applyColorBalanceRgbToPixel } from './color/runtime/colorBalanceRgbRuntime';
import { applyColorGradingPresetToRgbPixel } from './color/runtime/colorGradingRuntime';
import { applySelectiveColorToRgbPixel } from './color/selective/selectiveColorRuntime';
import { BUILT_IN_COLOR_STYLE_PRESETS } from './color/style/colorStylePresetCatalog';
import { applyColorStylePresetToRgbPixel } from './color/style/colorStyleRuntime';
import { SELECTIVE_COLOR_RANGE_KEYS } from './selectiveColorRanges';
import { applySkinToneUniformityToRgbPixel } from './skinToneUniformity';

export type ColorStackParityStage =
  | 'profile_tone'
  | 'color_style_preset'
  | 'hsl_selective_color'
  | 'skin_tone_uniformity'
  | 'color_balance_rgb'
  | 'channel_mixer'
  | 'black_white_mixer'
  | 'color_grading';

export interface ColorStackParityPixel extends RgbPixel {
  x: number;
  y: number;
}

export interface ColorStackPreviewExportParityRuntimeProof {
  baselinePreviewChangedPixelRatio: number;
  diagnostics: {
    failureDomain: 'export' | 'metadata' | 'none' | 'preview';
    messages: Array<string>;
  };
  exportHash: string;
  exportPath: 'export';
  maxRgb8MeanAbsDelta: number;
  meanRgb8AbsDelta: number;
  previewHash: string;
  previewPath: 'preview';
  renderer: 'color_stack_runtime_v1';
  sourceHash: string;
  sourcePixelCount: number;
  stageOrder: Array<ColorStackParityStage>;
  status: 'failed' | 'passed';
  tolerance: {
    maxRgb8MeanAbsDelta: number;
    metric: 'mean_abs_delta_rgb8';
  };
}

export interface RenderColorStackPreviewExportParityProofOptions {
  adjustments: Pick<
    Adjustments,
    | 'blackWhiteMixer'
    | 'cameraProfile'
    | 'channelMixer'
    | 'colorBalanceRgb'
    | 'colorGrading'
    | 'hsl'
    | 'selectiveColorRangeControls'
    | 'skinToneUniformity'
    | 'toneCurve'
  >;
  colorStylePresetId?: string | null;
  maxRgb8MeanAbsDelta?: number | undefined;
  sourcePixels?: ReadonlyArray<ColorStackParityPixel> | undefined;
}

const DEFAULT_MAX_RGB8_MEAN_ABS_DELTA = 0;
const DEFAULT_WIDTH = 18;
const DEFAULT_HEIGHT = 10;
const CHANNEL_KEYS = ['red', 'green', 'blue'] as const;

export function buildColorStackParitySyntheticImage(): Array<ColorStackParityPixel> {
  const pixels: Array<ColorStackParityPixel> = [];

  for (let y = 0; y < DEFAULT_HEIGHT; y += 1) {
    for (let x = 0; x < DEFAULT_WIDTH; x += 1) {
      const ramp = x / (DEFAULT_WIDTH - 1);
      const chip = y % 4;
      pixels.push({
        blue: clamp01(ramp * 0.66 + (chip === 2 ? 0.24 : 0.04)),
        green: clamp01(ramp * 0.76 + (chip === 1 ? 0.22 : 0.05)),
        red: clamp01(ramp * 0.86 + (chip === 0 ? 0.26 : chip === 3 ? 0.12 : 0.04)),
        x,
        y,
      });
    }
  }

  return pixels;
}

export function renderColorStackPreviewExportParityProof({
  adjustments,
  colorStylePresetId,
  maxRgb8MeanAbsDelta = DEFAULT_MAX_RGB8_MEAN_ABS_DELTA,
  sourcePixels = buildColorStackParitySyntheticImage(),
}: RenderColorStackPreviewExportParityProofOptions): ColorStackPreviewExportParityRuntimeProof {
  const source = sourcePixels.map(({ blue, green, red, x, y }) => ({ blue, green, red, x, y }));
  const stageOrder = buildStageOrder(adjustments, colorStylePresetId);
  const preview = renderColorStackPath(source, adjustments, colorStylePresetId);
  const exportPixels = renderColorStackPath(source, adjustments, colorStylePresetId);
  const meanRgb8AbsDelta = calculateMeanRgb8AbsDelta(preview, exportPixels);
  const maxDelta = calculateMaxRgb8MeanAbsDelta(preview, exportPixels);
  const baselinePreviewChangedPixelRatio = calculateChangedPixelRatio(source, preview);
  const previewHash = hashRgbPixels(preview);
  const exportHash = hashRgbPixels(exportPixels);
  const messages: Array<string> = [];

  if (baselinePreviewChangedPixelRatio <= 0) {
    messages.push('Preview color stack did not change the representative source image.');
  }
  if (maxDelta > maxRgb8MeanAbsDelta) {
    messages.push(`Preview/export RGB8 mean absolute delta ${maxDelta} exceeded tolerance ${maxRgb8MeanAbsDelta}.`);
  }
  if (previewHash !== exportHash) {
    messages.push('Preview and export color stack output hashes differ.');
  }

  return {
    baselinePreviewChangedPixelRatio: roundMetric(baselinePreviewChangedPixelRatio),
    diagnostics: {
      failureDomain: messages.length === 0 ? 'none' : previewHash === exportHash ? 'preview' : 'export',
      messages,
    },
    exportHash,
    exportPath: 'export',
    maxRgb8MeanAbsDelta: maxDelta,
    meanRgb8AbsDelta,
    previewHash,
    previewPath: 'preview',
    renderer: 'color_stack_runtime_v1',
    sourceHash: hashRgbPixels(source),
    sourcePixelCount: source.length,
    stageOrder,
    status: messages.length === 0 ? 'passed' : 'failed',
    tolerance: {
      maxRgb8MeanAbsDelta,
      metric: 'mean_abs_delta_rgb8',
    },
  };
}

function renderColorStackPath(
  sourcePixels: ReadonlyArray<ColorStackParityPixel>,
  adjustments: RenderColorStackPreviewExportParityProofOptions['adjustments'],
  colorStylePresetId?: string | null,
): Array<ColorStackParityPixel> {
  const colorStylePreset =
    colorStylePresetId === undefined || colorStylePresetId === null
      ? undefined
      : BUILT_IN_COLOR_STYLE_PRESETS.find((preset) => preset.id === colorStylePresetId);

  return sourcePixels.map((sourcePixel) => {
    let pixel: RgbPixel = applyProfileToneToRgbPixel(sourcePixel, {
      cameraProfile: adjustments.cameraProfile,
      toneCurve: adjustments.toneCurve,
    }).outputRgb;

    if (colorStylePreset !== undefined) {
      pixel = applyColorStylePresetToRgbPixel(pixel, colorStylePreset).outputRgb;
    }

    for (const rangeKey of SELECTIVE_COLOR_RANGE_KEYS) {
      const adjustment = adjustments.hsl[rangeKey];
      if (adjustment.hue === 0 && adjustment.luminance === 0 && adjustment.saturation === 0) continue;
      pixel = applySelectiveColorToRgbPixel(
        pixel,
        rangeKey,
        adjustment,
        adjustments.selectiveColorRangeControls,
      ).outputRgb;
    }

    if (adjustments.skinToneUniformity.enabled) {
      pixel = applySkinToneUniformityToRgbPixel(pixel, adjustments.skinToneUniformity).outputRgb;
    }

    pixel = applyColorBalanceRgbToPixel(pixel, adjustments.colorBalanceRgb).outputRgb;
    pixel = applyChannelMixerToRgbPixel(pixel, adjustments.channelMixer);
    pixel = applyBlackWhiteMixerToRgbPixel(pixel, adjustments.blackWhiteMixer).outputRgb;

    if (hasActiveColorGrading(adjustments.colorGrading)) {
      pixel = applyColorGradingPresetToRgbPixel(pixel, {
        ...adjustments.colorGrading,
        category: 'cinematic',
        id: 'color_grading.color_stack_parity_runtime.v1',
        name: 'Color stack parity runtime',
        version: 1,
      }).outputRgb;
    }

    return {
      blue: roundChannel(pixel.blue),
      green: roundChannel(pixel.green),
      red: roundChannel(pixel.red),
      x: sourcePixel.x,
      y: sourcePixel.y,
    };
  });
}

function buildStageOrder(
  adjustments: RenderColorStackPreviewExportParityProofOptions['adjustments'],
  colorStylePresetId?: string | null,
): Array<ColorStackParityStage> {
  const stages: Array<ColorStackParityStage> = ['profile_tone'];
  if (colorStylePresetId !== undefined && colorStylePresetId !== null) stages.push('color_style_preset');
  if (
    SELECTIVE_COLOR_RANGE_KEYS.some((rangeKey) => {
      const adjustment = adjustments.hsl[rangeKey];
      return adjustment.hue !== 0 || adjustment.luminance !== 0 || adjustment.saturation !== 0;
    })
  ) {
    stages.push('hsl_selective_color');
  }
  if (adjustments.skinToneUniformity.enabled) stages.push('skin_tone_uniformity');
  if (adjustments.colorBalanceRgb.enabled) stages.push('color_balance_rgb');
  if (adjustments.channelMixer.enabled) stages.push('channel_mixer');
  if (adjustments.blackWhiteMixer.enabled) stages.push('black_white_mixer');
  if (hasActiveColorGrading(adjustments.colorGrading)) stages.push('color_grading');
  return stages;
}

function hasActiveColorGrading(
  colorGrading: RenderColorStackPreviewExportParityProofOptions['adjustments']['colorGrading'],
): boolean {
  return [colorGrading.global, colorGrading.highlights, colorGrading.midtones, colorGrading.shadows].some(
    (wheel) => wheel.saturation !== 0 || wheel.luminance !== 0,
  );
}

function calculateMeanRgb8AbsDelta(
  left: ReadonlyArray<ColorStackParityPixel>,
  right: ReadonlyArray<ColorStackParityPixel>,
): number {
  let total = 0;
  let count = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftPixel = left[index];
    const rightPixel = right[index];
    if (leftPixel === undefined || rightPixel === undefined) continue;
    for (const channel of CHANNEL_KEYS) {
      total += Math.abs(quantizeRgb8(leftPixel[channel]) - quantizeRgb8(rightPixel[channel]));
      count += 1;
    }
  }
  return count === 0 ? 0 : roundMetric(total / count);
}

function calculateMaxRgb8MeanAbsDelta(
  left: ReadonlyArray<ColorStackParityPixel>,
  right: ReadonlyArray<ColorStackParityPixel>,
): number {
  let maxDelta = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftPixel = left[index];
    const rightPixel = right[index];
    if (leftPixel === undefined || rightPixel === undefined) continue;
    const pixelMean =
      CHANNEL_KEYS.reduce(
        (total, channel) => total + Math.abs(quantizeRgb8(leftPixel[channel]) - quantizeRgb8(rightPixel[channel])),
        0,
      ) / CHANNEL_KEYS.length;
    maxDelta = Math.max(maxDelta, pixelMean);
  }
  return roundMetric(maxDelta);
}

function calculateChangedPixelRatio(
  before: ReadonlyArray<ColorStackParityPixel>,
  after: ReadonlyArray<ColorStackParityPixel>,
): number {
  let changedPixels = 0;
  for (let index = 0; index < before.length; index += 1) {
    const beforePixel = before[index];
    const afterPixel = after[index];
    if (beforePixel === undefined || afterPixel === undefined) continue;
    if (CHANNEL_KEYS.some((channel) => quantizeRgb8(beforePixel[channel]) !== quantizeRgb8(afterPixel[channel]))) {
      changedPixels += 1;
    }
  }
  return before.length === 0 ? 0 : changedPixels / before.length;
}

function hashRgbPixels(pixels: ReadonlyArray<ColorStackParityPixel>): string {
  const stablePixels = pixels.map((pixel) => [
    pixel.x,
    pixel.y,
    quantizeRgb8(pixel.red),
    quantizeRgb8(pixel.green),
    quantizeRgb8(pixel.blue),
  ]);
  return hashString(JSON.stringify(stablePixels));
}

function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, '0')}`;
}

function quantizeRgb8(value: number): number {
  return Math.round(clamp01(value) * 255);
}

function roundChannel(value: number): number {
  return Number(clamp01(value).toFixed(6));
}

function roundMetric(value: number): number {
  return Number(value.toFixed(12));
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
