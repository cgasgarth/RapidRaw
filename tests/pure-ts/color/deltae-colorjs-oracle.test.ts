import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import Color from 'colorjs.io';

import { calculateDeltaE00, type LabColor, labColorSchema } from '../../../src/utils/deltaE00';

type DeltaEFixture = {
  expectedDeltaE00: number;
  fixtureId: string;
  labA: LabColor;
  labB: LabColor;
  tolerance: number;
};

const manifest = JSON.parse(readFileSync('fixtures/color/reference/deltae-reference-fixtures.json', 'utf8')) as {
  fixtures: DeltaEFixture[];
};

const toColorJsLab = (lab: LabColor): Color => {
  const parsed = labColorSchema.parse(lab);
  return new Color('lab', [parsed.l, parsed.a, parsed.b]);
};

const calculateColorJsDeltaE00 = (labA: LabColor, labB: LabColor): number =>
  Color.deltaE(toColorJsLab(labA), toColorJsLab(labB), '2000');

describe('DeltaE00 ColorJS oracle', () => {
  test('matches published reference fixtures within a tight oracle tolerance', () => {
    for (const fixture of manifest.fixtures) {
      const actual = calculateDeltaE00(fixture.labA, fixture.labB);
      const oracle = calculateColorJsDeltaE00(fixture.labA, fixture.labB);

      expect(Math.abs(actual - oracle), fixture.fixtureId).toBeLessThanOrEqual(1e-12);
      expect(Math.abs(actual - fixture.expectedDeltaE00), fixture.fixtureId).toBeLessThanOrEqual(fixture.tolerance);
    }
  });

  test('matches ColorJS on neutral chroma and hue-wrap edge cases', () => {
    const edgeCases: Array<{ labA: LabColor; labB: LabColor; name: string }> = [
      {
        labA: { a: 0, b: 0, l: 20 },
        labB: { a: 0, b: 0, l: 80 },
        name: 'neutral lightness only',
      },
      {
        labA: { a: -0.001, b: 40, l: 50 },
        labB: { a: 0.001, b: 40, l: 50 },
        name: 'near hue wrap',
      },
      {
        labA: { a: -45, b: -5, l: 62 },
        labB: { a: 48, b: 6, l: 61 },
        name: 'opposed chroma quadrants',
      },
    ];

    for (const edgeCase of edgeCases) {
      expect(
        Math.abs(
          calculateDeltaE00(edgeCase.labA, edgeCase.labB) - calculateColorJsDeltaE00(edgeCase.labA, edgeCase.labB),
        ),
        edgeCase.name,
      ).toBeLessThanOrEqual(1e-12);
    }
  });
});
