import { describe, expect, test } from 'bun:test';

import { buildFilmGrainControlsFromAdjustmentPatch } from '../../../packages/rawengine-schema/src/filmGrainProvenance.ts';
import { INITIAL_ADJUSTMENTS, normalizeLoadedAdjustments } from '../../../src/utils/adjustments.ts';
import { FILM_LOOK_BROWSER_ITEMS } from '../../../src/utils/film-look/filmLookRegistry.ts';
import {
  applyGovernedFilmLookRuntime,
  buildGovernedFilmLookCommand,
  type GovernedFilmLookPixel,
  type GovernedFilmLookRecipe,
} from '../../../src/utils/governedFilmLookRuntime.ts';

const WIDTH = 24;
const HEIGHT = 14;
const SOURCE_CONTENT_HASH = 'sha256:4853485348534853485348534853485348534853485348534853485348534853';
const LOOK_ID = 'film_look.generic.warm_print.v1';
const VARIANT_ID = 'film-effects-output-proof-v1';

const look = FILM_LOOK_BROWSER_ITEMS.find((item) => item.id === LOOK_ID);

describe('film grain and halation output proof', () => {
  test('nonzero settings change deterministic governed runtime output', () => {
    expect(look).toBeDefined();

    const adjustments = normalizeLoadedAdjustments({
      ...INITIAL_ADJUSTMENTS,
      grainAmount: 42,
      grainRoughness: 61,
      grainSize: 38,
      halationAmount: 32,
    });
    const grainControls = buildFilmGrainControlsFromAdjustmentPatch({
      grainAmount: adjustments.grainAmount,
      grainRoughness: adjustments.grainRoughness,
      grainSize: adjustments.grainSize,
    });
    const halationControls = {
      amount: adjustments.halationAmount,
      enabled: adjustments.halationAmount > 0,
      highlightThresholdEv: 2.2,
      sigmaShortEdgeFraction: 0.0015,
      warmth: 0.48,
    } satisfies GovernedFilmLookRecipe['halation'];

    const sourcePixels = makeSyntheticRampFixture();
    const baseline = applyProofRuntime(sourcePixels, {
      grain: { ...grainControls, amount: 0 },
      halation: { ...halationControls, amount: 0, enabled: false },
    });
    const grainOnly = applyProofRuntime(sourcePixels, {
      grain: grainControls,
      halation: { ...halationControls, amount: 0, enabled: false },
    });
    const halationOnly = applyProofRuntime(sourcePixels, {
      grain: { ...grainControls, amount: 0 },
      halation: halationControls,
    });
    const combined = applyProofRuntime(sourcePixels, {
      grain: grainControls,
      halation: halationControls,
    });

    const grainHighFrequencyVarianceDelta =
      calculateHighFrequencyLumaVariance(grainOnly.outputPixels) -
      calculateHighFrequencyLumaVariance(baseline.outputPixels);
    const halationCoverage = calculateWarmHaloCoverageNearHighlights(
      sourcePixels,
      baseline.outputPixels,
      halationOnly.outputPixels,
    );
    const proofMetrics = {
      changedPixels: countChangedPixels(baseline.outputPixels, combined.outputPixels),
      changedPixelRatio: calculateChangedPixelRatio(baseline.outputPixels, combined.outputPixels),
      combinedOutputHash: combined.afterHash,
      grainOutputHash: grainOnly.afterHash,
      halationOutputHash: halationOnly.afterHash,
      highFrequencyLumaVarianceDelta: roundMetric(grainHighFrequencyVarianceDelta),
      redOrangeHaloCoverageNearHighlights: halationCoverage,
    };

    expect(combined.beforeHash).toBe(baseline.beforeHash);
    expect(combined.afterHash).not.toBe(baseline.afterHash);
    expect(grainOnly.afterHash).not.toBe(baseline.afterHash);
    expect(halationOnly.afterHash).not.toBe(baseline.afterHash);
    expect(combined.provenance.renderStages).toEqual([
      'look_adjustment_patch',
      'late_working_linear_before_output_transform',
      'creative_final_after_glow',
    ]);
    expect(combined.provenance.claimBoundary).toBe('governed_creative_look_not_measured_stock_emulation');
    expect(combined.provenance.halation.claimBoundary).toBe('rgb_creative_approximation_not_physical_film_halation');

    expect(proofMetrics).toEqual({
      changedPixelRatio: 1,
      changedPixels: 336,
      combinedOutputHash: 'rawengine-pixel-hash:b0edfdbb981c5177',
      grainOutputHash: 'rawengine-pixel-hash:9eb6261ecfc24204',
      halationOutputHash: 'rawengine-pixel-hash:c0663e33ef577eea',
      highFrequencyLumaVarianceDelta: 0.000291,
      redOrangeHaloCoverageNearHighlights: 0.509091,
    });
    expect(proofMetrics.highFrequencyLumaVarianceDelta).toBeGreaterThan(0.0002);
    expect(proofMetrics.redOrangeHaloCoverageNearHighlights).toBeGreaterThan(0.45);
  });
});

function applyProofRuntime(
  sourcePixels: ReadonlyArray<GovernedFilmLookPixel>,
  recipe: Pick<GovernedFilmLookRecipe, 'grain' | 'halation'>,
) {
  if (look === undefined) throw new Error(`Missing film look fixture source: ${LOOK_ID}`);

  return applyGovernedFilmLookRuntime({
    command: buildGovernedFilmLookCommand({
      imageId: 'film-effects-output-proof',
      imagePath: '/synthetic/film/film-effects-output-proof.dng',
      look,
      operationId: 'film_effects_output_proof',
      recipe,
      sessionId: 'film-effects-output-proof-session',
      sourceContentHash: SOURCE_CONTENT_HASH,
      strength: 70,
      variantId: VARIANT_ID,
    }),
    look,
    sourcePixels,
  });
}

