import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { type QaDaemonStateRecord, qaDaemonStateSchema } from './daemon-model';
import { processStartToken } from './identity';

export function qaDaemonPaths(worktree: string): { directory: string; socket: string; state: string } {
  const key = createHash('sha256').update(resolve(worktree)).digest('hex').slice(0, 16);
  const directory = resolve(worktree, '.rapidraw/qa-daemon');
  return { directory, socket: `/tmp/rapidraw-qa-${key}.sock`, state: resolve(directory, 'state.json') };
}

export async function readLiveDaemonState(worktree: string): Promise<QaDaemonStateRecord | undefined> {
  const paths = qaDaemonPaths(worktree);
  let record: QaDaemonStateRecord;
  try {
    record = qaDaemonStateSchema.parse(JSON.parse(await readFile(paths.state, 'utf8')));
  } catch {
    await rm(paths.state, { force: true });
    return undefined;
  }
  if (
    record.schemaVersion !== 1 ||
    record.worktree !== resolve(worktree) ||
    record.socketPath !== paths.socket ||
    record.processStartToken !== (await processStartToken(record.pid))
  ) {
    await Promise.all([rm(paths.state, { force: true }), rm(paths.socket, { force: true })]);
    return undefined;
  }
  return record;
}

export async function claimDaemonState(worktree: string): Promise<QaDaemonStateRecord> {
  const paths = qaDaemonPaths(worktree);
  await mkdir(dirname(paths.state), { recursive: true });
  await rm(paths.socket, { force: true });
  const token = await processStartToken(process.pid);
  if (token === undefined) throw new Error('Cannot determine QA daemon process identity.');
  const record: QaDaemonStateRecord = {
    schemaVersion: 1,
    pid: process.pid,
    worktree: resolve(worktree),
    socketPath: paths.socket,
    startedAt: new Date().toISOString(),
    processStartToken: token,
  };
  await writeFile(paths.state, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' });
  return record;
}

export async function releaseDaemonState(record: QaDaemonStateRecord): Promise<void> {
  const paths = qaDaemonPaths(record.worktree);
  let current: QaDaemonStateRecord | undefined;
  try {
    current = qaDaemonStateSchema.parse(JSON.parse(await readFile(paths.state, 'utf8')));
  } catch {
    // already removed
  }
  if (current?.pid === record.pid && current.processStartToken === record.processStartToken) {
    await rm(paths.state, { force: true });
  }
  await rm(record.socketPath, { force: true });
}
