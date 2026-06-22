#!/usr/bin/env bun

import { z } from 'zod';

import { buildRawEngineAppServerHostResponseEnvelopeAsync } from '../../src/utils/rawEngineAppServerHost.ts';

const clientInfoSchema = z
  .object({
    name: z.string().trim().min(1),
    title: z.string().trim().min(1),
    version: z.string().trim().min(1),
  })
  .strict();

const initializeMessageSchema = z
  .object({
    id: z.number().int().positive(),
    method: z.literal('initialize'),
    params: z
      .object({
        clientInfo: clientInfoSchema,
      })
      .strict(),
  })
  .strict();

const initializedMessageSchema = z
  .object({
    method: z.literal('initialized'),
    params: z.object({}).strict(),
  })
  .strict();

const input = await Bun.stdin.text();
const lines = input
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line.length > 0);

const initializeLine = lines[0];
const initializedLine = lines[1];

if (initializeLine === undefined || initializedLine === undefined) {
  console.error('fixture expected initialize and initialized messages');
  process.exit(1);
}

const initializeMessage = initializeMessageSchema.parse(JSON.parse(initializeLine));
initializedMessageSchema.parse(JSON.parse(initializedLine));

console.log(
  JSON.stringify({
    id: initializeMessage.id,
    result: {
      protocol: 'codex_app_server',
      ready: true,
      transport: 'stdio_jsonl',
    },
  }),
);
console.log(
  JSON.stringify({
    method: 'thread/started',
    params: {
      thread: {
        id: 'rawengine_fixture_thread',
      },
    },
  }),
);

for (const requestLine of lines.slice(2)) {
  console.log(JSON.stringify(await buildRawEngineAppServerHostResponseEnvelopeAsync(JSON.parse(requestLine))));
}
