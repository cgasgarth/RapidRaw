#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { z } from 'zod';

const degreesToRadians = (degrees) => (degrees * Math.PI) / 180;
const radiansToDegrees = (radians) => (radians * 180) / Math.PI;
const square = (value) => value * value;

const LabSchema = z
  .object({
    a: z.number(),
    b: z.number(),
    l: z.number().min(0).max(100),
  })
  .strict();

const DeltaEFixtureSchema = z
  .object({
    expectedDeltaE00: z.number().nonnegative(),
    fixtureId: z.string().regex(/^deltae\.[a-z0-9.-]+\.v[0-9]+$/u),
    labA: LabSchema,
    labB: LabSchema,
    notes: z.string().trim().min(1),
    tolerance: z.number().positive().max(0.01),
  })
  .strict();

const DeltaEFixtureManifestSchema = z
  .object({
    $schema: z.string().url(),
    fixtures: z.array(DeltaEFixtureSchema).min(1),
    issue: z.literal(89),
    schemaVersion: z.literal(1),
    snapshotDate: z.string().date(),
  })
  .strict()
  .superRefine((manifest, context) => {
    const fixtureIds = manifest.fixtures.map((fixture) => fixture.fixtureId);
    if (new Set(fixtureIds).size !== fixtureIds.length) {
      context.addIssue({
        code: 'custom',
        message: 'DeltaE fixture IDs must be unique.',
        path: ['fixtures'],
      });
    }

    const requiredIds = [
      'deltae.identity-neutral.v1',
      'deltae.sharma-blue-01.v1',
      'deltae.sharma-blue-02.v1',
      'deltae.sharma-blue-03.v1',
    ];
    if (JSON.stringify([...fixtureIds].sort()) !== JSON.stringify(requiredIds)) {
      context.addIssue({
        code: 'custom',
        message: `DeltaE manifest must contain: ${requiredIds.join(', ')}.`,
        path: ['fixtures'],
      });
    }
  });

const adjustedHueDegrees = (a, b) => {
  if (a === 0 && b === 0) return 0;
  const hue = radiansToDegrees(Math.atan2(b, a));
  return hue >= 0 ? hue : hue + 360;
};

const deltaHuePrime = (chromaA, chromaB, hueA, hueB) => {
  if (chromaA * chromaB === 0) return 0;
  const hueDelta = hueB - hueA;
  if (Math.abs(hueDelta) <= 180) return hueDelta;
  return hueDelta > 180 ? hueDelta - 360 : hueDelta + 360;
};

const averageHuePrime = (chromaA, chromaB, hueA, hueB) => {
  if (chromaA * chromaB === 0) return hueA + hueB;
  if (Math.abs(hueA - hueB) <= 180) return (hueA + hueB) / 2;
  return hueA + hueB < 360 ? (hueA + hueB + 360) / 2 : (hueA + hueB - 360) / 2;
};

const deltaE00 = (labA, labB) => {
  const chromaA = Math.hypot(labA.a, labA.b);
  const chromaB = Math.hypot(labB.a, labB.b);
  const averageChroma = (chromaA + chromaB) / 2;
  const chromaPower = averageChroma ** 7;
  const compensation = 0.5 * (1 - Math.sqrt(chromaPower / (chromaPower + 25 ** 7)));

  const aPrimeA = (1 + compensation) * labA.a;
  const aPrimeB = (1 + compensation) * labB.a;
  const chromaPrimeA = Math.hypot(aPrimeA, labA.b);
  const chromaPrimeB = Math.hypot(aPrimeB, labB.b);
  const huePrimeA = adjustedHueDegrees(aPrimeA, labA.b);
  const huePrimeB = adjustedHueDegrees(aPrimeB, labB.b);

  const deltaLightness = labB.l - labA.l;
  const deltaChromaPrime = chromaPrimeB - chromaPrimeA;
  const deltaHue = deltaHuePrime(chromaPrimeA, chromaPrimeB, huePrimeA, huePrimeB);
  const deltaHuePrimeValue = 2 * Math.sqrt(chromaPrimeA * chromaPrimeB) * Math.sin(degreesToRadians(deltaHue / 2));

  const averageLightness = (labA.l + labB.l) / 2;
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

const manifestPath = resolve('fixtures/color/deltae-reference-fixtures.json');
const manifest = DeltaEFixtureManifestSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8')));
const failures = [];

for (const fixture of manifest.fixtures) {
  const actual = deltaE00(fixture.labA, fixture.labB);
  const error = Math.abs(actual - fixture.expectedDeltaE00);
  if (error > fixture.tolerance) {
    failures.push(
      `${fixture.fixtureId}: expected ${fixture.expectedDeltaE00}, got ${actual.toFixed(6)}, error ${error.toFixed(
        6,
      )}.`,
    );
  }
}

if (failures.length > 0) {
  console.error('DeltaE fixture validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Validated ${manifest.fixtures.length} DeltaE00 reference fixtures.`);
