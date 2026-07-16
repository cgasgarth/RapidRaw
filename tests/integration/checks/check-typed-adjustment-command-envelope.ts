#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import { z } from 'zod';

import { toneColorCommandEnvelopeV1Schema } from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments.ts';
import {
  applyBasicToneCommandEnvelopeToAdjustments,
  basicToneAdjustmentPayloadSchema,
  buildBasicToneCommandEnvelope,
  buildBasicToneImageCommandContext,
} from '../../../src/utils/basicToneCommandBridge.ts';

const fixtureSchema = z
  .object({
    expectedCommandParameters: z
      .object({
        blackPoint: z.number(),
        clarity: z.number(),
        contrast: z.number(),
        exposureEv: z.number(),
        highlights: z.number(),
        saturation: z.number(),
        shadows: z.number(),
        whitePoint: z.number(),
      })
      .strict(),
    issue: z.literal(2321),
    basicToneAdjustmentPayload: basicToneAdjustmentPayloadSchema,
    runtimeStatus: z.literal('typed_command_envelope_fixture'),
    schemaVersion: z.literal(1),
  })
  .strict();

const fixture = fixtureSchema.parse(
  JSON.parse(readFileSync('fixtures/validation/command-envelope/basic-tone-command-envelope.json', 'utf8')),
);
const command = buildBasicToneCommandEnvelope(
  fixture.basicToneAdjustmentPayload,
  buildBasicToneImageCommandContext({
    expectedGraphRevision: 'history_2321',
    imagePath: '/validation/typed-adjustment-envelope.CR3',
    operationId: 'issue_2321_typed_adjustment_envelope',
    sessionId: 'typed-adjustment-envelope-check',
  }),
  {
    acceptedDryRunPlanHash: 'sha256:basic-tone:typed-adjustment-envelope',
    acceptedDryRunPlanId: 'dryrun_basic_tone_typed_adjustment_envelope',
    dryRun: false,
  },
);
const parsedCommand = toneColorCommandEnvelopeV1Schema.parse(command);
const replayedAdjustments = applyBasicToneCommandEnvelopeToAdjustments(INITIAL_ADJUSTMENTS, parsedCommand);
const failures = [];

const replayParameterKeys = [
  'blackPoint',
  'clarity',
  'contrast',
  'exposureEv',
  'highlights',
  'saturation',
  'shadows',
  'whitePoint',
] as const;
const replayParameters = Object.fromEntries(replayParameterKeys.map((key) => [key, parsedCommand.parameters[key]]));
if (JSON.stringify(replayParameters) !== JSON.stringify(fixture.expectedCommandParameters)) {
  failures.push('Command parameters do not match the current fixture.');
}
if (replayedAdjustments.exposure !== fixture.basicToneAdjustmentPayload.exposure) {
  failures.push('Replay did not preserve exposure.');
}
if (replayedAdjustments.blacks !== fixture.basicToneAdjustmentPayload.blacks) {
  failures.push('Replay did not preserve black point.');
}
if (replayedAdjustments.brightness !== INITIAL_ADJUSTMENTS.brightness) {
  failures.push('Replay changed brightness even though Basic Tone V1 does not command it yet.');
}

const invalidBasicTonePayload = basicToneAdjustmentPayloadSchema.safeParse({
  ...fixture.basicToneAdjustmentPayload,
  exposure: 15,
});
if (invalidBasicTonePayload.success) {
  failures.push('Basic Tone payload schema accepted out-of-range exposure.');
}

if (failures.length > 0) {
  console.error('Typed adjustment command envelope validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('typed adjustment command envelope ok (basic tone payload -> command -> replay)');
