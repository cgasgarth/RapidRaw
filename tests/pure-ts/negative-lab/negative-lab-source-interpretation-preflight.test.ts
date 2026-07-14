import { describe, expect, test } from 'bun:test';

import { negativeLabSourceInterpretationV1Schema } from '../../../packages/rawengine-schema/src/index.ts';

const hash = (value: string) => `sha256:${value.repeat(64).slice(0, 64)}`;

describe('Negative Lab source interpretation preflight contract', () => {
  test('accepts loader-grounded RAW evidence and review-only JPEG evidence', () => {
    const raw = negativeLabSourceInterpretationV1Schema.parse({
      appliedLinearization: 'native_raw_to_scene_linear_v1',
      bitDepth: 32,
      blockReasons: [],
      confidence: 0.95,
      decoderBackend: 'rawler',
      decoderVersion: 'rawengine_rawler_v1',
      dimensions: { height: 200, width: 300 },
      embeddedIccProfile: false,
      interpretationHash: hash('a'),
      nonFiniteFraction: 0,
      orientation: 'unknown',
      rawDemosaicMode: 'Linear',
      sampleFormat: 'Rgba32F',
      schemaVersion: 1,
      sourceHash: hash('b'),
      sourceType: 'raw',
      transferFunction: 'camera_rgb_profiled',
      warningCodes: [],
    });
    expect(raw.sourceType).toBe('raw');

    const jpeg = negativeLabSourceInterpretationV1Schema.parse({
      ...raw,
      interpretationHash: hash('c'),
      sourceHash: hash('d'),
      sourceType: 'rendered_jpeg',
      warningCodes: ['rendered_jpeg_review_only'],
    });
    expect(jpeg.warningCodes).toContain('rendered_jpeg_review_only');
  });

  test('rejects stale or malformed interpretation identities', () => {
    expect(() =>
      negativeLabSourceInterpretationV1Schema.parse({
        sourceType: 'raw',
        interpretationHash: 'not-a-hash',
      }),
    ).toThrow();
  });
});
