#!/usr/bin/env bun

import { chmod } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { createBrowserLifecycleAdapter } from './browser-session';
import { QaDaemonEngine } from './daemon-engine';
import { type QaDaemonRequest, type QaDaemonResponse, qaDaemonRequestSchema } from './daemon-model';
import { claimDaemonState, readLiveDaemonState, releaseDaemonState } from './daemon-state';

const args = process.argv.slice(2);
const worktree = resolve(args[args.indexOf('--worktree') + 1] ?? process.cwd());
const existing = await readLiveDaemonState(worktree);
if (existing !== undefined) throw new Error(`QA daemon is already live at PID ${existing.pid}.`);
const state = await claimDaemonState(worktree);
const engine = new QaDaemonEngine(
  worktree,
  createBrowserLifecycleAdapter(resolve(worktree, 'private-artifacts/qa/daemon')),
);
let closing = false;
let forcedShutdownTimer: ReturnType<typeof setTimeout> | undefined;
const server = createServer((socket) => {
  socket.setEncoding('utf8');
  let buffer = '';
  let runningJob = false;
  let completed = false;
  socket.once('close', () => {
    if (runningJob && !completed) engine.cancel();
  });
  socket.on('data', (chunk) => {
    buffer += chunk;
    if (buffer.length > 1_000_000) socket.destroy(new Error('QA daemon request is too large.'));
    const newline = buffer.indexOf('\n');
    if (newline < 0) return;
    socket.pause();
    void (async () => {
      let request: QaDaemonRequest | undefined;
      let response: QaDaemonResponse;
      try {
        request = qaDaemonRequestSchema.parse(JSON.parse(buffer.slice(0, newline)));
        if (request.method === 'health') {
          response = { id: request.id, ok: true, result: { pid: process.pid, worktree, metrics: engine.metrics } };
        } else if (request.method === 'shutdown') {
          response = { id: request.id, ok: true, result: { shuttingDown: true } };
          closing = true;
          engine.cancel();
        } else if (request.method === 'run') {
          runningJob = true;
          const result = await engine.run(request.identity, {
            scenarioIds: request.scenarioIds,
            shard: request.shard,
          });
          response = { id: request.id, ok: true, result: { ...result, metrics: { ...engine.metrics } } };
        } else {
          throw new Error('Unknown QA daemon method.');
        }
      } catch (error) {
        response = {
          id: request?.id ?? 'invalid',
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
      completed = true;
      socket.end(`${JSON.stringify(response)}\n`, () => {
        socket.destroy();
        if (closing) server.close();
      });
    })();
  });
});

const shutdown = async () => {
  if (closing) return;
  closing = true;
  engine.cancel();
  server.close();
  // A signal can arrive while Bun still owns an accepted socket or a browser
  // adapter is unwinding. Do not leave the ownership record behind forever.
  forcedShutdownTimer = setTimeout(() => {
    void releaseDaemonState(state).finally(() => process.exit(0));
  }, 5_000);
  forcedShutdownTimer.unref();
};
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.once(signal, () => void shutdown());

try {
  await new Promise<void>((ready, reject) => {
    server.once('error', reject);
    server.listen(state.socketPath, () => ready());
  });
  await chmod(state.socketPath, 0o600);
  await new Promise<void>((done) => server.once('close', () => done()));
} finally {
  if (forcedShutdownTimer !== undefined) clearTimeout(forcedShutdownTimer);
  await engine.close();
  await releaseDaemonState(state);
}
