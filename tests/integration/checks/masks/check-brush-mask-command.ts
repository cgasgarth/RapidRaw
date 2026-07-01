#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { z } from 'zod';

import {
  type BrushBaseMaskArtifact,
  BrushMaskCommandRuntime,
  renderBrushMask,
} from '../../../../packages/rawengine-schema/src/brushMaskCommandRuntime.ts';
import {
  ActorKind,
  ApprovalClass,
  layerMaskCommandEnvelopeV1Schema,
  layerMaskDryRunResultV1Schema,
  layerMaskMutationResultV1Schema,
  RAW_ENGINE_SCHEMA_VERSION,
} from '../../../../packages/rawengine-schema/src/rawEngineSchemas.ts';

const fixtureSchema = z
  .object({
    baseAlpha: z.array(z.number().min(0).max(1)).min(1),
    expectedEraseAlpha: z.array(z.number().min(0).max(1)).min(1),
    expectedPaintAlpha: z.array(z.number().min(0).max(1)).min(1),
    height: z.number().int().positive(),
    width: z.number().int().positive(),
  })
  .strict();

const fixture = fixtureSchema.parse(
  JSON.parse(readFileSync(resolve('fixtures/masks/brush/brush-mask-command.json'), 'utf8')),
);

const baseMask: BrushBaseMaskArtifact = {
  alpha: fixture.baseAlpha,
  height: fixture.height,
  maskId: 'mask_brush_base',
  width: fixture.width,
};

const buildCommand = (mode: 'paint' | 'erase', dryRun: boolean) =>
  layerMaskCommandEnvelopeV1Schema.parse({
    actor: {
      id: 'codex-app-server',
      kind: ActorKind.Agent,
      sessionId: 'session_brush_mask_command',
    },
    approval: {
      approvalClass: dryRun ? ApprovalClass.PreviewOnly : ApprovalClass.EditApply,
      reason: dryRun ? 'Preview brush stroke alpha before mutating the edit graph.' : 'Apply the accepted brush mask.',
      state: dryRun ? 'not_required' : 'approved',
    },
    commandId: dryRun ? `command_brush_mask_${mode}_preview` : `command_brush_mask_${mode}_apply`,
    commandType: 'layerMask.createBrushMask',
    correlationId: `corr_brush_mask_${mode}`,
    dryRun,
    expectedGraphRevision: 'graph_rev_brush_mask_source',
    idempotencyKey: dryRun ? `idem_brush_mask_${mode}_preview` : `idem_brush_mask_${mode}_apply`,
    parameters: {
      baseMaskId: mode === 'erase' ? baseMask.maskId : undefined,
      maskName: `${mode} brush proof`,
      strokes: [
        {
          flow: 1,
          hardness: 1,
          mode,
          points: [
            { x: 0, y: 0.5 },
            { x: 1, y: 0.5 },
          ],
          radiusPx: 0.49,
          strokeId: `stroke_${mode}_horizontal`,
        },
      ],
    },
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    target: {
      imagePath: '/photos/session/IMG_0001.CR3',
      kind: 'image',
    },
  });

const buildPressureCommand = (dryRun: boolean, pressure: boolean) =>
  layerMaskCommandEnvelopeV1Schema.parse({
    actor: {
      id: 'codex-app-server',
      kind: ActorKind.Agent,
      sessionId: 'session_brush_mask_pressure_command',
    },
    approval: {
      approvalClass: dryRun ? ApprovalClass.PreviewOnly : ApprovalClass.EditApply,
      reason: dryRun
        ? 'Preview pressure-aware brush stroke alpha before mutating the edit graph.'
        : 'Apply the accepted pressure-aware brush mask.',
      state: dryRun ? 'not_required' : 'approved',
    },
    commandId: dryRun
      ? `command_brush_mask_pressure_${pressure ? 'pen' : 'mouse'}_preview`
      : `command_brush_mask_pressure_${pressure ? 'pen' : 'mouse'}_apply`,
    commandType: 'layerMask.createBrushMask',
    correlationId: `corr_brush_mask_pressure_${pressure ? 'pen' : 'mouse'}`,
    dryRun,
    expectedGraphRevision: 'graph_rev_brush_mask_pressure_source',
    idempotencyKey: dryRun
      ? `idem_brush_mask_pressure_${pressure ? 'pen' : 'mouse'}_preview`
      : `idem_brush_mask_pressure_${pressure ? 'pen' : 'mouse'}_apply`,
    parameters: {
      maskName: `pressure ${pressure ? 'pen' : 'mouse'} brush proof`,
      strokes: [
        {
          flow: 1,
          hardness: 1,
          mode: 'paint',
          points: pressure
            ? [
                { pressure: 0.25, x: 0, y: 0.5 },
                { pressure: 0.5, x: 1, y: 0.5 },
              ]
            : [
                { x: 0, y: 0.5 },
                { x: 1, y: 0.5 },
              ],
          radiusPx: 0.49,
          strokeId: `stroke_pressure_${pressure ? 'pen' : 'mouse'}_horizontal`,
        },
      ],
    },
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    target: {
      imagePath: '/photos/session/IMG_0001.CR3',
      kind: 'image',
    },
  });

