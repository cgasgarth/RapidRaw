#!/usr/bin/env bun

import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { z } from 'zod';

import {
  negativeRollSessionV1Schema,
  type NegativeRollSessionV1,
} from '../packages/rawengine-schema/src/rawEngineSchemas.ts';
import { sampleNegativeRollSessionV1 } from '../packages/rawengine-schema/src/samplePayloads.ts';

const persistedSessionSchema = z
  .object({
    persistedAt: z.string().datetime(),
    sidecarContentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    session: negativeRollSessionV1Schema,
  })
  .strict();

const hashText = (value: string) => new Bun.CryptoHasher('sha256').update(value).digest('hex');

const stableSessionPayload = (session: NegativeRollSessionV1) => `${JSON.stringify(session, null, 2)}\n`;

const assertEqual = (actual: unknown, expected: unknown, label: string) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} changed after reload.`);
  }
};

const session = negativeRollSessionV1Schema.parse(sampleNegativeRollSessionV1);
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
  firstFrame.conversionCommandIds.length !== 0
) {
  throw new Error('Reload proof must preserve non-destructive state before positive/export mutation.');
}

console.log(`negative lab roll session reload ok (${reloaded.session.frameRecords.length} frames)`);
