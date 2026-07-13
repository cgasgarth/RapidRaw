import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

interface LeaseOwner {
  hostname: string;
  label: string;
  pid: number;
  startedAt: string;
  worktree: string;
}

interface LeaseWaiter extends LeaseOwner {
  ticket: number;
}

export interface ResourceLeaseOptions {
  capacity?: number;
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

const shlock = (path: string, pid: number): boolean =>
  Bun.spawnSync(['/usr/bin/shlock', '-p', String(pid), '-f', path], { stderr: 'pipe', stdout: 'pipe' }).exitCode === 0;

const releasePidLock = async (path: string, pid: number): Promise<void> => {
  const currentPid = Number((await readFile(path, 'utf8').catch(() => '')).trim());
  if (currentPid === pid) await rm(path, { force: true });
};

const withQueueMutex = async <Result>(
  path: string,
  pollMs: number,
  operation: () => Promise<Result>,
): Promise<Result> => {
  while (!shlock(path, process.pid)) await Bun.sleep(Math.min(pollMs, 25));
  try {
    return await operation();
  } finally {
    await releasePidLock(path, process.pid);
  }
};

const readWaiter = async (path: string): Promise<LeaseWaiter | null> => {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as LeaseWaiter;
    return Number.isSafeInteger(value.ticket) && value.ticket > 0 ? value : null;
  } catch {
    return null;
  }
};

const liveWaiters = async (queuePath: string): Promise<Array<{ path: string; waiter: LeaseWaiter }>> => {
  const entries = await readdir(queuePath).catch(() => []);
  const waiters = await Promise.all(
    entries
      .filter((entry) => entry.endsWith('.json'))
      .map(async (entry) => ({
        path: join(queuePath, entry),
        waiter: await readWaiter(join(queuePath, entry)),
      })),
  );
  const live: Array<{ path: string; waiter: LeaseWaiter }> = [];
  for (const entry of waiters) {
    if (entry.waiter === null || (entry.waiter.hostname === hostname() && !processIsAlive(entry.waiter.pid))) {
      await rm(entry.path, { force: true });
      continue;
    }
    live.push({ path: entry.path, waiter: entry.waiter });
  }
  return live.sort((left, right) => left.waiter.ticket - right.waiter.ticket);
};

export async function acquireResourceLease(options: ResourceLeaseOptions): Promise<ResourceLease> {
  const capacity = options.capacity ?? 1;
  if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error(`invalid resource capacity: ${capacity}`);
  const timeoutMs = options.timeoutMs ?? Number(Bun.env.RAWENGINE_RESOURCE_WAIT_TIMEOUT_MS ?? 30 * 60_000);
  const pollMs = options.pollMs ?? Number(Bun.env.RAWENGINE_RESOURCE_WAIT_POLL_MS ?? 250);
  const root = coordinatorRoot(options.root);
  const slotSuffix = (slot: number): string => (capacity === 1 ? '' : `.slot-${slot}`);
  const lockPaths = Array.from({ length: capacity }, (_, slot) =>
    join(root, `${options.resource}${slotSuffix(slot)}.lock`),
  );
  const ownerPaths = Array.from({ length: capacity }, (_, slot) =>
    join(root, `${options.resource}${slotSuffix(slot)}.owner.json`),
  );
  const queuePath = join(root, `${options.resource}.queue`);
  const queueMutexPath = join(root, `${options.resource}.queue.lock`);
  const ticketPath = join(root, `${options.resource}.ticket`);
  await mkdir(root, { recursive: true });
  await mkdir(queuePath, { recursive: true });
  const waitStartedAt = Date.now();
  let lastDiagnosticAt = 0;
  const waiter = await withQueueMutex(
    queueMutexPath,
    pollMs,
    async (): Promise<{ path: string; value: LeaseWaiter }> => {
      await mkdir(queuePath, { recursive: true });
      const priorTicket = Number((await readFile(ticketPath, 'utf8').catch(() => '0')).trim());
      const ticket = Number.isSafeInteger(priorTicket) && priorTicket >= 0 ? priorTicket + 1 : 1;
      await replaceFile(ticketPath, `${ticket}\n`);
      const value: LeaseWaiter = {
        hostname: hostname(),
        label: options.label,
        pid: process.pid,
        startedAt: new Date().toISOString(),
        ticket,
        worktree: process.cwd(),
      };
      const path = join(queuePath, `${String(ticket).padStart(16, '0')}.${process.pid}.${crypto.randomUUID()}.json`);
      await writeFile(path, `${JSON.stringify(value)}\n`);
      return { path, value };
    },
  );

  try {
    while (true) {
      try {
        const acquired = await withQueueMutex(queueMutexPath, pollMs, async () => {
          const queue = await liveWaiters(queuePath);
          const queuePosition = queue.findIndex((entry) => entry.waiter.ticket === waiter.value.ticket);
          if (queuePosition < 0 || queuePosition >= capacity)
            return { acquired: false, priorOwner: queue[0]?.waiter ?? null };
          for (let slot = 0; slot < capacity; slot += 1) {
            const lockPath = lockPaths[slot];
            const ownerPath = ownerPaths[slot];
            if (!lockPath || !ownerPath) throw new Error(`missing resource slot ${slot}`);
            const priorOwner = await readOwner(ownerPath);
            if (!shlock(lockPath, process.pid)) continue;
            await rm(waiter.path, { force: true });
            return { acquired: true, lockPath, ownerPath, priorOwner };
          }
          return { acquired: false, priorOwner: await readOwner(ownerPaths[0] ?? '') };
        });
        if (!acquired.acquired)
          throw Object.assign(new Error('resource_busy'), { blocker: acquired.priorOwner, code: 'EEXIST' });
        if (acquired.priorOwner && !processIsAlive(acquired.priorOwner.pid)) {
          console.log(`${options.label} recovered stale ${options.resource}: ${compactOwner(acquired.priorOwner)}`);
        }
        let owner: LeaseOwner = {
          hostname: hostname(),
          label: options.label,
          pid: process.pid,
          startedAt: new Date().toISOString(),
          worktree: process.cwd(),
        };
        const { lockPath, ownerPath } = acquired;
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
              await releasePidLock(lockPath, owner.pid);
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
        const blocker = error instanceof Error && 'blocker' in error ? (error.blocker as LeaseOwner | null) : null;
        let owner = blocker;
        for (const ownerPath of ownerPaths) {
          owner ??= await readOwner(ownerPath);
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
  } finally {
    await withQueueMutex(queueMutexPath, pollMs, async () => {
      await rm(waiter.path, { force: true });
      if ((await liveWaiters(queuePath)).length === 0) {
        await rm(ticketPath, { force: true });
        await rm(queuePath, { force: true, recursive: true });
      }
    });
  }
}
