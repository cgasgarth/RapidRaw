import { connect } from 'node:net';
import { resolve } from 'node:path';
import { type QaDaemonRequest, type QaDaemonResponse, qaDaemonResponseSchema } from './daemon-model';
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

export async function ensureQaDaemon(worktree: string): Promise<string> {
  const absolute = resolve(worktree);
  const socket = qaDaemonPaths(absolute).socket;
  let child: ReturnType<typeof Bun.spawn> | undefined;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const state = await readLiveDaemonState(absolute);
    if (state?.socketPath === socket) {
      try {
        const response = await send(socket, { id: crypto.randomUUID(), method: 'health' });
        if (response.ok) return socket;
      } catch {
        // Socket publication/listen or shutdown can race briefly.
      }
    } else if (child === undefined) {
      child = Bun.spawn(['bun', 'scripts/qa/daemon.ts', '--worktree', absolute], {
        cwd: absolute,
        detached: true,
        env: process.env,
        stdin: 'ignore',
        stdout: 'ignore',
        stderr: 'ignore',
      });
      child.unref();
    }
    if (child?.exitCode !== null && child?.exitCode !== undefined) {
      throw new Error(`QA daemon exited during startup (${child.exitCode}).`);
    }
    await Bun.sleep(50);
  }
  throw new Error('QA daemon did not become ready.');
}

export async function requestQaDaemon(worktree: string, request: QaDaemonRequest): Promise<QaDaemonResponse> {
  const socket = await ensureQaDaemon(worktree);
  return await send(socket, request);
}
