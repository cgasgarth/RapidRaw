#!/usr/bin/env bun

import { readFile, writeFile } from 'node:fs/promises';

import { z } from 'zod';

import { createRawEngineLocalAppServerBridge } from '../../../packages/rawengine-schema/src/localAppServerBridge.ts';
import {
  toneColorCommandEnvelopeV1Schema,
  toneColorDryRunResultV1Schema,
  toneColorMutationResultV1Schema,
} from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import {
  sampleToneColorApplyCommandEnvelopeV1,
  sampleToneColorCommandEnvelopeV1,
} from '../../../packages/rawengine-schema/src/samplePayloads.ts';
import { applySkinToneUniformity, applySkinToneUniformityToRgbPixel } from '../../../src/utils/skinToneUniformity.ts';

const FIXTURE_PATH = 'fixtures/color/selective-color/skin-tone-uniformity-fixtures.json';
const REPORT_PATH = 'docs/validation/proofs/color-selective/skin-tone-uniformity-runtime-ui-proof-2026-06-18.json';
const UPDATE_REPORT = process.argv.includes('--update');

const skinPatchSchema = z
  .object({
    hueDegrees: z.number().min(0).lt(360),
    luminance: z.number().min(0).max(1),
    saturation: z.number().min(0).max(1),
  })
  .strict();

const rgbPixelSchema = z
  .object({
    blue: z.number().min(0).max(1),
    green: z.number().min(0).max(1),
    red: z.number().min(0).max(1),
  })
  .strict();

const settingsSchema = z
  .object({
    hueUniformity: z.number().min(0).max(1),
    luminanceUniformity: z.number().min(0).max(1),
    saturationUniformity: z.number().min(0).max(1),
    targetHueDegrees: z.number().min(0).lt(360),
    targetLuminance: z.number().min(0).max(1),
    targetSaturation: z.number().min(0).max(1),
  })
  .strict();

const caseSchema = z
  .object({
    expected: skinPatchSchema,
    expectedRgb: rgbPixelSchema.optional(),
    id: z.string().regex(/^color\.skin\.[a-z0-9.-]+\.v[0-9]+$/u),
    input: skinPatchSchema,
    inputRgb: rgbPixelSchema.optional(),
    settings: settingsSchema,
    tolerance: z.number().positive().max(0.001),
  })
  .strict();
const reportCaseSchema = z
  .object({
    hueDeltaDegrees: z.number(),
    id: z.string(),
    inputRgb: rgbPixelSchema.optional(),
    maxHslDelta: z.number().min(0),
    maxRgbDelta: z.number().min(0),
    outputRgb: rgbPixelSchema.optional(),
    runtimeStatus: z.literal('apply_runtime_proof'),
    targetDistanceAfter: z.number().min(0),
    targetDistanceBefore: z.number().min(0),
    uiProofStatus: z.literal('covered_by_color_workflow_visual_smoke'),
  })
  .strict();
const reportSchema = z
  .object({
    cases: z.array(reportCaseSchema).min(1),
    commandProof: z
      .object({
        applyCommandId: z.literal('command_tone_color_skin_uniformity_apply_001'),
        changedNodeId: z.literal('tone_color_skin_uniformity:image'),
        commandType: z.literal('toneColor.adjustSkinToneUniformity'),
        dryRunCommandId: z.literal('command_tone_color_skin_uniformity_preview_001'),
        experimental: z.literal(true),
        issue: z.literal(2332),
        localAppServerBridge: z.literal('dry_run_then_apply_required'),
        maxHueShiftDegrees: z.number().min(0).max(30),
        runtimeStatus: z.literal('experimental_runtime_slice'),
        warnings: z.array(z.string().min(1)).min(1),
      })
      .strict(),
    fixturePath: z.literal(FIXTURE_PATH),
    issue: z.literal(1263),
    schemaVersion: z.literal(1),
    validationMode: z.literal('skin_tone_uniformity_runtime_and_ui_artifact'),
    visualSmokeCommand: z.literal('bun run check:color-workflow-smoke'),
  })
  .strict();

