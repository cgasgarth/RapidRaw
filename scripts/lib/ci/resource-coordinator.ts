import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

interface LeaseOwner {
  hostname: string;
  label: string;
  leases?: LeaseFrame[];
  ownerId?: string;
  pid: number;
  startedAt: string;
  worktree: string;
}

interface LeaseFrame {
  id: string;
  label: string;
}

interface LeaseWaiter extends LeaseOwner {
  ticket: number;
}

export interface ResourceLeaseOptions {
  capacity?: number;
  label: string;
  onQueued?: () => void;
  ownerId?: string;
  resource: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  pollMs?: number;
  root?: string;
}

export interface ResourceLease {
  ownerId: string;
  release: () => Promise<void>;
  updateOwnerPid: (pid: number) => Promise<void>;
}

const processOwnerId = Bun.env.RAWENGINE_RESOURCE_OWNER_ID ?? crypto.randomUUID();

const compactOwner = (owner: LeaseOwner | null): string =>
  owner
    ? `${owner.leases?.map((lease) => lease.label).join(' → ') || owner.label} pid=${owner.pid} worktree=${owner.worktree} since=${owner.startedAt}`
    : 'owner metadata unavailable';

const processIsAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export const resolveResourceCoordinatorRoot = (explicitRoot?: string): string => {
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

const lockPidPath = (path: string): string => join(path, 'pid');

const readLockPid = async (path: string): Promise<number | null> => {
  const value = await readFile(lockPidPath(path), 'utf8').catch(
    async () => await readFile(path, 'utf8').catch(() => ''),
  );
  const pid = Number(value.trim());
  return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
};

const acquirePidLock = async (path: string, pid: number): Promise<boolean> => {
  try {
    await mkdir(path);
    await writeFile(lockPidPath(path), `${pid}\n`, 'utf8');
    return true;
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : undefined;
    if (code !== 'EEXIST') throw error;
    const ownerPid = await readLockPid(path);
    if (ownerPid === null || processIsAlive(ownerPid)) return false;
    await rm(path, { force: true, recursive: true });
    return await acquirePidLock(path, pid);
  }
};

const releasePidLock = async (path: string, pid: number): Promise<void> => {
  if ((await readLockPid(path)) === pid) await rm(path, { force: true, recursive: true });
};

const withQueueMutex = async <Result>(
  path: string,
  pollMs: number,
  operation: () => Promise<Result>,
): Promise<Result> => {
  while (!(await acquirePidLock(path, process.pid))) await Bun.sleep(Math.min(pollMs, 25));
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
  if (options.signal?.aborted) throw new Error('resource_wait_cancelled');
  const capacity = options.capacity ?? 1;
  if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error(`invalid resource capacity: ${capacity}`);
  const timeoutMs = options.timeoutMs ?? Number(Bun.env.RAWENGINE_RESOURCE_WAIT_TIMEOUT_MS ?? 30 * 60_000);
  const pollMs = options.pollMs ?? Number(Bun.env.RAWENGINE_RESOURCE_WAIT_POLL_MS ?? 250);
  const ownerId = options.ownerId ?? processOwnerId;
  const leaseFrame: LeaseFrame = { id: crypto.randomUUID(), label: options.label };
  const root = resolveResourceCoordinatorRoot(options.root);
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

  const nested = await withQueueMutex(queueMutexPath, pollMs, async () => {
    for (let slot = 0; slot < capacity; slot += 1) {
      const lockPath = lockPaths[slot];
      const ownerPath = ownerPaths[slot];
      if (!lockPath || !ownerPath) throw new Error(`missing resource slot ${slot}`);
      const owner = await readOwner(ownerPath);
      const lockPid = await readLockPid(lockPath);
      if (owner?.ownerId !== ownerId || lockPid === null || !processIsAlive(lockPid)) continue;
      const leases = [...(owner.leases ?? [{ id: `legacy-${ownerId}`, label: owner.label }]), leaseFrame];
      const updated = { ...owner, label: leaseFrame.label, leases };
      await replaceFile(ownerPath, `${JSON.stringify(updated)}\n`);
      return { lockPath, ownerPath };
    }
    return undefined;
  });
  if (nested) {
    let released = false;
    return {
      ownerId,
      release: async () => {
        if (released) return;
        released = true;
        await withQueueMutex(queueMutexPath, pollMs, async () => {
          const owner = await readOwner(nested.ownerPath);
          if (owner?.ownerId !== ownerId) return;
          const leases = (owner.leases ?? []).filter((lease) => lease.id !== leaseFrame.id);
          if (leases.length > 0) {
            await replaceFile(
              nested.ownerPath,
              `${JSON.stringify({ ...owner, label: leases.at(-1)?.label ?? owner.label, leases })}\n`,
            );
            return;
          }
          await rm(nested.ownerPath, { force: true });
          await releasePidLock(nested.lockPath, owner.pid);
        });
      },
      updateOwnerPid: async () => {},
    };
  }
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
    options.onQueued?.();
    while (true) {
      if (options.signal?.aborted) throw new Error('resource_wait_cancelled');
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
            if (!(await acquirePidLock(lockPath, process.pid))) continue;
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
          leases: [leaseFrame],
          ownerId,
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
          ownerId,
          release: async () => {
            if (released) return;
            released = true;
            await withQueueMutex(queueMutexPath, pollMs, async () => {
              const current = await readOwner(ownerPath);
              if (current?.ownerId !== ownerId) return;
              const leases = (current.leases ?? []).filter((lease) => lease.id !== leaseFrame.id);
              if (leases.length > 0) {
                await replaceFile(
                  ownerPath,
                  `${JSON.stringify({ ...current, label: leases.at(-1)?.label ?? current.label, leases })}\n`,
                );
                return;
              }
              if ((await readLockPid(lockPath)) === current.pid) {
                await rm(ownerPath, { force: true });
                await releasePidLock(lockPath, current.pid);
              }
            });
          },
          updateOwnerPid: async (pid: number) => {
            await withQueueMutex(queueMutexPath, pollMs, async () => {
              const current = await readOwner(ownerPath);
              if (current?.ownerId !== ownerId || !current.leases?.some((lease) => lease.id === leaseFrame.id)) return;
              owner = { ...current, pid };
              await replaceFile(lockPidPath(lockPath), `${pid}\n`);
              await replaceFile(ownerPath, `${JSON.stringify(owner)}\n`);
            });
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
        if (options.signal?.aborted) throw new Error('resource_wait_cancelled');
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
