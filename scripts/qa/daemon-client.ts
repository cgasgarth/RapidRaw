import { connect } from 'node:net';
import { resolve } from 'node:path';
import {
  type QaDaemonRequest,
  type QaDaemonResponse,
  type QaDaemonStateRecord,
  qaDaemonResponseSchema,
} from './daemon-model';
import { qaDaemonPaths, readLiveDaemonState } from './daemon-state';

async function send(socketPath: string, request: QaDaemonRequest): Promise<QaDaemonResponse> {
  return await new Promise<QaDaemonResponse>((resolveResponse, reject) => {
    const socket = connect(socketPath);
    let buffer = '';
    socket.setEncoding('utf8');
    socket.setTimeout(30 * 60_000, () => socket.destroy(new Error('QA daemon request timed out.')));
    socket.once('connect', () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on('data', (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      socket.end();
      try {
        resolveResponse(qaDaemonResponseSchema.parse(JSON.parse(buffer.slice(0, newline))));
      } catch (error) {
        reject(error);
      }
    });
    socket.once('error', reject);
  });
}

const STARTUP_ATTEMPTS = 900;
const POLL_INTERVAL_MS = 50;

export interface QaDaemonLease {
  state: QaDaemonStateRecord;
  startedByCaller: boolean;
}

function sameDaemon(left: QaDaemonStateRecord, right: QaDaemonStateRecord): boolean {
  return left.pid === right.pid && left.processStartToken === right.processStartToken;
}

export function qaDaemonLeaseForState(state: QaDaemonStateRecord, spawnedPid?: number): QaDaemonLease {
  return { state, startedByCaller: spawnedPid === state.pid };
}

async function ensureQaDaemonLease(worktree: string): Promise<QaDaemonLease> {
  const absolute = resolve(worktree);
  const socket = qaDaemonPaths(absolute).socket;
  let child: ReturnType<typeof Bun.spawn> | undefined;
  let childStdout: Promise<string> | undefined;
  let childStderr: Promise<string> | undefined;
  for (let attempt = 0; attempt < STARTUP_ATTEMPTS; attempt += 1) {
    const state = await readLiveDaemonState(absolute);
    if (state?.socketPath === socket) {
      try {
        const response = await send(socket, { id: crypto.randomUUID(), method: 'health' });
        if (response.ok) {
          const lease = qaDaemonLeaseForState(state, child?.pid);
          if (!lease.startedByCaller && child?.exitCode === null) child.kill('SIGTERM');
          return lease;
        }
      } catch {
        // Socket publication/listen or shutdown can race briefly.
      }
    } else if (child === undefined) {
      child = Bun.spawn(['bun', 'scripts/qa/daemon.ts', '--worktree', absolute], {
        cwd: absolute,
        detached: true,
        env: process.env,
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      });
      childStdout = new Response(child.stdout).text();
      childStderr = new Response(child.stderr).text();
      child.unref();
    }
    if (child?.exitCode !== null && child?.exitCode !== undefined) {
      const [stdout, stderr] = await Promise.all([childStdout, childStderr]);
      const detail = `${stdout ?? ''}\n${stderr ?? ''}`.trim().slice(-4_000);
      throw new Error(`QA daemon exited during startup (${child.exitCode}).${detail === '' ? '' : `\n${detail}`}`);
    }
    await Bun.sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`QA daemon did not become ready within ${(STARTUP_ATTEMPTS * POLL_INTERVAL_MS) / 1_000}s.`);
}

export async function ensureQaDaemon(worktree: string): Promise<string> {
  return (await ensureQaDaemonLease(worktree)).state.socketPath;
}

export async function acquireQaDaemon(worktree: string): Promise<QaDaemonLease> {
  return await ensureQaDaemonLease(worktree);
}

export async function shutdownQaDaemonLease(worktree: string, lease: QaDaemonLease): Promise<void> {
  if (!lease.startedByCaller) return;
  const absolute = resolve(worktree);
  const current = await readLiveDaemonState(absolute);
  if (current === undefined || !sameDaemon(current, lease.state)) return;
  const response = await send(current.socketPath, { id: crypto.randomUUID(), method: 'shutdown' });
  if (!response.ok) throw new Error(response.error ?? 'Persistent QA daemon shutdown failed.');
  for (let attempt = 0; attempt < STARTUP_ATTEMPTS; attempt += 1) {
    const remaining = await readLiveDaemonState(absolute);
    if (remaining === undefined || !sameDaemon(remaining, lease.state)) return;
    await Bun.sleep(POLL_INTERVAL_MS);
  }
  throw new Error('Persistent QA daemon ownership did not clear within 45s after shutdown.');
}

export async function requestQaDaemon(worktree: string, request: QaDaemonRequest): Promise<QaDaemonResponse> {
  const socket = await ensureQaDaemon(worktree);
  return await send(socket, request);
}
