#!/usr/bin/env bun

import { readFile, writeFile } from 'node:fs/promises';

import { z } from 'zod';

import { calculateDeltaE00, labColorSchema } from '../../../src/utils/deltaE00.ts';

const FIXTURE_PATH = 'fixtures/color/proofs/colorchecker-render-gate.json';
const REPORT_PATH = 'docs/validation/proofs/color/colorchecker-render-gate-2026-06-20.json';
const UPDATE_REPORT = process.argv.includes('--update');

const patchSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/u),
    maxDeltaE00: z.number().positive().max(5),
    referenceLab: labColorSchema,
    renderedLab: labColorSchema,
  })
  .strict();

const fixtureSchema = z
  .object({
    $schema: z.string().url(),
    fixtureId: z.literal('colorchecker.synthetic.render-gate.v1'),
    issue: z.literal(2328),
    patches: z.array(patchSchema).min(6),
    renderSource: z.literal('synthetic_public_lab_patch_grid'),
    schemaVersion: z.literal(1),
    snapshotDate: z.string().date(),
    validationMode: z.literal('colorchecker_synthetic_deltae_render_gate'),
  })
  .strict()
  .superRefine((fixture, context) => {
    const ids = fixture.patches.map((patch) => patch.id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: 'custom', message: 'ColorChecker render patch IDs must be unique.', path: ['patches'] });
    }
  });

const reportSchema = z
  .object({
    fixtureId: z.literal('colorchecker.synthetic.render-gate.v1'),
    fixturePath: z.literal(FIXTURE_PATH),
    issue: z.literal(2328),
    maxDeltaE00: z.number().nonnegative(),
    meanDeltaE00: z.number().nonnegative(),
    patchCount: z.number().int().min(6),
    patches: z
      .array(
        z
          .object({
            deltaE00: z.number().nonnegative(),
            id: z.string(),
            maxDeltaE00: z.number().positive(),
            status: z.literal('passed'),
          })
          .strict(),
      )
      .min(6),
    schemaVersion: z.literal(1),
    validationMode: z.literal('colorchecker_synthetic_deltae_render_gate'),
  })
  .strict();

const fixture = fixtureSchema.parse(JSON.parse(await readFile(FIXTURE_PATH, 'utf8')));
const failures: string[] = [];
const patchReports = fixture.patches.map((patch) => {
  const deltaE00 = roundMetric(calculateDeltaE00(patch.referenceLab, patch.renderedLab));
  if (deltaE00 > patch.maxDeltaE00) {
    failures.push(`${patch.id}: DeltaE00 ${deltaE00} exceeds max ${patch.maxDeltaE00}.`);
  }

  return {
    deltaE00,
    id: patch.id,
    maxDeltaE00: patch.maxDeltaE00,
    status: 'passed',
  };
});

if (failures.length > 0) {
  console.error('ColorChecker render gate failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

const deltaValues = patchReports.map((patch) => patch.deltaE00);
const report = reportSchema.parse({
  fixtureId: fixture.fixtureId,
  fixturePath: FIXTURE_PATH,
  issue: 2328,
  maxDeltaE00: Math.max(...deltaValues),
  meanDeltaE00: roundMetric(deltaValues.reduce((sum, delta) => sum + delta, 0) / deltaValues.length),
  patchCount: patchReports.length,
  patches: patchReports,
  schemaVersion: 1,
  validationMode: fixture.validationMode,
});

const reportText = `${JSON.stringify(report, null, 2)}\n`;
if (UPDATE_REPORT) {
  await writeFile(REPORT_PATH, reportText);
} else {
  const expected = reportSchema.parse(JSON.parse(await readFile(REPORT_PATH, 'utf8')));
  if (JSON.stringify(expected) !== JSON.stringify(report)) {
    throw new Error(`${REPORT_PATH} is stale; run bun run check:colorchecker-render-gate:update.`);
  }
}

console.log(`colorchecker render gate ok (${patchReports.length} patches, max DeltaE00 ${report.maxDeltaE00})`);

function roundMetric(value: number): number {
  return Number(value.toFixed(6));
}
