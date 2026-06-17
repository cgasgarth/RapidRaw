import { z } from 'zod';

export const labColorSchema = z
  .object({
    a: z.number(),
    b: z.number(),
    l: z.number().min(0).max(100),
  })
  .strict();

export type LabColor = z.infer<typeof labColorSchema>;

const degreesToRadians = (degrees: number) => (degrees * Math.PI) / 180;
const radiansToDegrees = (radians: number) => (radians * 180) / Math.PI;
const square = (value: number) => value * value;

const adjustedHueDegrees = (a: number, b: number) => {
  if (a === 0 && b === 0) return 0;
  const hue = radiansToDegrees(Math.atan2(b, a));
  return hue >= 0 ? hue : hue + 360;
};

const deltaHuePrime = (chromaA: number, chromaB: number, hueA: number, hueB: number) => {
  if (chromaA * chromaB === 0) return 0;
  const hueDelta = hueB - hueA;
  if (Math.abs(hueDelta) <= 180) return hueDelta;
  return hueDelta > 180 ? hueDelta - 360 : hueDelta + 360;
};

const averageHuePrime = (chromaA: number, chromaB: number, hueA: number, hueB: number) => {
  if (chromaA * chromaB === 0) return hueA + hueB;
  if (Math.abs(hueA - hueB) <= 180) return (hueA + hueB) / 2;
  return hueA + hueB < 360 ? (hueA + hueB + 360) / 2 : (hueA + hueB - 360) / 2;
};

export const calculateDeltaE00 = (labA: LabColor, labB: LabColor) => {
  const parsedA = labColorSchema.parse(labA);
  const parsedB = labColorSchema.parse(labB);
  const chromaA = Math.hypot(parsedA.a, parsedA.b);
  const chromaB = Math.hypot(parsedB.a, parsedB.b);
  const averageChroma = (chromaA + chromaB) / 2;
  const chromaPower = averageChroma ** 7;
  const compensation = 0.5 * (1 - Math.sqrt(chromaPower / (chromaPower + 25 ** 7)));

  const aPrimeA = (1 + compensation) * parsedA.a;
  const aPrimeB = (1 + compensation) * parsedB.a;
  const chromaPrimeA = Math.hypot(aPrimeA, parsedA.b);
  const chromaPrimeB = Math.hypot(aPrimeB, parsedB.b);
  const huePrimeA = adjustedHueDegrees(aPrimeA, parsedA.b);
  const huePrimeB = adjustedHueDegrees(aPrimeB, parsedB.b);

  const deltaLightness = parsedB.l - parsedA.l;
  const deltaChromaPrime = chromaPrimeB - chromaPrimeA;
  const deltaHue = deltaHuePrime(chromaPrimeA, chromaPrimeB, huePrimeA, huePrimeB);
  const deltaHuePrimeValue = 2 * Math.sqrt(chromaPrimeA * chromaPrimeB) * Math.sin(degreesToRadians(deltaHue / 2));

  const averageLightness = (parsedA.l + parsedB.l) / 2;
  const averageChromaPrime = (chromaPrimeA + chromaPrimeB) / 2;
  const averageHue = averageHuePrime(chromaPrimeA, chromaPrimeB, huePrimeA, huePrimeB);

  const lightnessWeight = 1 + (0.015 * square(averageLightness - 50)) / Math.sqrt(20 + square(averageLightness - 50));
  const chromaWeight = 1 + 0.045 * averageChromaPrime;
  const hueWeight =
    1 +
    0.015 *
      averageChromaPrime *
      (1 -
        0.17 * Math.cos(degreesToRadians(averageHue - 30)) +
        0.24 * Math.cos(degreesToRadians(2 * averageHue)) +
        0.32 * Math.cos(degreesToRadians(3 * averageHue + 6)) -
        0.2 * Math.cos(degreesToRadians(4 * averageHue - 63)));

  const rotationAngle = 30 * Math.exp(-square((averageHue - 275) / 25));
  const chromaRotation = Math.sqrt(averageChromaPrime ** 7 / (averageChromaPrime ** 7 + 25 ** 7));
  const rotationTerm = -2 * chromaRotation * Math.sin(degreesToRadians(2 * rotationAngle));

  return Math.sqrt(
    square(deltaLightness / lightnessWeight) +
      square(deltaChromaPrime / chromaWeight) +
      square(deltaHuePrimeValue / hueWeight) +
      rotationTerm * (deltaChromaPrime / chromaWeight) * (deltaHuePrimeValue / hueWeight),
  );
};
