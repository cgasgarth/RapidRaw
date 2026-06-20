import { z } from 'zod';

const MINIMUM_DLT_CORRESPONDENCES = 4;
const EXPECTED_DLT_RANK = 8;
const RANK_TOLERANCE = 1e-8;
const MAX_CONDITION_NUMBER = 1_000_000_000;
const MINIMUM_HOMOGRAPHY_SCALE_ABS = 1e-8;
const MINIMUM_PROJECTIVE_SCALE_ABS = 1e-8;

export const panoramaHomographyPointPairV1Schema = z
  .object({
    source: z.tuple([z.number(), z.number()]),
    target: z.tuple([z.number(), z.number()]),
  })
  .strict();

export const panoramaHomographyDltDiagnosticCodeV1Schema = z.enum([
  'insufficient_correspondences',
  'dlt_rank_deficient',
  'dlt_ill_conditioned',
  'homography_scale_degenerate',
]);

export const panoramaHomographyDltDiagnosticsV1Schema = z
  .object({
    actionableMessage: z.string().trim().min(1),
    algorithmId: z.literal('normalized_dlt_rank_condition_scale_v1'),
    conditionNumber: z.number().positive().nullable(),
    correspondenceCount: z.number().int().nonnegative(),
    designMatrixRank: z.number().int().nonnegative(),
    expectedRank: z.literal(EXPECTED_DLT_RANK),
    failureCode: panoramaHomographyDltDiagnosticCodeV1Schema.optional(),
    homographyScaleAbs: z.number().nonnegative(),
    largestSingularValue: z.number().nonnegative(),
    minimumProjectiveScaleAbs: z.number().nonnegative(),
    normalizedResidualRms: z.number().nonnegative(),
    smallestRetainedSingularValue: z.number().nonnegative(),
    status: z.enum(['accepted', 'warning', 'rejected']),
    thresholds: z
      .object({
        maxConditionNumber: z.literal(MAX_CONDITION_NUMBER),
        minimumCorrespondences: z.literal(MINIMUM_DLT_CORRESPONDENCES),
        minimumHomographyScaleAbs: z.literal(MINIMUM_HOMOGRAPHY_SCALE_ABS),
        minimumProjectiveScaleAbs: z.literal(MINIMUM_PROJECTIVE_SCALE_ABS),
        rankTolerance: z.literal(RANK_TOLERANCE),
      })
      .strict(),
    warningCodes: z.array(panoramaHomographyDltDiagnosticCodeV1Schema),
  })
  .strict();

export const panoramaHomographyDltDiagnosticInputV1Schema = z
  .object({
    homography3x3: z.tuple([
      z.number(),
      z.number(),
      z.number(),
      z.number(),
      z.number(),
      z.number(),
      z.number(),
      z.number(),
      z.number(),
    ]),
    pointPairs: z.array(panoramaHomographyPointPairV1Schema),
  })
  .strict();

export type PanoramaHomographyPointPairV1 = z.infer<typeof panoramaHomographyPointPairV1Schema>;
export type PanoramaHomographyDltDiagnosticsV1 = z.infer<typeof panoramaHomographyDltDiagnosticsV1Schema>;
export type PanoramaHomographyDltDiagnosticInputV1 = z.infer<typeof panoramaHomographyDltDiagnosticInputV1Schema>;

type NormalizedPointPair = {
  source: [number, number];
  target: [number, number];
};

type DltClassification = {
  actionableMessage: string;
  failureCode?: z.infer<typeof panoramaHomographyDltDiagnosticCodeV1Schema>;
  status: PanoramaHomographyDltDiagnosticsV1['status'];
  warningCodes: z.infer<typeof panoramaHomographyDltDiagnosticCodeV1Schema>[];
};

