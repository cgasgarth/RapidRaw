import { z } from 'zod';

const matrixSchema = z.tuple([
  z.tuple([z.number().finite().max(4).min(-4), z.number().finite().max(4).min(-4)]),
  z.tuple([z.number().finite().max(4).min(-4), z.number().finite().max(4).min(-4)]),
]);

const hueWarpSchema = z
  .object({
    basis: z.literal('periodic_cubic_bspline_v1'),
    hueDeltaDeg: z.array(z.number().finite()),
    knotAnglesDeg: z.array(z.number().finite()).min(5),
    logChromaDelta: z.array(z.number().finite()),
    neutralGateC0: z.number().finite().positive(),
  })
  .strict()
  .superRefine((warp, context) => {
    if (
      warp.knotAnglesDeg.length !== warp.hueDeltaDeg.length ||
      warp.knotAnglesDeg.length !== warp.logChromaDelta.length
    )
      context.addIssue({ code: 'custom', message: 'Hue field arrays must have equal lengths.', path: ['hueDeltaDeg'] });
    const firstAngle = warp.knotAnglesDeg[0] ?? Number.NaN;
    const lastAngle = warp.knotAnglesDeg.at(-1) ?? Number.NaN;
    if (firstAngle !== 0 || lastAngle !== 360)
      context.addIssue({
        code: 'custom',
        message: 'Hue field must close at 0 and 360 degrees.',
        path: ['knotAnglesDeg'],
      });
    if (warp.knotAnglesDeg.some((value, index) => index > 0 && value <= (warp.knotAnglesDeg[index - 1] ?? value)))
      context.addIssue({ code: 'custom', message: 'Hue knots must be strictly increasing.', path: ['knotAnglesDeg'] });
    const spacing = (warp.knotAnglesDeg[1] ?? 0) - firstAngle;
    if (
      warp.knotAnglesDeg
        .slice(1)
        .some((value, index) => index > 0 && Math.abs(value - (warp.knotAnglesDeg[index] ?? value) - spacing) > 1e-3)
    )
      context.addIssue({
        code: 'custom',
        message: 'Hue knots must be uniformly spaced for periodic continuity.',
        path: ['knotAnglesDeg'],
      });
    if ((warp.hueDeltaDeg[0] ?? Number.NaN) !== (warp.hueDeltaDeg.at(-1) ?? Number.NaN))
      context.addIssue({ code: 'custom', message: 'Hue delta must close periodically.', path: ['hueDeltaDeg'] });
    if ((warp.logChromaDelta[0] ?? Number.NaN) !== (warp.logChromaDelta.at(-1) ?? Number.NaN))
      context.addIssue({ code: 'custom', message: 'Chroma delta must close periodically.', path: ['logChromaDelta'] });
  });

const safetySchema = z
  .object({
    maxChromaScale: z.number().finite().min(1).max(8),
    maxHueDeltaDeg: z.number().finite().min(0).max(180),
    maxOpponentMagnitude: z.number().finite().min(0.01).max(16),
  })
  .strict();

export const filmColorCouplerV1Schema = z
  .object({
    exposureAnchorsEv: z.array(z.number().finite()).min(2),
    hueWarp: hueWarpSchema,
    model: z.literal('opponent_coupler_v1'),
    opponentMatrices: z.array(matrixSchema).min(2),
    safety: safetySchema,
  })
  .strict()
  .superRefine((curve, context) => {
    if (curve.exposureAnchorsEv.length !== curve.opponentMatrices.length)
      context.addIssue({
        code: 'custom',
        message: 'Every exposure anchor needs a matrix.',
        path: ['opponentMatrices'],
      });
    if (
      curve.exposureAnchorsEv.some(
        (value, index) => index > 0 && value <= (curve.exposureAnchorsEv[index - 1] ?? value),
      )
    )
      context.addIssue({
        code: 'custom',
        message: 'Exposure anchors must be strictly increasing.',
        path: ['exposureAnchorsEv'],
      });
    curve.opponentMatrices.forEach((matrix, index) => {
      const determinant = matrix[0][0] * matrix[1][1] - matrix[0][1] * matrix[1][0];
      const norm = Math.hypot(matrix[0][0], matrix[0][1], matrix[1][0], matrix[1][1]);
      if (determinant <= 0 || norm > 4)
        context.addIssue({
          code: 'custom',
          message: 'Opponent matrix is outside the bounded orientation envelope.',
          path: ['opponentMatrices', index],
        });
    });
  });

export type FilmColorCouplerV1 = z.infer<typeof filmColorCouplerV1Schema>;

const periodicCubic = (values: readonly number[], angleDeg: number): number => {
  const effectiveLength = values.length - 1;
  const angle = ((angleDeg % 360) + 360) % 360;
  const segment = Math.floor((angle / 360) * effectiveLength) % effectiveLength;
  const t = (angle - (360 * segment) / effectiveLength) / (360 / effectiveLength);
  const at = (index: number) => values[index % effectiveLength] ?? 0;
  const p0 = at(segment + effectiveLength - 1);
  const p1 = at(segment);
  const p2 = at(segment + 1);
  const p3 = at(segment + 2);
  return (
    0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t ** 2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3)
  );
};

