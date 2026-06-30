import {
  type AiPeopleMaskAnalysis,
  type AiPeopleMaskFakeAlphaMask,
  type AiPeopleMaskPart,
  type AiPeopleMaskTarget,
  aiPeopleMaskFakeAlphaMaskSchema,
  aiPeopleMaskTargetSchema,
} from '../../schemas/masks/aiMaskingSchemas';

type NormalizedRect = AiPeopleMaskAnalysis['people'][number]['bounds'];

const PART_RECT_FRACTIONS: Partial<Record<AiPeopleMaskPart, NormalizedRect>> = {
  arms: { height: 0.42, width: 0.92, x: 0.04, y: 0.34 },
  clothing: { height: 0.42, width: 0.72, x: 0.14, y: 0.5 },
  eyes: { height: 0.08, width: 0.34, x: 0.33, y: 0.25 },
  face: { height: 0.28, width: 0.44, x: 0.28, y: 0.16 },
  hair: { height: 0.18, width: 0.52, x: 0.24, y: 0.08 },
  hands: { height: 0.16, width: 0.86, x: 0.07, y: 0.54 },
  legs: { height: 0.34, width: 0.54, x: 0.23, y: 0.66 },
  lips: { height: 0.06, width: 0.2, x: 0.4, y: 0.36 },
  skin: { height: 0.36, width: 0.5, x: 0.25, y: 0.18 },
  teeth: { height: 0.04, width: 0.16, x: 0.42, y: 0.38 },
};

const combineRects = (base: NormalizedRect, fraction: NormalizedRect): NormalizedRect => ({
  height: base.height * fraction.height,
  width: base.width * fraction.width,
  x: base.x + base.width * fraction.x,
  y: base.y + base.height * fraction.y,
});

const containsPoint = (rect: NormalizedRect, x: number, y: number): boolean =>
  x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;

const rowsToCoverage = (rows: Array<string>): number => {
  const filledPixels = rows.reduce((total, row) => {
    let rowFilledPixels = 0;
    for (const cell of row) {
      if (cell === '#') {
        rowFilledPixels += 1;
      }
    }
    return total + rowFilledPixels;
  }, 0);
  const totalPixels = rows.reduce((total, row) => total + row.length, 0);
  return totalPixels === 0 ? 0 : filledPixels / totalPixels;
};

const getTargetRects = (analysis: AiPeopleMaskAnalysis, target: AiPeopleMaskTarget): Array<NormalizedRect> => {
  if (target.part === 'background') {
    return analysis.people.map((person) => person.bounds);
  }

  const people =
    target.personId === null
      ? analysis.people
      : analysis.people.filter((person) => person.personId === target.personId);

  if (target.part === 'full_person') {
    return people.map((person) => person.bounds);
  }

  const partFraction = PART_RECT_FRACTIONS[target.part];
  if (partFraction === undefined) {
    return [];
  }

  return people
    .filter((person) => person.availableParts.includes(target.part))
    .map((person) => combineRects(person.bounds, partFraction));
};

export function renderFakeAiPeopleMask(
  analysis: AiPeopleMaskAnalysis,
  target: AiPeopleMaskTarget,
  width: number,
  height: number,
): AiPeopleMaskFakeAlphaMask {
  const parsedTarget = aiPeopleMaskTargetSchema.parse(target);
  const targetRects = getTargetRects(analysis, parsedTarget);
  const rows: Array<string> = [];

  for (let rowIndex = 0; rowIndex < height; rowIndex += 1) {
    let row = '';
    const y = (rowIndex + 0.5) / height;

    for (let columnIndex = 0; columnIndex < width; columnIndex += 1) {
      const x = (columnIndex + 0.5) / width;
      const inside = targetRects.some((rect) => containsPoint(rect, x, y));
      row += parsedTarget.part === 'background' ? (inside ? '.' : '#') : inside ? '#' : '.';
    }

    rows.push(row);
  }

  return aiPeopleMaskFakeAlphaMaskSchema.parse({
    artifactId: `fake.people.${parsedTarget.personId ?? 'all'}.${parsedTarget.part}.v1`,
    coverage: rowsToCoverage(rows),
    height,
    rows,
    target: parsedTarget,
    width,
  });
}
