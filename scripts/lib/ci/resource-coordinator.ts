import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
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
  root?: string;
}

export interface ResourceLease {
  release: () => Promise<void>;
  updateOwnerPid: (pid: number) => Promise<void>;
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

const coordinatorRoot = (explicitRoot?: string): string => {
  const override = explicitRoot ?? Bun.env.RAWENGINE_RESOURCE_COORDINATOR_ROOT;
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

const replaceFile = async (path: string, contents: string): Promise<void> => {
  const candidate = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(candidate, contents, 'utf8');
  await rename(candidate, path);
};

export async function acquireResourceLease(options: ResourceLeaseOptions): Promise<ResourceLease> {
  const timeoutMs = options.timeoutMs ?? Number(Bun.env.RAWENGINE_RESOURCE_WAIT_TIMEOUT_MS ?? 30 * 60_000);
  const pollMs = options.pollMs ?? Number(Bun.env.RAWENGINE_RESOURCE_WAIT_POLL_MS ?? 250);
  const root = coordinatorRoot(options.root);
  const lockPath = join(root, `${options.resource}.lock`);
  const ownerPath = join(root, `${options.resource}.owner.json`);
  await mkdir(root, { recursive: true });
  const waitStartedAt = Date.now();
  let lastDiagnosticAt = 0;

  while (true) {
    try {
      const priorOwner = await readOwner(ownerPath);
      const result = Bun.spawnSync(['/usr/bin/shlock', '-p', String(process.pid), '-f', lockPath], {
        stderr: 'pipe',
        stdout: 'pipe',
      });
      if (result.exitCode !== 0) throw Object.assign(new Error('resource_busy'), { code: 'EEXIST' });
      if (priorOwner && !processIsAlive(priorOwner.pid)) {
        console.log(`${options.label} recovered stale ${options.resource}: ${compactOwner(priorOwner)}`);
      }
      let owner: LeaseOwner = {
        hostname: hostname(),
        label: options.label,
        pid: process.pid,
        startedAt: new Date().toISOString(),
        worktree: process.cwd(),
      };
      await replaceFile(ownerPath, `${JSON.stringify(owner)}\n`);
      const waitedMs = Date.now() - waitStartedAt;
      if (waitedMs >= pollMs) console.log(`${options.label} acquired ${options.resource} after ${waitedMs}ms`);
      let released = false;
      return {
        release: async () => {
          if (released) return;
          released = true;
          const currentPid = Number((await readFile(lockPath, 'utf8').catch(() => '')).trim());
          if (currentPid === owner.pid) {
            await rm(ownerPath, { force: true });
            await rm(lockPath, { force: true });
          }
        },
        updateOwnerPid: async (pid: number) => {
          owner = { ...owner, pid };
          await replaceFile(lockPath, `${pid}\n`);
          await replaceFile(ownerPath, `${JSON.stringify(owner)}\n`);
        },
      };
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? error.code : undefined;
      if (code !== 'EEXIST') throw error;
      const owner = await readOwner(ownerPath);
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
