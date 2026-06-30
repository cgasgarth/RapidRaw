#!/usr/bin/env bun

import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { z } from 'zod';

import {
  type NegativeLabCommandEnvelopeV1,
  type NegativeRollSessionV1,
  negativeLabCommandEnvelopeV1Schema,
  negativeRollSessionV1Schema,
} from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import {
  sampleNegativeLabApplyFrameCropCommandEnvelopeV1,
  sampleNegativeLabCommandEnvelopeV1,
  sampleNegativeRollSessionV1,
} from '../../../packages/rawengine-schema/src/samplePayloads.ts';

const persistedSessionSchema = z
  .object({
    persistedAt: z.string().datetime(),
    sidecarContentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    session: negativeRollSessionV1Schema,
  })
  .strict();

const hashText = (value: string) => new Bun.CryptoHasher('sha256').update(value).digest('hex');

const stableSessionPayload = (session: NegativeRollSessionV1) => `${JSON.stringify(session, null, 2)}\n`;
const uniqueIds = (ids: Array<string>) => [...new Set(ids)].sort((a, b) => a.localeCompare(b));

const assertEqual = (actual: unknown, expected: unknown, label: string) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} changed after reload.`);
  }
};

const session = replayCommands(negativeRollSessionV1Schema.parse(sampleNegativeRollSessionV1), [
  sampleNegativeLabCommandEnvelopeV1,
  sampleNegativeLabApplyFrameCropCommandEnvelopeV1,
]);
const tempDir = await mkdtemp(join(tmpdir(), 'rawengine-negative-session-'));
const sidecarPath = join(tempDir, 'negative-roll-session.rawengine.json');
const sessionPayload = stableSessionPayload(session);
const persistedPayload = {
  persistedAt: '2026-06-18T00:00:00.000Z',
  session,
  sidecarContentHash: `sha256:${hashText(sessionPayload)}`,
};

await writeFile(sidecarPath, `${JSON.stringify(persistedPayload, null, 2)}\n`);

const reloaded = persistedSessionSchema.parse(JSON.parse(await readFile(sidecarPath, 'utf8')));
const reloadedSessionPayload = stableSessionPayload(reloaded.session);

if (reloaded.sidecarContentHash !== `sha256:${hashText(reloadedSessionPayload)}`) {
  throw new Error('Negative Lab session sidecar hash did not match reloaded session content.');
}

assertEqual(
  reloaded.session.frameRecords.map((frame) => frame.frameId),
  session.frameRecords.map((frame) => frame.frameId),
  'frame order',
);
assertEqual(
  reloaded.session.frameRecords.map((frame) => frame.contentHash),
  session.frameRecords.map((frame) => frame.contentHash),
  'frame source hashes',
);
assertEqual(reloaded.session.sourceFileIds, session.sourceFileIds, 'source file ids');
assertEqual(reloaded.session.provenanceEntryIds, session.provenanceEntryIds, 'provenance entry ids');
assertEqual(reloaded.session.rollDefaultCommandIds, session.rollDefaultCommandIds, 'roll default commands');
assertEqual(reloaded.session.perFrameOverrideIds, session.perFrameOverrideIds, 'per-frame overrides');
assertEqual(reloaded.session.sharedBaseSampleIds, session.sharedBaseSampleIds, 'shared base samples');
assertEqual(reloaded.session.qcStatus, session.qcStatus, 'session QC status');

const [firstFrame] = reloaded.session.frameRecords;
if (
  firstFrame === undefined ||
  firstFrame.positiveVariantIds.length !== 0 ||
  !firstFrame.conversionCommandIds.includes(sampleNegativeLabCommandEnvelopeV1.commandId) ||
  firstFrame.crop?.x !== 128
) {
  throw new Error('Reload proof must preserve replayed conversion and crop state before positive/export mutation.');
}

if (
  !reloaded.session.rollDefaultCommandIds.includes(sampleNegativeLabCommandEnvelopeV1.commandId) ||
  !reloaded.session.perFrameOverrideIds.includes(sampleNegativeLabApplyFrameCropCommandEnvelopeV1.commandId) ||
  !reloaded.session.sharedBaseSampleIds.includes('base_sample_roll_01')
) {
  throw new Error('Reload proof must preserve roll defaults, per-frame overrides, and shared base samples.');
}

console.log(`negative lab roll session reload ok (${reloaded.session.frameRecords.length} frames)`);

function replayCommands(
  initialSession: NegativeRollSessionV1,
  commands: ReadonlyArray<NegativeLabCommandEnvelopeV1>,
): NegativeRollSessionV1 {
  return negativeRollSessionV1Schema.parse(
    commands.reduce((session, commandValue) => replayCommand(session, commandValue), initialSession),
  );
}

function replayCommand(
  session: NegativeRollSessionV1,
  commandValue: NegativeLabCommandEnvelopeV1,
): NegativeRollSessionV1 {
  const command = negativeLabCommandEnvelopeV1Schema.parse(commandValue);
  if (command.target.id !== session.sessionId) {
    throw new Error(`${command.commandId}: command target does not match session.`);
  }

  if (command.commandType === 'negativeLab.setConversionRecipe') {
    const selectedFrameIds =
      command.parameters.frameSelection.mode === 'selected'
        ? command.parameters.frameSelection.frameIds
        : session.frameRecords.map((frame) => frame.frameId);
    const sharedBaseSampleIds = uniqueIds([
      ...session.sharedBaseSampleIds,
      ...command.parameters.baseStrategy.baseSampleIds,
      ...command.parameters.neutralization.sampleIds,
    ]);

    return {
      ...session,
      conversionWarnings: uniqueWarnings([...session.conversionWarnings]),
      frameRecords: session.frameRecords.map((frame) =>
        selectedFrameIds.includes(frame.frameId)
          ? {
              ...frame,
              baseSampleIds: uniqueIds([...frame.baseSampleIds, ...command.parameters.baseStrategy.baseSampleIds]),
              conversionCommandIds: uniqueIds([...frame.conversionCommandIds, command.commandId]),
            }
          : frame,
      ),
      rollDefaultCommandIds: uniqueIds([...session.rollDefaultCommandIds, command.commandId]),
      sharedBaseSampleIds,
    };
  }

  if (command.commandType === 'negativeLab.applyFrameCrop') {
    return {
      ...session,
      frameRecords: session.frameRecords.map((frame) => {
        const edit = command.parameters.cropEdits.find((candidate) => candidate.frameId === frame.frameId);
        if (edit === undefined) return frame;
        return {
          ...frame,
          borderState: edit.borderState,
          crop: edit.crop,
          warningCodes: uniqueIds([...frame.warningCodes, ...edit.warningCodes]),
        };
      }),
      perFrameOverrideIds: uniqueIds([...session.perFrameOverrideIds, command.commandId]),
    };
  }

  throw new Error(`${command.commandId}: replay proof does not implement ${command.commandType}.`);
}

function uniqueWarnings(
  warnings: NegativeRollSessionV1['conversionWarnings'],
): NegativeRollSessionV1['conversionWarnings'] {
  const warningsByKey = new Map(warnings.map((warning) => [`${warning.code}:${warning.message}`, warning]));
  return [...warningsByKey.values()];
}