const manifestSchema = z
  .object({
    $schema: z.string().url(),
    cases: z.array(caseSchema).min(1),
    issue: z.literal(98),
    schemaVersion: z.literal(1),
    snapshotDate: z.string().date(),
  })
  .strict()
  .superRefine((manifest, context) => {
    const ids = manifest.cases.map((testCase) => testCase.id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: 'custom', message: 'Skin-tone case IDs must be unique.', path: ['cases'] });
    }
  });

const manifest = manifestSchema.parse(JSON.parse(await readFile(FIXTURE_PATH, 'utf8')));
const fields = ['hueDegrees', 'saturation', 'luminance'];
const failures = [];
const reportCases = [];
const commandSettings = {
  experimental: true,
  hueUniformity: 0.45,
  luminanceUniformity: 0.25,
  maxHueShiftDegrees: 18,
  saturationUniformity: 0.35,
  targetHueDegrees: 22,
  targetLuminance: 0.58,
  targetSaturation: 0.36,
} as const;
const dryRunCommand = toneColorCommandEnvelopeV1Schema.parse({
  ...sampleToneColorCommandEnvelopeV1,
  commandId: 'command_tone_color_skin_uniformity_preview_001',
  commandType: 'toneColor.adjustSkinToneUniformity',
  correlationId: 'corr_tone_color_skin_uniformity_preview_001',
  idempotencyKey: 'idem_tone_color_skin_uniformity_preview_001',
  parameters: commandSettings,
});
const bridge = createRawEngineLocalAppServerBridge();
const rejectedApply = await createRawEngineLocalAppServerBridge().dispatch({
  ...sampleToneColorApplyCommandEnvelopeV1,
  commandId: 'command_tone_color_skin_uniformity_apply_001',
  commandType: 'toneColor.adjustSkinToneUniformity',
  correlationId: 'corr_tone_color_skin_uniformity_apply_001',
  idempotencyKey: 'idem_tone_color_skin_uniformity_apply_001',
  parameters: commandSettings,
});
if (rejectedApply.ok || rejectedApply.reason !== 'handler_failed') {
  failures.push('Skin-tone uniformity apply must be rejected before a matching dry-run.');
}
const dryRunResult = await bridge.dispatch(dryRunCommand);
if (!dryRunResult.ok) {
  failures.push(`Skin-tone uniformity dry-run failed: ${dryRunResult.message}`);
}
const parsedDryRunResult = dryRunResult.ok ? toneColorDryRunResultV1Schema.parse(dryRunResult.result) : undefined;
const applyCommand = toneColorCommandEnvelopeV1Schema.parse({
  ...sampleToneColorApplyCommandEnvelopeV1,
  commandId: 'command_tone_color_skin_uniformity_apply_001',
  commandType: 'toneColor.adjustSkinToneUniformity',
  correlationId: 'corr_tone_color_skin_uniformity_apply_001',
  idempotencyKey: 'idem_tone_color_skin_uniformity_apply_001',
  parameters: commandSettings,
});
const applyResult = await bridge.dispatch(applyCommand);
if (!applyResult.ok) {
  failures.push(`Skin-tone uniformity apply failed after matching dry-run: ${applyResult.message}`);
}
const parsedApplyResult = applyResult.ok ? toneColorMutationResultV1Schema.parse(applyResult.result) : undefined;

if (!parsedDryRunResult?.parameterDiff.some((diff) => diff.path === '/parameters/skinToneUniformity/hueUniformity')) {
  failures.push('Skin-tone uniformity dry-run must include hue uniformity diff.');
}
if (!parsedDryRunResult?.warnings.some((warning) => warning.includes('Experimental skin-tone uniformity command'))) {
  failures.push('Skin-tone uniformity dry-run must include experimental warning.');
}
if (!parsedApplyResult?.changedNodeIds.includes('tone_color_skin_uniformity:image')) {
  failures.push('Skin-tone uniformity apply must report the changed skin-tone node.');
}