export const evaluateFilmColorCouplerV1 = (
  curve: FilmColorCouplerV1,
  rgbAp1: readonly [number, number, number],
  exposureEv: number,
): [number, number, number] => {
  const validated = filmColorCouplerV1Schema.parse(curve);
  const [r, g, b] = rgbAp1;
  const luminance = 0.27222872 * r + 0.67408177 * g + 0.05368952 * b;
  if (
    !Number.isFinite(luminance) ||
    Math.abs(luminance) <= 1e-8 ||
    Math.max(Math.abs(r - luminance), Math.abs(g - luminance), Math.abs(b - luminance)) <= 1e-6
  )
    return [r, g, b];
  const normalized = [
    (r - luminance) / Math.abs(luminance),
    (g - luminance) / Math.abs(luminance),
    (b - luminance) / Math.abs(luminance),
  ];
  const anchors = validated.exposureAnchorsEv;
  const segment =
    exposureEv <= (anchors[0] ?? 0)
      ? 0
      : exposureEv >= (anchors.at(-1) ?? 0)
        ? anchors.length - 2
        : Math.max(0, anchors.findIndex((value) => exposureEv <= value) - 1);
  const t = Math.max(
    0,
    Math.min(1, (exposureEv - (anchors[segment] ?? 0)) / ((anchors[segment + 1] ?? 1) - (anchors[segment] ?? 0))),
  );
  const identity: [[number, number], [number, number]] = [
    [1, 0],
    [0, 1],
  ];
  const left = validated.opponentMatrices[segment] ?? validated.opponentMatrices[0] ?? identity;
  const right = validated.opponentMatrices[segment + 1] ?? validated.opponentMatrices.at(-1) ?? identity;
  const matrix = left.map((row, rowIndex) =>
    row.map((value, columnIndex) => value + t * ((right[rowIndex]?.[columnIndex] ?? value) - value)),
  ) as [[number, number], [number, number]];
  const row0 = matrix[0] ?? [1, 0];
  const row1 = matrix[1] ?? [0, 1];
  const normalizedR = normalized[0] ?? 0;
  const normalizedG = normalized[1] ?? 0;
  const normalizedB = normalized[2] ?? 0;
  const o1 = row0[0] * (normalizedR - normalizedG) + row0[1] * (normalizedB - normalizedG);
  const o2 = row1[0] * (normalizedR - normalizedG) + row1[1] * (normalizedB - normalizedG);
  const chroma = Math.hypot(o1, o2);
  if (!Number.isFinite(chroma) || chroma <= 1e-8) return [r, g, b];
  const gate = chroma / (chroma + validated.hueWarp.neutralGateC0);
  const hue = Math.atan2(o2, o1);
  const hueDelta =
    (Math.max(
      -validated.safety.maxHueDeltaDeg,
      Math.min(
        validated.safety.maxHueDeltaDeg,
        gate * periodicCubic(validated.hueWarp.hueDeltaDeg, (hue * 180) / Math.PI),
      ),
    ) *
      Math.PI) /
    180;
  const chromaScale = Math.max(
    1 / validated.safety.maxChromaScale,
    Math.min(
      validated.safety.maxChromaScale,
      Math.exp(gate * periodicCubic(validated.hueWarp.logChromaDelta, (hue * 180) / Math.PI)),
    ),
  );
  const outputChroma = Math.min(validated.safety.maxOpponentMagnitude, chroma * chromaScale);
  const outputHue = hue + hueDelta;
  const outputO1 = outputChroma * Math.cos(outputHue);
  const outputO2 = outputChroma * Math.sin(outputHue);
  const qY = -(0.27222872 * outputO1 + 0.05368952 * outputO2);
  return [
    luminance + Math.abs(luminance) * (qY + outputO1),
    luminance + Math.abs(luminance) * qY,
    luminance + Math.abs(luminance) * (qY + outputO2),
  ];
};

export const referenceFilmColorCouplerV1: FilmColorCouplerV1 = {
  model: 'opponent_coupler_v1',
  exposureAnchorsEv: [-12, -4, 0, 4, 8],
  opponentMatrices: [
    [
      [1.02, 0.03],
      [-0.02, 0.98],
    ],
    [
      [1.01, 0.02],
      [-0.015, 1.01],
    ],
    [
      [1, 0.015],
      [-0.01, 1.02],
    ],
    [
      [0.98, -0.01],
      [0.02, 1.03],
    ],
    [
      [0.96, -0.02],
      [0.03, 1.04],
    ],
  ],
  hueWarp: {
    basis: 'periodic_cubic_bspline_v1',
    knotAnglesDeg: [0, 60, 120, 180, 240, 300, 360],
    hueDeltaDeg: [0, 4, 7, 3, -2, -1, 0],
    logChromaDelta: [0, 0.05, 0.08, -0.04, -0.06, 0.02, 0],
    neutralGateC0: 0.08,
  },
  safety: { maxOpponentMagnitude: 1.5, maxHueDeltaDeg: 12, maxChromaScale: 1.35 },
};
