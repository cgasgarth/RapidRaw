import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { availableParallelism, hostname, totalmem } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { isolatedGitEnvironment } from './git-environment';

interface LeaseOwner {
  hostname: string;
  label: string;
  leases?: LeaseFrame[];
  ownerId?: string;
  pid: number;
  startedAt: string;
  weight?: number;
  worktree: string;
}

interface LeaseFrame {
  id: string;
  label: string;
  pid: number;
}

interface LeaseWaiter extends LeaseOwner {
  ticket: number;
}

interface ResourceSlot {
  lockPath: string;
  ownerPath: string;
  priorOwner: LeaseOwner | null;
}

type ResourceAcquisition =
  | { acquired: false; priorOwner: LeaseOwner | null }
  | { acquired: true; priorOwner: LeaseOwner | null; slots: ResourceSlot[] };

export interface ResourceLeaseOptions {
  capacity?: number;
  hostBudgetCapacity?: number;
  hostBudgetOwnerId?: string;
  label: string;
  onQueued?: () => void;
  ownerAliases?: readonly string[];
  ownerId?: string;
  resource: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  weight?: number;
  pollMs?: number;
  root?: string;
}

export interface ResourceLease {
  ownerId: string;
  release: () => Promise<void>;
  updateOwnerPid: (pid: number) => Promise<void>;
}

const processOwnerId = Bun.env['RAWENGINE_RESOURCE_OWNER_ID'] ?? crypto.randomUUID();

const compactOwner = (owner: LeaseOwner | null): string =>
  owner
    ? `${owner.leases?.map((lease) => lease.label).join(' → ') || owner.label} pid=${owner.pid} worktree=${owner.worktree} since=${owner.startedAt} units=${owner.weight ?? 1}`
    : 'owner metadata unavailable';

const GIB = 1024 ** 3;
const HOST_BUDGET_RESOURCE = 'validation-host-heavy';

type HostBudgetClass = 'browser' | 'cpu-heavy' | 'native-heavy' | 'suite-exclusive';

export const deriveValidationHostBudgetCapacity = (cpuCount: number, memoryBytes: number): number => {
  const cpuUnits = Math.max(1, Math.floor(cpuCount / 2));
  const memoryUnits = Math.max(1, Math.floor(memoryBytes / (4 * GIB)));
  return Math.max(1, Math.min(6, cpuUnits, memoryUnits));
};

export const validationHostBudgetWeight = (resourceClass: HostBudgetClass, capacity: number): number => {
  if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error(`invalid host budget capacity: ${capacity}`);
  const fraction = resourceClass === 'cpu-heavy' ? 1 / 3 : resourceClass === 'suite-exclusive' ? 1 / 2 : 2 / 3;
  return Math.max(1, Math.min(capacity, Math.ceil(capacity * fraction)));
};

const positiveNumber = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const detectedCgroupLimits = async (): Promise<{ cpuCount?: number; memoryBytes?: number }> => {
  if (process.platform !== 'linux') return {};
  const cpuMax = await readFile('/sys/fs/cgroup/cpu.max', 'utf8').catch(() => '');
  const [quotaText, periodText] = cpuMax.trim().split(/\s+/u);
  const quota = positiveNumber(quotaText === 'max' ? undefined : quotaText);
  const period = positiveNumber(periodText);
  const memoryText = (await readFile('/sys/fs/cgroup/memory.max', 'utf8').catch(() => '')).trim();
  const memoryBytes = memoryText === 'max' ? undefined : positiveNumber(memoryText);
  return {
    ...(quota !== undefined && period !== undefined ? { cpuCount: Math.max(1, Math.floor(quota / period)) } : {}),
    ...(memoryBytes === undefined ? {} : { memoryBytes }),
  };
};

export const resolveValidationHostBudgetCapacity = async (explicitCapacity?: number): Promise<number> => {
  const override = explicitCapacity ?? positiveNumber(Bun.env['RAWENGINE_VALIDATION_HOST_BUDGET_CAPACITY']);
  if (override !== undefined) {
    if (!Number.isSafeInteger(override) || override < 1) throw new Error(`invalid host budget capacity: ${override}`);
    return override;
  }
  const cgroup = await detectedCgroupLimits();
  return deriveValidationHostBudgetCapacity(
    Math.min(availableParallelism(), cgroup.cpuCount ?? Number.POSITIVE_INFINITY),
    Math.min(totalmem(), cgroup.memoryBytes ?? Number.POSITIVE_INFINITY),
  );
};