export const buildPanoramaHomographyDltDiagnosticsV1 = (inputValue: unknown): PanoramaHomographyDltDiagnosticsV1 => {
  const input = panoramaHomographyDltDiagnosticInputV1Schema.parse(inputValue);
  const normalizedPairs = normalizePointPairs(input.pointPairs);
  const designMatrix = buildDltDesignMatrix(normalizedPairs);
  const singularValues = singularValuesForMatrix(designMatrix);
  const largestSingularValue = singularValues[0] ?? 0;
  const rankThreshold = Math.max(RANK_TOLERANCE, largestSingularValue * RANK_TOLERANCE);
  const retainedSingularValues = singularValues.filter((value) => value > rankThreshold);
  const designMatrixRank = retainedSingularValues.length;
  const smallestRetainedSingularValue = retainedSingularValues[EXPECTED_DLT_RANK - 1] ?? 0;
  const conditionNumber =
    designMatrixRank >= EXPECTED_DLT_RANK && smallestRetainedSingularValue > 0
      ? roundPanoramaHomographyDiagnostic(largestSingularValue / smallestRetainedSingularValue)
      : null;
  const homographyScaleAbs = roundPanoramaHomographyDiagnostic(Math.abs(input.homography3x3[8]));
  const minimumProjectiveScaleAbs = roundPanoramaHomographyDiagnostic(
    minimumProjectiveScale(input.homography3x3, input.pointPairs),
  );
  const classification = classifyDltDiagnostics({
    conditionNumber,
    designMatrixRank,
    homographyScaleAbs,
    minimumProjectiveScaleAbs,
    pointPairCount: input.pointPairs.length,
  });

  return panoramaHomographyDltDiagnosticsV1Schema.parse({
    actionableMessage: classification.actionableMessage,
    algorithmId: 'normalized_dlt_rank_condition_scale_v1',
    conditionNumber,
    correspondenceCount: input.pointPairs.length,
    designMatrixRank,
    expectedRank: EXPECTED_DLT_RANK,
    ...(classification.failureCode === undefined ? {} : { failureCode: classification.failureCode }),
    homographyScaleAbs,
    largestSingularValue: roundPanoramaHomographyDiagnostic(largestSingularValue),
    minimumProjectiveScaleAbs,
    normalizedResidualRms: roundPanoramaHomographyDiagnostic(
      rootMeanSquare(input.pointPairs.map((pointPair) => homographyResidual(input.homography3x3, pointPair))),
    ),
    smallestRetainedSingularValue: roundPanoramaHomographyDiagnostic(smallestRetainedSingularValue),
    status: classification.status,
    thresholds: {
      maxConditionNumber: MAX_CONDITION_NUMBER,
      minimumCorrespondences: MINIMUM_DLT_CORRESPONDENCES,
      minimumHomographyScaleAbs: MINIMUM_HOMOGRAPHY_SCALE_ABS,
      minimumProjectiveScaleAbs: MINIMUM_PROJECTIVE_SCALE_ABS,
      rankTolerance: RANK_TOLERANCE,
    },
    warningCodes: classification.warningCodes,
  });
};

const buildDltDesignMatrix = (pointPairs: NormalizedPointPair[]): number[][] =>
  pointPairs.flatMap((pointPair) => {
    const [x, y] = pointPair.source;
    const [u, v] = pointPair.target;
    return [
      [-x, -y, -1, 0, 0, 0, u * x, u * y, u],
      [0, 0, 0, -x, -y, -1, v * x, v * y, v],
    ];
  });

const normalizePointPairs = (pointPairs: PanoramaHomographyPointPairV1[]): NormalizedPointPair[] => {
  const sourceTransform = pointNormalization(pointPairs.map((pointPair) => pointPair.source));
  const targetTransform = pointNormalization(pointPairs.map((pointPair) => pointPair.target));
  return pointPairs.map((pointPair) => ({
    source: applyPointNormalization(pointPair.source, sourceTransform),
    target: applyPointNormalization(pointPair.target, targetTransform),
  }));
};

const pointNormalization = (points: [number, number][]) => {
  if (points.length === 0) return { meanX: 0, meanY: 0, scale: 1 };
  const meanX = average(points.map((point) => point[0]));
  const meanY = average(points.map((point) => point[1]));
  const meanDistance = average(points.map((point) => Math.hypot(point[0] - meanX, point[1] - meanY)));
  return {
    meanX,
    meanY,
    scale: meanDistance > 0 ? Math.SQRT2 / meanDistance : 1,
  };
};

const applyPointNormalization = (
  point: [number, number],
  transform: { meanX: number; meanY: number; scale: number },
): [number, number] => [(point[0] - transform.meanX) * transform.scale, (point[1] - transform.meanY) * transform.scale];

const singularValuesForMatrix = (matrix: number[][]): number[] => {
  if (matrix.length === 0) return [];
  const gram = matrix.map((leftRow) => matrix.map((rightRow) => dotProduct(leftRow, rightRow)));
  return eigenvaluesForSymmetricMatrix(gram)
    .map((value) => Math.sqrt(Math.max(0, value)))
    .sort((left, right) => right - left);
};

const eigenvaluesForSymmetricMatrix = (input: number[][]): number[] => {
  const matrix = input.map((row) => [...row]);
  const size = matrix.length;
  if (size <= 1) return matrix.map((row) => row[0] ?? 0);

  for (let iteration = 0; iteration < size * size * 20; iteration += 1) {
    const pivot = findLargestOffDiagonalCell(matrix);
    if (pivot.value <= 1e-12) break;

    const app = getMatrixCell(matrix, pivot.row, pivot.row);
    const aqq = getMatrixCell(matrix, pivot.column, pivot.column);
    const apq = getMatrixCell(matrix, pivot.row, pivot.column);
    const angle = 0.5 * Math.atan2(2 * apq, aqq - app);
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);

    for (let index = 0; index < size; index += 1) {
      if (index === pivot.row || index === pivot.column) continue;
      const aip = getMatrixCell(matrix, index, pivot.row);
      const aiq = getMatrixCell(matrix, index, pivot.column);
      const newAip = cosine * aip - sine * aiq;
      const newAiq = sine * aip + cosine * aiq;
      setSymmetricMatrixCell(matrix, index, pivot.row, newAip);
      setSymmetricMatrixCell(matrix, index, pivot.column, newAiq);
    }

    const cosine2 = cosine * cosine;
    const sine2 = sine * sine;
    setMatrixCell(matrix, pivot.row, pivot.row, cosine2 * app - 2 * sine * cosine * apq + sine2 * aqq);
    setMatrixCell(matrix, pivot.column, pivot.column, sine2 * app + 2 * sine * cosine * apq + cosine2 * aqq);
    setSymmetricMatrixCell(matrix, pivot.row, pivot.column, 0);
  }

  return matrix.map((row, index) => Math.max(0, row[index] ?? 0));
};