const failures: Array<string> = [];
const nearlyEqual = (left: number, right: number): boolean => Math.abs(left - right) <= 0.000001;
const alphaMatches = (actual: ReadonlyArray<number>, expected: ReadonlyArray<number>): boolean =>
  actual.length === expected.length &&
  actual.every((value, index) => nearlyEqual(value, expected[index] ?? Number.NaN));

for (const mode of ['paint', 'erase'] as const) {
  const dryRunCommand = buildCommand(mode, true);
  const renderRequest =
    mode === 'erase'
      ? { baseMask, command: dryRunCommand, height: fixture.height, width: fixture.width }
      : { command: dryRunCommand, height: fixture.height, width: fixture.width };
  const render = renderBrushMask(renderRequest);
  const expectedAlpha = mode === 'erase' ? fixture.expectedEraseAlpha : fixture.expectedPaintAlpha;
  if (!alphaMatches(render.alpha, expectedAlpha)) {
    failures.push(`${mode}: brush alpha does not match fixture.`);
  }
  if (!render.contentHash.startsWith('fnv1a32:')) {
    failures.push(`${mode}: brush render must produce a stable content hash.`);
  }

  const runtime = new BrushMaskCommandRuntime();
  const runtimeRequest =
    mode === 'erase'
      ? { baseMask, height: fixture.height, width: fixture.width }
      : { height: fixture.height, width: fixture.width };
  const dryRunResult = layerMaskDryRunResultV1Schema.parse(runtime.dispatch(dryRunCommand, runtimeRequest));
  if (dryRunResult.mutates || dryRunResult.maskArtifacts[0]?.contentHash !== render.contentHash) {
    failures.push(`${mode}: dry-run must be non-mutating and expose the rendered brush mask artifact.`);
  }

  const applyResult = layerMaskMutationResultV1Schema.parse(
    runtime.dispatch(buildCommand(mode, false), runtimeRequest),
  );
  if (!applyResult.mutates || applyResult.changedMaskIds[0] !== render.maskId) {
    failures.push(`${mode}: apply must mutate the accepted brush mask id.`);
  }
  if (applyResult.maskArtifacts?.[0]?.contentHash !== render.contentHash) {
    failures.push(`${mode}: apply must expose the same mask content hash as dry-run/render.`);
  }
  if (applyResult.maskProvenance?.contentHash !== render.contentHash) {
    failures.push(`${mode}: apply must preserve deterministic mask provenance.`);
  }
}

const mousePressureCommand = buildPressureCommand(true, false);
const penPressureCommand = buildPressureCommand(true, true);
const mousePressureRender = renderBrushMask({
  command: mousePressureCommand,
  height: fixture.height,
  width: fixture.width,
});
const penPressureRender = renderBrushMask({
  command: penPressureCommand,
  height: fixture.height,
  width: fixture.width,
});

if (mousePressureRender.contentHash === penPressureRender.contentHash) {
  failures.push(
    'Pressure-aware brush replay must change the rendered mask hash versus the same stroke without pressure.',
  );
}
if (penPressureRender.coverageSum >= mousePressureRender.coverageSum) {
  failures.push('Lower pen pressure should reduce deterministic brush coverage.');
}
if (!penPressureRender.provenance.pressureUsed || penPressureRender.provenance.pressurePointCount !== 2) {
  failures.push('Pressure-aware brush replay must record pressure provenance.');
}
if (mousePressureRender.provenance.pressureUsed || mousePressureRender.provenance.pressurePointCount !== 0) {
  failures.push('Mouse brush replay must not record synthetic pressure provenance.');
}

const pressureRuntime = new BrushMaskCommandRuntime();
const pressureDryRun = layerMaskDryRunResultV1Schema.parse(
  pressureRuntime.dispatch(penPressureCommand, { height: fixture.height, width: fixture.width }),
);
const pressureApply = layerMaskMutationResultV1Schema.parse(
  pressureRuntime.dispatch(buildPressureCommand(false, true), { height: fixture.height, width: fixture.width }),
);
if (pressureDryRun.maskArtifacts[0]?.contentHash !== pressureApply.maskArtifacts?.[0]?.contentHash) {
  failures.push('Pressure dry-run/apply replay must expose matching mask content hashes.');
}
if (pressureApply.maskProvenance?.coverageSum !== penPressureRender.coverageSum) {
  failures.push('Pressure apply provenance must preserve deterministic coverage sum.');
}

try {
  new BrushMaskCommandRuntime().dispatch(buildCommand('paint', false), {
    height: fixture.height,
    width: fixture.width,
  });
  failures.push('Brush apply should fail before matching dry-run.');
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes('matching dry-run')) {
    failures.push('Brush apply rejection should explain missing matching dry-run.');
  }
}

try {
  renderBrushMask({ command: buildCommand('erase', true), height: fixture.height, width: fixture.width });
  failures.push('Brush erase with baseMaskId should require matching base mask.');
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes('matching baseMask')) {
    failures.push('Brush base rejection should explain missing base mask.');
  }
}

if (failures.length > 0) {
  console.error('Brush mask command validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`brush mask command ok (${fixture.width}x${fixture.height}, paint+erase)`);