const hostBudgetClass = (options: ResourceLeaseOptions): HostBudgetClass | undefined => {
  const { resource } = options;
  if (resource === 'native-heavy')
    return options.hostBudgetCapacity !== undefined ||
      options.hostBudgetOwnerId !== undefined ||
      Bun.env['RAWENGINE_VALIDATION_HOST_BUDGET_DIRECT'] === '1'
      ? 'native-heavy'
      : undefined;
  if (resource === 'validation-class-native-heavy') return 'native-heavy';
  if (resource === 'browser' || resource === 'validation-class-browser') return 'browser';
  if (resource === 'validation-class-cpu-heavy') return 'cpu-heavy';
  if (resource === 'validation-class-suite-exclusive') return 'suite-exclusive';
  return undefined;
};

const processIsAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export const resolveResourceCoordinatorRoot = (explicitRoot?: string): string => {
  const override = explicitRoot ?? Bun.env['RAWENGINE_RESOURCE_COORDINATOR_ROOT'];
  if (override) return resolve(override);
  const result = Bun.spawnSync(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'], {
    env: isolatedGitEnvironment(),
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

async function acquireSingleResourceLease(options: ResourceLeaseOptions): Promise<ResourceLease> {
  if (options.signal?.aborted) throw new Error('resource_wait_cancelled');
  const capacity = options.capacity ?? 1;
  if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error(`invalid resource capacity: ${capacity}`);
  const weight = options.weight ?? 1;
  if (!Number.isSafeInteger(weight) || weight < 1 || weight > capacity)
    throw new Error(`invalid resource weight: ${weight}/${capacity}`);
  const timeoutMs = options.timeoutMs ?? Number(Bun.env['RAWENGINE_RESOURCE_WAIT_TIMEOUT_MS'] ?? 30 * 60_000);
  const pollMs = options.pollMs ?? Number(Bun.env['RAWENGINE_RESOURCE_WAIT_POLL_MS'] ?? 250);
  const ownerId = options.ownerId ?? processOwnerId;
  const leaseFrame: LeaseFrame = { id: crypto.randomUUID(), label: options.label, pid: process.pid };
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
    const owned: Array<{ lockPath: string; ownerPath: string; owner: LeaseOwner }> = [];
    for (let slot = 0; slot < capacity; slot += 1) {
      const lockPath = lockPaths[slot];
      const ownerPath = ownerPaths[slot];
      if (!lockPath || !ownerPath) throw new Error(`missing resource slot ${slot}`);
      const owner = await readOwner(ownerPath);
      const lockPid = await readLockPid(lockPath);
      if (owner?.ownerId !== ownerId || lockPid === null || !processIsAlive(lockPid)) continue;
      owned.push({ lockPath, ownerPath, owner });
    }
    if (owned.length === 0) return undefined;
    if (owned.length < weight)
      throw new Error(`resource_weight_upgrade_requires_outer_release: ${options.resource} ${owned.length}->${weight}`);
    for (const { ownerPath, owner } of owned) {
      const leases = [
        ...(owner.leases ?? [{ id: `legacy-${ownerId}`, label: owner.label, pid: owner.pid }]),
        leaseFrame,
      ];
      const updated = { ...owner, label: leaseFrame.label, leases };
      await replaceFile(ownerPath, `${JSON.stringify(updated)}\n`);
    }
    return owned;
  });
  if (nested) {
    let released = false;
    return {
      ownerId,
      release: async () => {
        if (released) return;
        released = true;
        await withQueueMutex(queueMutexPath, pollMs, async () => {
          for (const { lockPath, ownerPath } of nested) {
            const owner = await readOwner(ownerPath);
            if (owner?.ownerId !== ownerId) continue;
            const leases = (owner.leases ?? []).filter((lease) => lease.id !== leaseFrame.id);
            if (leases.length > 0) {
              const rootPid = leases[0]?.pid ?? owner.pid;
              await replaceFile(lockPidPath(lockPath), `${rootPid}\n`);
              await replaceFile(
                ownerPath,
                `${JSON.stringify({ ...owner, label: leases.at(-1)?.label ?? owner.label, leases, pid: rootPid })}\n`,
              );
              continue;
            }
            await rm(ownerPath, { force: true });
            await releasePidLock(lockPath, owner.pid);
          }
        });
      },
      updateOwnerPid: async (pid: number) => {
        await withQueueMutex(queueMutexPath, pollMs, async () => {
          for (const { lockPath, ownerPath } of nested) {
            const owner = await readOwner(ownerPath);
            if (owner?.ownerId !== ownerId || !owner.leases?.some((lease) => lease.id === leaseFrame.id)) continue;
            const leases = owner.leases.map((lease) => (lease.id === leaseFrame.id ? { ...lease, pid } : lease));
            const rootPid = leases[0]?.pid ?? owner.pid;
            await replaceFile(lockPidPath(lockPath), `${rootPid}\n`);
            await replaceFile(ownerPath, `${JSON.stringify({ ...owner, leases, pid: rootPid })}\n`);
          }
        });
      },
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
        weight,
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
        const acquired = await withQueueMutex<ResourceAcquisition>(queueMutexPath, pollMs, async () => {
          const queue = await liveWaiters(queuePath);
          const queuePosition = queue.findIndex((entry) => entry.waiter.ticket === waiter.value.ticket);
          if (queuePosition !== 0) return { acquired: false, priorOwner: queue[0]?.waiter ?? null };
          const slots: ResourceSlot[] = [];
          for (let slot = 0; slot < capacity; slot += 1) {
            const lockPath = lockPaths[slot];
            const ownerPath = ownerPaths[slot];
            if (!lockPath || !ownerPath) throw new Error(`missing resource slot ${slot}`);
            const priorOwner = await readOwner(ownerPath);
            if (!(await acquirePidLock(lockPath, process.pid))) continue;
            slots.push({ lockPath, ownerPath, priorOwner });
            if (slots.length === weight) break;
          }
          if (slots.length < weight) {
            for (const slot of slots) await releasePidLock(slot.lockPath, process.pid);
            return { acquired: false, priorOwner: await readOwner(ownerPaths[0] ?? '') };
          }
          await rm(waiter.path, { force: true });
          return { acquired: true, slots, priorOwner: slots.find((slot) => slot.priorOwner)?.priorOwner ?? null };
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
          weight,
          worktree: process.cwd(),
        };
        const { slots } = acquired;
        for (const { ownerPath } of slots) await replaceFile(ownerPath, `${JSON.stringify(owner)}\n`);
        const waitedMs = Date.now() - waitStartedAt;
        if (waitedMs >= pollMs) console.log(`${options.label} acquired ${options.resource} after ${waitedMs}ms`);
        let released = false;
        return {
          ownerId,
          release: async () => {
            if (released) return;
            released = true;
            await withQueueMutex(queueMutexPath, pollMs, async () => {
              for (const { lockPath, ownerPath } of slots) {
                const current = await readOwner(ownerPath);
                if (current?.ownerId !== ownerId) continue;
                const leases = (current.leases ?? []).filter((lease) => lease.id !== leaseFrame.id);
                if (leases.length > 0) {
                  const rootPid = leases[0]?.pid ?? current.pid;
                  await replaceFile(lockPidPath(lockPath), `${rootPid}\n`);
                  await replaceFile(
                    ownerPath,
                    `${JSON.stringify({
                      ...current,
                      label: leases.at(-1)?.label ?? current.label,
                      leases,
                      pid: rootPid,
                    })}\n`,
                  );
                  continue;
                }
                if ((await readLockPid(lockPath)) === current.pid) {
                  await rm(ownerPath, { force: true });
                  await releasePidLock(lockPath, current.pid);
                }
              }
            });
          },
          updateOwnerPid: async (pid: number) => {
            await withQueueMutex(queueMutexPath, pollMs, async () => {
              for (const { lockPath, ownerPath } of slots) {
                const current = await readOwner(ownerPath);
                if (current?.ownerId !== ownerId || !current.leases?.some((lease) => lease.id === leaseFrame.id))
                  continue;
                const leases = current.leases.map((lease) => (lease.id === leaseFrame.id ? { ...lease, pid } : lease));
                const rootPid = leases[0]?.pid ?? current.pid;
                owner = { ...current, leases, pid: rootPid };
                await replaceFile(lockPidPath(lockPath), `${rootPid}\n`);
                await replaceFile(ownerPath, `${JSON.stringify(owner)}\n`);
              }
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
        if (
          owner?.ownerId !== undefined &&
          owner.worktree === process.cwd() &&
          options.ownerAliases?.includes(owner.ownerId)
        ) {
          throw new Error(
            `${options.label} refused self-queue on ${options.resource}: effective owner ${ownerId} aliases ${owner.ownerId}`,
          );
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
        await Bun.sleep(Math.min(pollMs, Math.max(1, timeoutMs - waitedMs)));
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

export async function acquireResourceLease(options: ResourceLeaseOptions): Promise<ResourceLease> {
  return await acquireResourceLeaseGroup([options]);
}

export async function acquireResourceLeaseGroup(options: readonly ResourceLeaseOptions[]): Promise<ResourceLease> {
  if (options.length === 0) throw new Error('resource lease group requires at least one resource');
  const roots = new Set(options.map((entry) => resolveResourceCoordinatorRoot(entry.root)));
  if (roots.size !== 1) throw new Error('resource lease group requires one coordinator root');
  const root = [...roots][0];
  if (root === undefined) throw new Error('resource lease group requires one coordinator root');

  const resourceClasses = options.map(hostBudgetClass).filter((value): value is HostBudgetClass => value !== undefined);
  const explicitHostOwners = new Set(
    options.map((entry) => entry.hostBudgetOwnerId).filter((value): value is string => value !== undefined),
  );
  if (explicitHostOwners.size > 1) throw new Error('resource lease group requires one host budget owner');
  const explicitOwners = new Set(
    options.map((entry) => entry.ownerId).filter((value): value is string => value !== undefined),
  );
  if (explicitOwners.size > 1) throw new Error('resource lease group requires one resource owner');

  const inheritedHostOwner = Bun.env['RAWENGINE_VALIDATION_HOST_BUDGET_OWNER_ID'];
  const inheritedHostRoot = Bun.env['RAWENGINE_VALIDATION_HOST_BUDGET_OWNER_ROOT'];
  const effectiveOwnerId =
    [...explicitHostOwners][0] ??
    (inheritedHostOwner !== undefined && inheritedHostRoot === root
      ? inheritedHostOwner
      : ([...explicitOwners][0] ?? processOwnerId));
  let queuedNotified = false;
  const notifyQueued = (): void => {
    if (queuedNotified) return;
    queuedNotified = true;
    for (const entry of options) entry.onQueued?.();
  };

  // Every caller uses one global order: concrete resources first (sorted by
  // identity), then weighted host capacity. Acquiring a node's class and
  // command resources as one group prevents class -> host -> native from
  // inverting the standalone native -> host path.
  const resourceLeases: ResourceLease[] = [];
  try {
    const ordered = [...options].sort((left, right) =>
      left.resource < right.resource ? -1 : left.resource > right.resource ? 1 : left.label.localeCompare(right.label),
    );
    for (const entry of ordered) {
      resourceLeases.push(
        await acquireSingleResourceLease({
          ...entry,
          onQueued: notifyQueued,
          ownerAliases: [...new Set([...(entry.ownerAliases ?? []), entry.ownerId])].filter(
            (ownerId): ownerId is string => ownerId !== undefined && ownerId !== effectiveOwnerId,
          ),
          ownerId: effectiveOwnerId,
          root,
        }),
      );
    }

    const hostSource = options.find((entry) => hostBudgetClass(entry) !== undefined) ?? options[0];
    let hostLease: ResourceLease | undefined;
    if (resourceClasses.length > 0) {
      const hostCapacities = new Set(
        options.map((entry) => entry.hostBudgetCapacity).filter((value): value is number => value !== undefined),
      );
      if (hostCapacities.size > 1) throw new Error('resource lease group requires one host budget capacity');
      const capacity = await resolveValidationHostBudgetCapacity([...hostCapacities][0]);
      hostLease = await acquireSingleResourceLease({
        capacity,
        label: `host-budget:${options.map((entry) => entry.label).join('+')}`,
        onQueued: notifyQueued,
        ownerId: effectiveOwnerId,
        ...(hostSource?.pollMs === undefined ? {} : { pollMs: hostSource.pollMs }),
        resource: HOST_BUDGET_RESOURCE,
        root,
        ...(hostSource?.signal === undefined ? {} : { signal: hostSource.signal }),
        ...(hostSource?.timeoutMs === undefined ? {} : { timeoutMs: hostSource.timeoutMs }),
        weight: Math.max(
          ...resourceClasses.map((resourceClass) => validationHostBudgetWeight(resourceClass, capacity)),
        ),
      });
    }
    let released = false;
    return {
      ownerId: effectiveOwnerId,
      release: async () => {
        if (released) return;
        released = true;
        try {
          await hostLease?.release();
        } finally {
          for (const lease of resourceLeases.reverse()) await lease.release();
        }
      },
      updateOwnerPid: async (pid: number) => {
        for (const lease of resourceLeases) await lease.updateOwnerPid(pid);
        await hostLease?.updateOwnerPid(pid);
      },
    };
  } catch (error) {
    for (const lease of resourceLeases.reverse()) await lease.release();
    throw error;
  }
}
