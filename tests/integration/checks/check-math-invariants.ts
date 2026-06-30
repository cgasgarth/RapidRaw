#!/usr/bin/env bun

import {
  applyColorParityLegacyTonemap,
  applyColorParityLinearExposure,
  applyColorParityLumaLevels,
  type ColorParityVec3,
} from '../../../src/utils/color/runtime/colorCpuGpuParity.ts';
import { calculateDeltaE00, type LabColor } from '../../../src/utils/deltaE00';
import {
  type LayerBlendMode,
  type LayerRgbPixel,
  renderLayerBlendStack,
  renderLayerExportStack,
  renderLayerHeadlessStack,
  renderLayerPreviewStack,
} from '../../../src/utils/layerPreviewExportParity';

const failureLimit = 20;
const failures: string[] = [];
let seed = 0x1293c0de;

const nextUnit = () => {
  seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
  return seed / 0x1_0000_0000;
};

const randomRange = (min: number, max: number) => min + (max - min) * nextUnit();
const approxEqual = (actual: number, expected: number, tolerance: number) => Math.abs(actual - expected) <= tolerance;

const recordFailure = (message: string) => {
  if (failures.length < failureLimit) failures.push(message);
};

const assertVecEqual = (actual: ColorParityVec3, expected: ColorParityVec3, context: string) => {
  for (let index = 0; index < expected.length; index += 1) {
    if (!approxEqual(actual[index], expected[index], 0.00000001)) {
      recordFailure(`${context}: channel ${index} ${actual[index]} != ${expected[index]}`);
    }
  }
};

const makeLab = (): LabColor => ({
  a: randomRange(-128, 128),
  b: randomRange(-128, 128),
  l: randomRange(0, 100),
});

const runDeltaEInvariants = () => {
  const cases = 64;
  for (let index = 0; index < cases; index += 1) {
    const first = makeLab();
    const second = makeLab();
    const identity = calculateDeltaE00(first, first);
    const forward = calculateDeltaE00(first, second);
    const reverse = calculateDeltaE00(second, first);

    if (!Number.isFinite(identity) || !approxEqual(identity, 0, 0.0000000001)) {
      recordFailure(`deltaE identity case ${index}: ${identity}`);
    }
    if (!Number.isFinite(forward) || forward < 0) {
      recordFailure(`deltaE nonnegative case ${index}: ${forward}`);
    }
    if (!approxEqual(forward, reverse, 0.000000001)) {
      recordFailure(`deltaE symmetry case ${index}: ${forward} != ${reverse}`);
    }
  }
  return cases;
};

const makeVec3 = (): ColorParityVec3 => [randomRange(0, 1), randomRange(0, 1), randomRange(0, 1)];

const runColorInvariants = () => {
  const cases = 64;
  let previousTone = applyColorParityLegacyTonemap([0, 0, 0]);
  for (let index = 0; index < cases; index += 1) {
    const input = makeVec3();
    assertVecEqual(applyColorParityLinearExposure(input, { exposure: 0 }), input, `linear exposure identity ${index}`);
    assertVecEqual(applyColorParityLumaLevels(input, { enabled: 0 }), input, `disabled luma levels identity ${index}`);

    const scalar = index / (cases - 1);
    const tone = applyColorParityLegacyTonemap([scalar, scalar, scalar]);
    for (let channel = 0; channel < tone.length; channel += 1) {
      if (tone[channel] < previousTone[channel] || tone[channel] < 0 || tone[channel] > 1) {
        recordFailure(`legacy tonemap monotonic/clamp case ${index} channel ${channel}: ${tone[channel]}`);
      }
    }
    previousTone = tone;
  }
  return cases;
};

const layerModes: readonly LayerBlendMode[] = ['normal', 'multiply', 'screen', 'overlay', 'soft_light'];

const makePixel = (): LayerRgbPixel => ({
  b: Math.round(randomRange(0, 255)),
  g: Math.round(randomRange(0, 255)),
  r: Math.round(randomRange(0, 255)),
});

const pixelsEqual = (actual: readonly LayerRgbPixel[], expected: readonly LayerRgbPixel[]) =>
  actual.length === expected.length &&
  actual.every((pixel, index) => {
    const expectedPixel = expected[index];
    return (
      expectedPixel !== undefined &&
      pixel.r === expectedPixel.r &&
      pixel.g === expectedPixel.g &&
      pixel.b === expectedPixel.b
    );
  });

const hashPixels = (pixels: readonly LayerRgbPixel[]) =>
  pixels.map((pixel) => `${pixel.r},${pixel.g},${pixel.b}`).join('|');

const runLayerInvariants = () => {
  const width = 4;
  const height = 4;
  const pixelCount = width * height;
  const basePixels = Array.from({ length: pixelCount }, makePixel);
  const sourcePixels = Array.from({ length: pixelCount }, makePixel);

  for (const mode of layerModes) {
    const hidden = renderLayerBlendStack({
      basePixels,
      height,
      layers: [
        { blendMode: mode, id: `hidden-${mode}`, name: 'hidden', opacity: 1, pixels: sourcePixels, visible: false },
      ],
      width,
    });
    if (!pixelsEqual(hidden.pixels, basePixels) || hidden.coverageByLayer.length !== 0) {
      recordFailure(`layer hidden identity failed for ${mode}`);
    }

    const masked = renderLayerBlendStack({
      basePixels,
      height,
      layers: [
        {
          blendMode: mode,
          id: `mask-${mode}`,
          maskAlpha: Array.from({ length: pixelCount }, () => 0),
          name: 'masked',
          opacity: 1,
          pixels: sourcePixels,
          visible: true,
        },
      ],
      width,
    });
    if (!pixelsEqual(masked.pixels, basePixels) || masked.coverageByLayer[0]?.touchedPixels !== 0) {
      recordFailure(`layer zero-mask identity failed for ${mode}`);
    }
  }

  const normal = renderLayerBlendStack({
    basePixels,
    height,
    layers: [
      { blendMode: 'normal', id: 'normal-full', name: 'normal', opacity: 1, pixels: sourcePixels, visible: true },
    ],
    width,
  });
  if (!pixelsEqual(normal.pixels, sourcePixels) || normal.coverageByLayer[0]?.touchedPixels !== pixelCount) {
    recordFailure('layer normal full opacity did not replace base pixels');
  }

  const parityInput = {
    basePixels,
    height,
    layers: [
      {
        blendMode: 'soft_light' as const,
        id: 'alias',
        name: 'alias',
        opacity: 0.75,
        pixels: sourcePixels,
        visible: true,
      },
    ],
    width,
  };
  const previewHash = hashPixels(renderLayerPreviewStack(parityInput).pixels);
  const exportHash = hashPixels(renderLayerExportStack(parityInput).pixels);
  const headlessHash = hashPixels(renderLayerHeadlessStack(parityInput).pixels);
  if (previewHash !== exportHash || previewHash !== headlessHash) {
    recordFailure('layer preview/export/headless aliases diverged');
  }

  return layerModes.length * 2 + 2;
};

const deltaECases = runDeltaEInvariants();
const colorCases = runColorInvariants();
const layerCases = runLayerInvariants();

if (failures.length > 0) {
  console.error(`math invariants failed (${failures.length}${failures.length === failureLimit ? '+' : ''})`);
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`math invariants ok (deltaE=${deltaECases} color=${colorCases} layer=${layerCases})`);