function makeSyntheticRampFixture(): Array<GovernedFilmLookPixel> {
  const pixels: Array<GovernedFilmLookPixel> = [];

  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const ramp = x / (WIDTH - 1);
      const row = y / (HEIGHT - 1);
      const neutralPatch = x >= 2 && x <= 6 && y >= 9 && y <= 11;
      const specularDisc = (x - 15) ** 2 + (y - 4) ** 2 <= 5;
      const hardHighlightEdge = x >= WIDTH - 4 && y >= 2 && y <= HEIGHT - 4;
      const base = neutralPatch ? 0.24 : 0.05 + ramp * 0.56 + row * 0.08;
      const highlightBoost = specularDisc ? 0.9 : hardHighlightEdge ? 0.68 : 0;

      pixels.push({
        b: roundChannel(base * 0.82 + highlightBoost * 0.52 + (y % 4 === 0 ? 0.025 : 0)),
        g: roundChannel(base * 0.94 + highlightBoost * 0.74),
        r: roundChannel(base + highlightBoost),
        x,
        y,
      });
    }
  }

  return pixels;
}

function calculateWarmHaloCoverageNearHighlights(
  source: ReadonlyArray<GovernedFilmLookPixel>,
  before: ReadonlyArray<GovernedFilmLookPixel>,
  after: ReadonlyArray<GovernedFilmLookPixel>,
): number {
  const highlightCoordinates = new Set(
    source.filter((pixel) => calculateLuma(pixel) > 0.78).map((pixel) => `${pixel.x}:${pixel.y}`),
  );
  let eligibleHaloPixels = 0;
  let warmHaloPixels = 0;

  for (let index = 0; index < source.length; index += 1) {
    const sourcePixel = source[index];
    const beforePixel = before[index];
    const afterPixel = after[index];
    if (sourcePixel === undefined || beforePixel === undefined || afterPixel === undefined) continue;
    if (calculateLuma(sourcePixel) > 0.78 || !isNearHighlight(sourcePixel, highlightCoordinates)) continue;

    eligibleHaloPixels += 1;
    const redDelta = afterPixel.r - beforePixel.r;
    const greenDelta = afterPixel.g - beforePixel.g;
    const blueDelta = afterPixel.b - beforePixel.b;
    if (redDelta > 0.001 && redDelta > greenDelta && greenDelta >= blueDelta) {
      warmHaloPixels += 1;
    }
  }

  return roundMetric(eligibleHaloPixels === 0 ? 0 : warmHaloPixels / eligibleHaloPixels);
}

function isNearHighlight(pixel: GovernedFilmLookPixel, highlightCoordinates: ReadonlySet<string>): boolean {
  for (let y = pixel.y - 3; y <= pixel.y + 3; y += 1) {
    for (let x = pixel.x - 3; x <= pixel.x + 3; x += 1) {
      if (highlightCoordinates.has(`${x}:${y}`)) return true;
    }
  }

  return false;
}

function calculateHighFrequencyLumaVariance(pixels: ReadonlyArray<GovernedFilmLookPixel>): number {
  const pixelsByCoordinate = new Map(pixels.map((pixel) => [`${pixel.x}:${pixel.y}`, pixel]));
  const residuals = pixels.map((pixel) => {
    let neighborLumaSum = 0;
    let neighborCount = 0;
    for (let y = pixel.y - 1; y <= pixel.y + 1; y += 1) {
      for (let x = pixel.x - 1; x <= pixel.x + 1; x += 1) {
        if (x === pixel.x && y === pixel.y) continue;
        const clampedX = Math.min(WIDTH - 1, Math.max(0, x));
        const clampedY = Math.min(HEIGHT - 1, Math.max(0, y));
        const neighbor = pixelsByCoordinate.get(`${clampedX}:${clampedY}`);
        if (neighbor === undefined) continue;
        neighborLumaSum += calculateLuma(neighbor);
        neighborCount += 1;
      }
    }

    return calculateLuma(pixel) - neighborLumaSum / neighborCount;
  });
  const mean = residuals.reduce((sum, residual) => sum + residual, 0) / residuals.length;
  return residuals.reduce((sum, residual) => sum + (residual - mean) ** 2, 0) / residuals.length;
}

function calculateChangedPixelRatio(
  before: ReadonlyArray<GovernedFilmLookPixel>,
  after: ReadonlyArray<GovernedFilmLookPixel>,
): number {
  return roundMetric(countChangedPixels(before, after) / after.length);
}

function countChangedPixels(
  before: ReadonlyArray<GovernedFilmLookPixel>,
  after: ReadonlyArray<GovernedFilmLookPixel>,
): number {
  return after.filter((pixel, index) => {
    const beforePixel = before[index];
    return (
      beforePixel === undefined || pixel.r !== beforePixel.r || pixel.g !== beforePixel.g || pixel.b !== beforePixel.b
    );
  }).length;
}

function calculateLuma(pixel: Pick<GovernedFilmLookPixel, 'b' | 'g' | 'r'>): number {
  return 0.2126 * pixel.r + 0.7152 * pixel.g + 0.0722 * pixel.b;
}

function roundChannel(value: number): number {
  return Number(Math.min(1, Math.max(0, value)).toFixed(6));
}

function roundMetric(value: number): number {
  return Number(value.toFixed(6));
}
