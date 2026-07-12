import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

interface LeaseOwner {
  hostname: string;
  label: string;
  pid: number;
  startedAt: string;
  worktree: string;
}

export interface ResourceLeaseOptions {
  label: string;
  resource: string;
  timeoutMs?: number;
  pollMs?: number;
}

const compactOwner = (owner: LeaseOwner | null): string =>
  owner
    ? `${owner.label} pid=${owner.pid} worktree=${owner.worktree} since=${owner.startedAt}`
    : 'owner metadata unavailable';

const processIsAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const coordinatorRoot = (): string => {
  const override = Bun.env.RAWENGINE_RESOURCE_COORDINATOR_ROOT;
  if (override) return resolve(override);
  const result = Bun.spawnSync(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'], {
    stderr: 'pipe',
    stdout: 'pipe',
  });
  if (result.exitCode !== 0) throw new Error('resource coordinator requires a git worktree');
  const commonDirectory = result.stdout.toString().trim();
  return join(isAbsolute(commonDirectory) ? commonDirectory : resolve(commonDirectory), 'rapidraw-resource-locks');
};

const readOwner = async (path: string): Promise<LeaseOwner | null> => {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as LeaseOwner;
  } catch {
    return null;
  }
};

export async function acquireResourceLease(options: ResourceLeaseOptions): Promise<() => Promise<void>> {
  const timeoutMs = options.timeoutMs ?? Number(Bun.env.RAWENGINE_RESOURCE_WAIT_TIMEOUT_MS ?? 30 * 60_000);
  const pollMs = options.pollMs ?? Number(Bun.env.RAWENGINE_RESOURCE_WAIT_POLL_MS ?? 250);
  const root = coordinatorRoot();
  const lockDirectory = join(root, options.resource);
  const ownerPath = join(lockDirectory, 'owner.json');
  await mkdir(root, { recursive: true });
  const waitStartedAt = Date.now();
  let lastDiagnosticAt = 0;

  while (true) {
    try {
      await mkdir(lockDirectory);
      const owner: LeaseOwner = {
        hostname: hostname(),
        label: options.label,
        pid: process.pid,
        startedAt: new Date().toISOString(),
        worktree: process.cwd(),
      };
      await writeFile(ownerPath, `${JSON.stringify(owner)}\n`, 'utf8');
      const waitedMs = Date.now() - waitStartedAt;
      if (waitedMs >= pollMs) console.log(`${options.label} acquired ${options.resource} after ${waitedMs}ms`);
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        const current = await readOwner(ownerPath);
        if (current?.pid === process.pid) await rm(lockDirectory, { recursive: true, force: true });
      };
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? error.code : undefined;
      if (code !== 'EEXIST') throw error;
      const owner = await readOwner(ownerPath);
      if (owner && owner.hostname === hostname() && !processIsAlive(owner.pid)) {
        await rm(lockDirectory, { recursive: true, force: true });
        console.log(`${options.label} recovered stale ${options.resource}: ${compactOwner(owner)}`);
        continue;
      }
      const waitedMs = Date.now() - waitStartedAt;
      if (waitedMs >= timeoutMs) {
        throw new Error(
          `${options.label} timed out waiting ${waitedMs}ms for ${options.resource}: ${compactOwner(owner)}`,
        );
      }
      if (lastDiagnosticAt === 0 || waitedMs - lastDiagnosticAt >= 15_000) {
        console.log(`${options.label} waiting for ${options.resource}: ${compactOwner(owner)}`);
        lastDiagnosticAt = waitedMs;
      }
      await Bun.sleep(pollMs);
    }
  }
}

export async function withResourceLease<T>(options: ResourceLeaseOptions, operation: () => Promise<T>): Promise<T> {
  const release = await acquireResourceLease(options);
  try {
    return await operation();
  } finally {
    await release();
  }
}