for (const testCase of manifest.cases) {
  const actual = applySkinToneUniformity(testCase.input, testCase.settings);
  let maxHslDelta = 0;
  for (const field of fields) {
    const delta = Math.abs(actual[field] - testCase.expected[field]);
    maxHslDelta = Math.max(maxHslDelta, delta);
    if (delta > testCase.tolerance) {
      failures.push(`${testCase.id}.${field}: expected ${testCase.expected[field]}, got ${actual[field]}.`);
    }
  }

  let maxRgbDelta = 0;
  let outputRgb;
  if (testCase.inputRgb && testCase.expectedRgb) {
    const rgbActual = applySkinToneUniformityToRgbPixel(testCase.inputRgb, testCase.settings);
    outputRgb = rgbActual.outputRgb;
    for (const channel of ['red', 'green', 'blue']) {
      const delta = Math.abs(rgbActual.outputRgb[channel] - testCase.expectedRgb[channel]);
      maxRgbDelta = Math.max(maxRgbDelta, delta);
      if (delta > testCase.tolerance) {
        failures.push(
          `${testCase.id}.rgb.${channel}: expected ${testCase.expectedRgb[channel]}, got ${rgbActual.outputRgb[channel]}.`,
        );
      }
    }
  }
  const targetDistanceBefore = skinTargetDistance(testCase.input, testCase.settings);
  const targetDistanceAfter = skinTargetDistance(actual, testCase.settings);
  if (targetDistanceAfter > targetDistanceBefore) {
    failures.push(`${testCase.id}: uniformity moved farther from target.`);
  }
  reportCases.push({
    hueDeltaDegrees: roundMetric(actual.hueDeltaDegrees),
    id: testCase.id,
    inputRgb: testCase.inputRgb,
    maxHslDelta: roundMetric(maxHslDelta),
    maxRgbDelta: roundMetric(maxRgbDelta),
    outputRgb,
    runtimeStatus: 'apply_runtime_proof',
    targetDistanceAfter: roundMetric(targetDistanceAfter),
    targetDistanceBefore: roundMetric(targetDistanceBefore),
    uiProofStatus: 'covered_by_color_workflow_visual_smoke',
  });
}

const report = reportSchema.parse({
  cases: reportCases,
  commandProof: {
    applyCommandId: 'command_tone_color_skin_uniformity_apply_001',
    changedNodeId: 'tone_color_skin_uniformity:image',
    commandType: 'toneColor.adjustSkinToneUniformity',
    dryRunCommandId: 'command_tone_color_skin_uniformity_preview_001',
    experimental: true,
    issue: 2332,
    localAppServerBridge: 'dry_run_then_apply_required',
    maxHueShiftDegrees: commandSettings.maxHueShiftDegrees,
    runtimeStatus: 'experimental_runtime_slice',
    warnings: parsedApplyResult?.warnings ?? [],
  },
  fixturePath: FIXTURE_PATH,
  issue: 1263,
  schemaVersion: 1,
  validationMode: 'skin_tone_uniformity_runtime_and_ui_artifact',
  visualSmokeCommand: 'bun run check:color-workflow-smoke',
});
const reportText = `${JSON.stringify(report, null, 2)}\n`;
if (UPDATE_REPORT) {
  await writeFile(REPORT_PATH, reportText);
} else {
  const expectedReport = reportSchema.parse(JSON.parse(await readFile(REPORT_PATH, 'utf8')));
  if (JSON.stringify(expectedReport) !== JSON.stringify(report)) {
    failures.push(`${REPORT_PATH} is stale; run bun tests/integration/checks/check-skin-tone-uniformity.ts --update`);
  }
}

if (failures.length > 0) {
  console.error('Skin-tone uniformity validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Validated ${manifest.cases.length} skin-tone uniformity fixture cases.`);

function skinTargetDistance(
  input: { hueDegrees: number; luminance: number; saturation: number },
  settings: {
    targetHueDegrees: number;
    targetLuminance: number;
    targetSaturation: number;
  },
) {
  const hueDelta = Math.abs((((settings.targetHueDegrees - input.hueDegrees + 540) % 360) - 180) / 180);
  return (
    hueDelta +
    Math.abs(settings.targetLuminance - input.luminance) +
    Math.abs(settings.targetSaturation - input.saturation)
  );
}

function roundMetric(value: number): number {
  return Number(value.toFixed(12));
}
