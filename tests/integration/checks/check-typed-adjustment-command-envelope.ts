#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import { z } from 'zod';

import { toneColorCommandEnvelopeV1Schema } from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments.ts';
import {
  applyBasicToneCommandEnvelopeToAdjustments,
  buildBasicToneCommandEnvelope,
  buildBasicToneImageCommandContext,
  legacyBasicToneAdjustmentPayloadSchema,
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
    legacyAdjustmentPayload: legacyBasicToneAdjustmentPayloadSchema,
    runtimeStatus: z.literal('typed_command_envelope_compatibility_fixture'),
    schemaVersion: z.literal(1),
  })
  .strict();

const fixture = fixtureSchema.parse(
  JSON.parse(readFileSync('fixtures/validation/compatibility/basic-tone-command-envelope-compatibility.json', 'utf8')),
);
const command = buildBasicToneCommandEnvelope(
  fixture.legacyAdjustmentPayload,
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
  failures.push('Command parameters do not match the compatibility fixture.');
}
if (replayedAdjustments.exposure !== fixture.legacyAdjustmentPayload.exposure) {
  failures.push('Replay did not preserve exposure.');
}
if (replayedAdjustments.blacks !== fixture.legacyAdjustmentPayload.blacks) {
  failures.push('Replay did not preserve black point.');
}
if (replayedAdjustments.brightness !== INITIAL_ADJUSTMENTS.brightness) {
  failures.push('Replay changed brightness even though Basic Tone V1 does not command it yet.');
}

const invalidLegacyPayload = legacyBasicToneAdjustmentPayloadSchema.safeParse({
  ...fixture.legacyAdjustmentPayload,
  exposure: 15,
});
if (invalidLegacyPayload.success) {
  failures.push('Legacy payload compatibility schema accepted out-of-range exposure.');
}

if (failures.length > 0) {
  console.error('Typed adjustment command envelope validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('typed adjustment command envelope ok (legacy payload -> command -> replay)');