const findLargestOffDiagonalCell = (matrix: number[][]): { column: number; row: number; value: number } => {
  let row = 0;
  let column = 1;
  let value = 0;
  for (let rowIndex = 0; rowIndex < matrix.length; rowIndex += 1) {
    for (let columnIndex = rowIndex + 1; columnIndex < matrix.length; columnIndex += 1) {
      const candidate = Math.abs(getMatrixCell(matrix, rowIndex, columnIndex));
      if (candidate > value) {
        row = rowIndex;
        column = columnIndex;
        value = candidate;
      }
    }
  }
  return { column, row, value };
};

const setSymmetricMatrixCell = (matrix: number[][], row: number, column: number, value: number): void => {
  setMatrixCell(matrix, row, column, value);
  setMatrixCell(matrix, column, row, value);
};

const setMatrixCell = (matrix: number[][], row: number, column: number, value: number): void => {
  const targetRow = matrix[row];
  if (targetRow === undefined) throw new Error(`Matrix row ${row} is out of bounds.`);
  targetRow[column] = value;
};

const getMatrixCell = (matrix: number[][], row: number, column: number): number => {
  const targetRow = matrix[row];
  if (targetRow === undefined) throw new Error(`Matrix row ${row} is out of bounds.`);
  return targetRow[column] ?? 0;
};

const dotProduct = (left: number[], right: number[]): number =>
  left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0);

const classifyDltDiagnostics = ({
  conditionNumber,
  designMatrixRank,
  homographyScaleAbs,
  minimumProjectiveScaleAbs,
  pointPairCount,
}: {
  conditionNumber: number | null;
  designMatrixRank: number;
  homographyScaleAbs: number;
  minimumProjectiveScaleAbs: number;
  pointPairCount: number;
}): DltClassification => {
  if (pointPairCount < MINIMUM_DLT_CORRESPONDENCES) {
    return {
      actionableMessage: 'Homography DLT requires at least four matched point pairs.',
      failureCode: 'insufficient_correspondences',
      status: 'rejected',
      warningCodes: [],
    };
  }
  if (designMatrixRank < EXPECTED_DLT_RANK) {
    return {
      actionableMessage: 'Matched panorama points are rank deficient; add non-collinear overlap matches.',
      failureCode: 'dlt_rank_deficient',
      status: 'rejected',
      warningCodes: [],
    };
  }
  if (homographyScaleAbs <= MINIMUM_HOMOGRAPHY_SCALE_ABS || minimumProjectiveScaleAbs <= MINIMUM_PROJECTIVE_SCALE_ABS) {
    return {
      actionableMessage: 'Homography scale is degenerate near zero; reject this alignment and re-estimate.',
      failureCode: 'homography_scale_degenerate',
      status: 'rejected',
      warningCodes: [],
    };
  }
  if (conditionNumber !== null && conditionNumber > MAX_CONDITION_NUMBER) {
    return {
      actionableMessage:
        'Homography DLT is accepted with poor numerical conditioning; prefer stronger overlap matches.',
      status: 'warning',
      warningCodes: ['dlt_ill_conditioned'],
    };
  }
  return {
    actionableMessage: 'Homography DLT diagnostics accepted.',
    status: 'accepted',
    warningCodes: [],
  };
};

const minimumProjectiveScale = (
  homography: PanoramaHomographyDltDiagnosticInputV1['homography3x3'],
  pointPairs: PanoramaHomographyPointPairV1[],
): number => {
  if (pointPairs.length === 0) return Math.abs(homography[8]);
  return Math.min(
    ...pointPairs.map((pointPair) => {
      const [x, y] = pointPair.source;
      return Math.abs(homography[6] * x + homography[7] * y + homography[8]);
    }),
  );
};

const homographyResidual = (
  homography: PanoramaHomographyDltDiagnosticInputV1['homography3x3'],
  pointPair: PanoramaHomographyPointPairV1,
): number => {
  const [x, y] = pointPair.source;
  const [u, v] = pointPair.target;
  const denominator = homography[6] * x + homography[7] * y + homography[8];
  if (Math.abs(denominator) <= MINIMUM_PROJECTIVE_SCALE_ABS) return 1_000_000_000;
  const projectedX = (homography[0] * x + homography[1] * y + homography[2]) / denominator;
  const projectedY = (homography[3] * x + homography[4] * y + homography[5]) / denominator;
  return Math.hypot(projectedX - u, projectedY - v);
};

const rootMeanSquare = (values: number[]): number => {
  if (values.length === 0) return 0;
  return Math.sqrt(average(values.map((value) => value * value)));
};

const average = (values: number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);

const roundPanoramaHomographyDiagnostic = (value: number): number => Number(value.toFixed(12));
