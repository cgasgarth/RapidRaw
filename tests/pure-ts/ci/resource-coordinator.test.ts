import { afterEach, describe, expect, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  acquireResourceLease,
  deriveValidationHostBudgetCapacity,
  validationHostBudgetWeight,
} from '../../../scripts/lib/ci/resource-coordinator';

const temporaryRoots: string[] = [];
const spawnedChildren: Array<ReturnType<typeof Bun.spawn>> = [];

afterEach(async () => {
  const children = spawnedChildren.splice(0);
  for (const child of children) {
    if (child.exitCode === null) child.kill('SIGTERM');
  }
  await Promise.all(
    children.map(async (child) => {
      const exited = await Promise.race([child.exited.then(() => true), Bun.sleep(1_000).then(() => false)]);
      if (!exited) child.kill('SIGKILL');
      await child.exited;
    }),
  );
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const trackChild = <Child extends ReturnType<typeof Bun.spawn>>(child: Child): Child => {
  spawnedChildren.push(child);
  return child;
};

const temporaryRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'rapidraw-resource-coordinator-'));
  temporaryRoots.push(root);
  return root;
};

const waitFor = async (condition: () => Promise<boolean>, message: string, timeoutMs = 4_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await Bun.sleep(10);
  }
  throw new Error(message);
};

const queuedLabels = async (root: string, resource = 'native-heavy'): Promise<string[]> => {
  const queue = join(root, `${resource}.queue`);
  const entries = await readdir(queue).catch(() => []);
  const labels = await Promise.all(
    entries
      .filter((entry) => entry.endsWith('.json'))
      .map(async (entry) => {
        const contents = await readFile(join(queue, entry), 'utf8').catch(() => null);
        if (contents === null) return null;
        try {
          const value: unknown = JSON.parse(contents);
          return typeof value === 'object' && value !== null && 'label' in value && typeof value.label === 'string'
            ? value.label
            : null;
        } catch {
          return null;
        }
      }),
  );
  return labels.filter((label): label is string => label !== null);
};

const directLease = (root: string, script: string, cwd?: string, environment: NodeJS.ProcessEnv = {}) => {
  const modulePath = join(import.meta.dir, '../../../scripts/lib/ci/resource-coordinator.ts');
  const lifecycle = `const {existsSync}=await import('node:fs');
const lifecycleParent=Number(Bun.env.RAWENGINE_TEST_PARENT_PID);
const lifecycleRoot=${JSON.stringify(root)};
const lifecycle=setInterval(()=>{try{process.kill(lifecycleParent,0)}catch{process.exit(143)}if(!existsSync(lifecycleRoot))process.exit(143)},25);
lifecycle.unref();
try{${script}}finally{clearInterval(lifecycle)}`;
  return trackChild(
    Bun.spawn(
      [
        'bun',
        '-e',
        `import { acquireResourceLease, acquireResourceLeaseGroup } from ${JSON.stringify(modulePath)};${lifecycle}`,
      ],
      {
        env: {
          ...Bun.env,
          RAWENGINE_RESOURCE_OWNER_ID: crypto.randomUUID(),
          RAWENGINE_RESOURCE_COORDINATOR_ROOT: root,
          RAWENGINE_RESOURCE_WAIT_POLL_MS: '10',
          RAWENGINE_TEST_PARENT_PID: String(process.pid),
          ...environment,
        },
        ...(cwd === undefined ? {} : { cwd }),
        stderr: 'pipe',
        stdout: 'pipe',
      },
    ),
  );
};

const expectSuccessfulExit = async (child: ReturnType<typeof directLease>): Promise<void> => {
  const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  expect(exitCode, stderr).toBe(0);
};

const coordinated = (root: string, label: string, script: string, cwd?: string) =>
  trackChild(
    Bun.spawn(
      [
        'bun',
        join(import.meta.dir, '../../../scripts/ci/run-resource-coordinated.ts'),
        '--resource',
        'native-heavy',
        '--label',
        label,
        '--',
        'bun',
        '-e',
        script,
      ],
      {
        ...(cwd === undefined ? {} : { cwd }),
        env: {
          ...Bun.env,
          RAWENGINE_RESOURCE_OWNER_ID: crypto.randomUUID(),
          RAWENGINE_RESOURCE_COORDINATOR_ROOT: root,
          RAWENGINE_RESOURCE_WAIT_POLL_MS: '10',
        },
        stderr: 'pipe',
        stdout: 'pipe',
      },
    ),
  );

const processIsAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const seedStaleLock = async (root: string, label: string): Promise<void> => {
  await mkdir(root, { recursive: true });
  await writeFile(join(root, 'native-heavy.lock'), '2147483647\n');
  await writeFile(
    join(root, 'native-heavy.owner.json'),
    `${JSON.stringify({
      hostname: (await import('node:os')).hostname(),
      label,
      pid: 2_147_483_647,
      startedAt: '2026-01-01T00:00:00.000Z',
      worktree: '/tmp/dead-worktree',
    })}\n`,
  );
};

describe('cross-worktree resource coordinator', () => {
  test('derives bounded host capacity and proportional class reservations', () => {
    expect(deriveValidationHostBudgetCapacity(12, 64 * 1024 ** 3)).toBe(6);
    expect(deriveValidationHostBudgetCapacity(4, 8 * 1024 ** 3)).toBe(2);
    expect(deriveValidationHostBudgetCapacity(64, 2 * 1024 ** 3)).toBe(1);
    expect(validationHostBudgetWeight('cpu-heavy', 6)).toBe(2);
    expect(validationHostBudgetWeight('suite-exclusive', 6)).toBe(3);
    expect(validationHostBudgetWeight('native-heavy', 6)).toBe(4);
    expect(validationHostBudgetWeight('browser', 6)).toBe(4);
  });

  test('shares weighted host capacity across worktrees while light work stays parallel', async () => {
    const root = await temporaryRoot();
    const nativeWorktree = join(root, 'native-worktree');
    const cpuWorktree = join(root, 'cpu-worktree');
    const lightWorktree = join(root, 'light-worktree');
    const nativeStarted = join(root, 'native-started');
    const cpuStarted = join(root, 'cpu-started');
    const lightStarted = join(root, 'light-started');
    const releaseNative = join(root, 'release-native');
    await Promise.all([mkdir(nativeWorktree), mkdir(cpuWorktree), mkdir(lightWorktree)]);

    const native = directLease(
      root,
      `const lease=await acquireResourceLease({resource:'native-heavy',label:'weighted-native',hostBudgetCapacity:4,pollMs:10});
await Bun.write(${JSON.stringify(nativeStarted)},'started');
while(!(await Bun.file(${JSON.stringify(releaseNative)}).exists())) await Bun.sleep(10);
await lease.release();`,
      nativeWorktree,
    );
    await waitFor(async () => await Bun.file(nativeStarted).exists(), 'weighted native owner did not start');
    const cpu = directLease(
      root,
      `const lease=await acquireResourceLease({resource:'validation-class-cpu-heavy',capacity:2,label:'weighted-cpu',hostBudgetCapacity:4,pollMs:10});
await Bun.write(${JSON.stringify(cpuStarted)},'started');
await lease.release();`,
      cpuWorktree,
    );
    await waitFor(
      async () => (await queuedLabels(root, 'validation-host-heavy')).includes('host-budget:weighted-cpu'),
      'CPU owner never queued behind the weighted native reservation',
    );
    expect(await Bun.file(cpuStarted).exists()).toBeFalse();

    const light = trackChild(
      Bun.spawn(['bun', '-e', `await Bun.write(${JSON.stringify(lightStarted)},'started')`], {
        cwd: lightWorktree,
      }),
    );
    expect(await light.exited).toBe(0);
    expect(await Bun.file(lightStarted).exists()).toBeTrue();

    await writeFile(releaseNative, 'release\n');
    await Promise.all([expectSuccessfulExit(native), expectSuccessfulExit(cpu)]);
    expect(await Bun.file(cpuStarted).exists()).toBeTrue();
    expect((await readdir(root)).some((entry) => entry.startsWith('validation-host-heavy'))).toBeFalse();
  });

  test('cancels weighted waiters without releasing any live owner slots', async () => {
    const root = await temporaryRoot();
    const holder = await acquireResourceLease({
      capacity: 4,
      label: 'weighted-holder',
      ownerId: 'weighted-holder-owner',
      resource: 'validation-host-heavy',
      root,
      weight: 3,
    });
    const controller = new AbortController();
    let queued: (() => void) | undefined;
    const queuedPromise = new Promise<void>((resolve) => {
      queued = resolve;
    });
    const waiting = acquireResourceLease({
      capacity: 4,
      label: 'weighted-cancelled',
      onQueued: () => queued?.(),
      ownerId: 'weighted-cancelled-owner',
      pollMs: 5,
      resource: 'validation-host-heavy',
      root,
      signal: controller.signal,
      weight: 2,
    });
    try {
      await queuedPromise;
      controller.abort();
      await expect(waiting).rejects.toThrow('resource_wait_cancelled');
      expect(
        (await readdir(root)).filter(
          (entry) => entry.startsWith('validation-host-heavy.slot-') && entry.endsWith('.lock'),
        ),
      ).toHaveLength(3);
      expect(await queuedLabels(root, 'validation-host-heavy')).toEqual([]);
    } finally {
      controller.abort();
      await Promise.allSettled([waiting]);
      await holder.release();
    }
    expect((await readdir(root)).some((entry) => entry.startsWith('validation-host-heavy'))).toBeFalse();
  });

  test('composed cross-class cancellation releases only the waiting host reservation', async () => {
    const root = await temporaryRoot();
    const holder = await acquireResourceLease({
      hostBudgetCapacity: 4,
      label: 'composed-native-holder',
      ownerId: 'composed-native-holder-owner',
      resource: 'native-heavy',
      root,
    });
    const controller = new AbortController();
    let queued: (() => void) | undefined;
    const queuedPromise = new Promise<void>((resolve) => {
      queued = resolve;
    });
    const waiting = acquireResourceLease({
      capacity: 2,
      hostBudgetCapacity: 4,
      label: 'composed-cpu-waiter',
      onQueued: () => queued?.(),
      ownerId: 'composed-cpu-waiter-owner',
      pollMs: 5,
      resource: 'validation-class-cpu-heavy',
      root,
      signal: controller.signal,
    });
    try {
      await queuedPromise;
      controller.abort();
      await expect(waiting).rejects.toThrow('resource_wait_cancelled');
      expect((await readFile(join(root, 'native-heavy.owner.json'), 'utf8')).includes('composed-native-holder')).toBe(
        true,
      );
      expect(await queuedLabels(root, 'validation-host-heavy')).toEqual([]);
    } finally {
      controller.abort();
      await Promise.allSettled([waiting]);
      await holder.release();
    }
    expect((await readdir(root)).some((entry) => entry.startsWith('validation-host-heavy'))).toBeFalse();
  });

  test('recovers every weighted slot after an orphaned cross-worktree owner', async () => {
    const root = await temporaryRoot();
    const worktree = join(root, 'orphan-worktree');
    const started = join(root, 'weighted-orphan-started');
    await mkdir(worktree);
    const orphan = directLease(
      root,
      `const lease=await acquireResourceLease({resource:'validation-host-heavy',capacity:4,weight:3,label:'weighted-orphan'});
await Bun.write(${JSON.stringify(started)},'started');
while(true) await Bun.sleep(10);`,
      worktree,
    );
    await waitFor(async () => await Bun.file(started).exists(), 'weighted orphan never acquired its slots');
    orphan.kill('SIGKILL');
    await orphan.exited;

    const follower = directLease(
      root,
      `const lease=await acquireResourceLease({resource:'validation-host-heavy',capacity:4,weight:3,label:'weighted-follower'});
console.log('weighted-follower-acquired'); await lease.release();`,
      worktree,
    );
    await expectSuccessfulExit(follower);
    expect(await new Response(follower.stdout).text()).toContain('weighted-follower-acquired');
    expect((await readdir(root)).some((entry) => entry.startsWith('validation-host-heavy'))).toBeFalse();
  });

  test('isolates root discovery from inherited Git configuration', async () => {
    const root = await temporaryRoot();
    const repository = join(root, 'repository');
    const bin = join(root, 'bin');
    const capture = join(root, 'git-environment');
    await Promise.all([mkdir(repository), mkdir(bin)]);
    const fakeGit = join(bin, 'git');
    await writeFile(
      fakeGit,
      `#!/bin/sh
printf 'global=%s\nnosystem=%s\ncount=%s\n' "\${GIT_CONFIG_GLOBAL-unset}" "\${GIT_CONFIG_NOSYSTEM-unset}" "\${GIT_CONFIG_COUNT-unset}" > ${JSON.stringify(capture)}
printf '.git\n'
`,
    );
    await chmod(fakeGit, 0o755);
    const { RAWENGINE_RESOURCE_COORDINATOR_ROOT: _coordinatorRoot, ...inheritedEnvironment } = Bun.env;
    const environment = {
      ...inheritedEnvironment,
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'core.fsmonitor',
      GIT_CONFIG_VALUE_0: 'true',
      GIT_CONFIG_GLOBAL: join(root, 'hostile-global-config'),
      PATH: `${bin}:${Bun.env['PATH'] ?? ''}`,
    };
    const modulePath = join(import.meta.dir, '../../../scripts/lib/ci/resource-coordinator.ts');
    const child = trackChild(
      Bun.spawn(
        [
          'bun',
          '-e',
          `import { resolveResourceCoordinatorRoot } from ${JSON.stringify(modulePath)}; console.log(resolveResourceCoordinatorRoot());`,
        ],
        { cwd: repository, env: environment, stderr: 'pipe', stdout: 'pipe' },
      ),
    );
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(exitCode, stderr).toBe(0);
    expect(stdout.trim()).toBe(join(await realpath(repository), '.git', 'rapidraw-resource-locks'));
    expect(await readFile(capture, 'utf8')).toBe('global=/dev/null\nnosystem=1\ncount=unset\n');
  });

  test('bounds memory-heavy lanes across worktrees without serializing safe parallel work', async () => {
    const root = await temporaryRoot();
    const worktrees = [join(root, 'one'), join(root, 'two'), join(root, 'three')];
    const releasePath = join(root, 'release-capacity');
    await Promise.all(worktrees.map((worktree) => mkdir(worktree)));
    const startedPath = (label: string) => join(root, `${label}.started`);
    const script = (label: string) =>
      `const lease=await acquireResourceLease({resource:'cpu-heavy',capacity:2,label:${JSON.stringify(label)}});
const pressure=new Uint8Array(32*1024*1024); pressure.fill(1);
await Bun.write(${JSON.stringify(startedPath(label))},'started');
while(!(await Bun.file(${JSON.stringify(releasePath)}).exists())) await Bun.sleep(10);
console.log('released '+pressure[0]); await lease.release();`;
    const first = directLease(root, script('first'), worktrees[0]);
    const second = directLease(root, script('second'), worktrees[1]);
    await waitFor(
      async () => (await Bun.file(startedPath('first')).exists()) && (await Bun.file(startedPath('second')).exists()),
      'capacity two did not admit the first two workers concurrently',
      10_000,
    );
    const third = directLease(root, script('third'), worktrees[2]);
    await waitFor(
      async () => (await queuedLabels(root, 'cpu-heavy')).includes('third'),
      'third worker never queued',
      10_000,
    );
    expect(await Bun.file(startedPath('third')).exists()).toBeFalse();
    await writeFile(releasePath, 'release\n');
    await Promise.all([first, second, third].map(expectSuccessfulExit));
    expect(await Bun.file(startedPath('third')).exists()).toBeTrue();
  }, 15_000);

  test('uses a portable lock primitive without requiring macOS shlock', async () => {
    const root = await temporaryRoot();
    const child = directLease(
      root,
      `const lease=await acquireResourceLease({resource:'native-heavy',label:'portable-lock'});
console.log('portable-acquired');
await lease.release();`,
    );
    await expectSuccessfulExit(child);
    expect(await new Response(child.stdout).text()).toContain('portable-acquired');
    expect(await Bun.file(join(root, 'native-heavy.lock')).exists()).toBeFalse();
  });

  test('aborted queued acquisition removes its waiter without touching the live owner', async () => {
    const root = await temporaryRoot();
    const holder = await acquireResourceLease({
      label: 'holder',
      ownerId: 'cancel-holder',
      resource: 'native-heavy',
      root,
    });
    const controller = new AbortController();
    let markQueued: (() => void) | undefined;
    const queued = new Promise<void>((resolve) => {
      markQueued = resolve;
    });
    const waiting = acquireResourceLease({
      label: 'cancelled-waiter',
      onQueued: () => markQueued?.(),
      ownerId: 'cancel-waiter',
      pollMs: 1,
      resource: 'native-heavy',
      root,
      signal: controller.signal,
    });

    try {
      await queued;
      controller.abort();
      await expect(waiting).rejects.toThrow('resource_wait_cancelled');
      expect((await readFile(join(root, 'native-heavy.owner.json'), 'utf8')).includes('holder')).toBeTrue();
      expect(await queuedLabels(root)).toEqual([]);
    } finally {
      controller.abort();
      await Promise.allSettled([waiting]);
      await holder.release();
    }
    expect(await Bun.file(join(root, 'native-heavy.lock')).exists()).toBeFalse();
  });

  test('bounds queue stalls with owner diagnostics and removes the timed-out waiter', async () => {
    const root = await temporaryRoot();
    const holder = await acquireResourceLease({
      label: 'long-native-owner',
      ownerId: 'long-native-owner-id',
      resource: 'native-heavy',
      root,
    });
    const controller = new AbortController();
    const abort = setTimeout(() => controller.abort(), 100);
    try {
      await expect(
        acquireResourceLease({
          label: 'bounded-native-waiter',
          ownerId: 'bounded-native-waiter-id',
          pollMs: 1_000,
          resource: 'native-heavy',
          root,
          signal: controller.signal,
          timeoutMs: 25,
        }),
      ).rejects.toThrow(
        /bounded-native-waiter timed out waiting \d+ms for native-heavy: long-native-owner pid=\d+ worktree=/u,
      );
      expect(await queuedLabels(root)).toEqual([]);
      expect((await readFile(join(root, 'native-heavy.owner.json'), 'utf8')).includes('long-native-owner')).toBeTrue();
    } finally {
      clearTimeout(abort);
      await holder.release();
    }
  });

  test('hands a released lease to the oldest waiter before an immediate reacquirer', async () => {
    const root = await temporaryRoot();
    const releaseFirst = join(root, 'release-first');
    const benchmark = directLease(
      root,
      `const first=await acquireResourceLease({resource:'native-heavy',label:'benchmark'});
console.log('benchmark-first '+Date.now());
while(!(await Bun.file(${JSON.stringify(releaseFirst)}).exists())) await Bun.sleep(10);
await first.release();
const second=await acquireResourceLease({resource:'native-heavy',label:'benchmark-reacquire'});
console.log('benchmark-second '+Date.now());
await second.release();`,
    );
    await waitFor(
      async () => (await readFile(join(root, 'native-heavy.owner.json'), 'utf8').catch(() => '')).includes('benchmark'),
      'benchmark never acquired the initial lease',
    );
    const publish = directLease(
      root,
      `const lease=await acquireResourceLease({resource:'native-heavy',label:'publish-waiter'});
console.log('publish '+Date.now());
await Bun.sleep(50);
await lease.release();`,
    );
    await waitFor(async () => (await queuedLabels(root)).includes('publish-waiter'), 'publish waiter never queued');
    await writeFile(releaseFirst, 'release\n');
    expect(await benchmark.exited).toBe(0);
    expect(await publish.exited).toBe(0);
    const benchmarkOutput = await new Response(benchmark.stdout).text();
    const publishOutput = await new Response(publish.stdout).text();
    const secondAt = Number(benchmarkOutput.match(/benchmark-second (\d+)/)?.[1]);
    const publishAt = Number(publishOutput.match(/publish (\d+)/)?.[1]);
    expect(publishAt).toBeLessThanOrEqual(secondAt);
    expect(benchmarkOutput).toContain('benchmark-reacquire waiting for native-heavy: publish-waiter pid=');
    expect(await queuedLabels(root)).toEqual([]);
  });

  test('reenters a same-owner native build for a nested performance bisect without queueing', async () => {
    const root = await temporaryRoot();
    let nestedQueued = false;
    const nativeBuild = await acquireResourceLease({ label: 'native-build', resource: 'native-heavy', root });
    const performanceBisect = await acquireResourceLease({
      label: 'performance-bisect',
      onQueued: () => {
        nestedQueued = true;
      },
      resource: 'native-heavy',
      root,
    });

    const owner = JSON.parse(await readFile(join(root, 'native-heavy.owner.json'), 'utf8')) as {
      label: string;
      leases: Array<{ label: string }>;
      ownerId: string;
    };
    expect(nestedQueued).toBeFalse();
    expect(performanceBisect.ownerId).toBe(nativeBuild.ownerId);
    expect(owner.label).toBe('performance-bisect');
    expect(owner.leases.map((lease) => lease.label)).toEqual(['native-build', 'performance-bisect']);

    await performanceBisect.release();
    expect((await readFile(join(root, 'native-heavy.owner.json'), 'utf8')).includes('native-build')).toBeTrue();
    await nativeBuild.release();
    expect(await Bun.file(join(root, 'native-heavy.lock')).exists()).toBeFalse();
  });

  test('propagates wrapper ownership so its command can reenter the coordinated resource', async () => {
    const root = await temporaryRoot();
    const modulePath = join(import.meta.dir, '../../../scripts/lib/ci/resource-coordinator.ts');
    const child = coordinated(
      root,
      'native-build',
      `const {acquireResourceLease}=await import(${JSON.stringify(modulePath)});
const nested=await acquireResourceLease({resource:'native-heavy',label:'performance-bisect'});
console.log('nested-wrapper-owner '+nested.ownerId); await nested.release();`,
    );

    await expectSuccessfulExit(child);
    expect(await new Response(child.stdout).text()).toContain('nested-wrapper-owner ');
    expect(await queuedLabels(root)).toEqual([]);
  });

  test('restores the live outer PID after a nested wrapper child exits', async () => {
    const root = await temporaryRoot();
    const runner = join(import.meta.dir, '../../../scripts/ci/run-resource-coordinated.ts');
    const outer = await acquireResourceLease({
      hostBudgetCapacity: 4,
      hostBudgetOwnerId: 'validation-node-owner',
      label: 'validation-resource-native-heavy:rust-clippy',
      ownerId: 'validation-run-owner',
      resource: 'native-heavy',
      root,
    });
    const nested = trackChild(
      Bun.spawn(
        [
          'bun',
          runner,
          '--resource',
          'native-heavy',
          '--label',
          'nested-clippy',
          '--',
          'bun',
          '-e',
          "console.log('nested-clippy-complete')",
        ],
        {
          env: {
            ...Bun.env,
            RAWENGINE_RESOURCE_COORDINATOR_ROOT: root,
            RAWENGINE_RESOURCE_OWNER_ID: 'validation-run-owner',
            RAWENGINE_VALIDATION_HOST_BUDGET_CAPACITY: '4',
            RAWENGINE_VALIDATION_HOST_BUDGET_OWNER_ID: 'validation-node-owner',
            RAWENGINE_VALIDATION_HOST_BUDGET_OWNER_ROOT: root,
          },
          stderr: 'pipe',
          stdout: 'pipe',
        },
      ),
    );
    await expectSuccessfulExit(nested);
    const owner = JSON.parse(await readFile(join(root, 'native-heavy.owner.json'), 'utf8')) as {
      leases: Array<{ label: string; pid: number }>;
      pid: number;
    };
    expect(owner.pid).toBe(process.pid);
    expect(owner.leases).toEqual([
      expect.objectContaining({ label: 'validation-resource-native-heavy:rust-clippy', pid: process.pid }),
    ]);

    const follower = directLease(
      root,
      `const lease=await acquireResourceLease({resource:'native-heavy',label:'post-wrapper-follower'});console.log('follower-acquired');await lease.release();`,
    );
    await waitFor(
      async () => (await queuedLabels(root)).includes('post-wrapper-follower'),
      'follower stole the live outer lease after nested child exit',
    );
    await outer.release();
    await expectSuccessfulExit(follower);
    expect(await new Response(follower.stdout).text()).toContain('follower-acquired');
  });

  test('rejects a related owner identity mismatch instead of self-queueing without a child', async () => {
    const root = await temporaryRoot();
    const outer = await acquireResourceLease({
      label: 'legacy-outer-native',
      ownerId: 'validation-run-owner',
      resource: 'native-heavy',
      root,
    });
    try {
      await expect(
        acquireResourceLease({
          hostBudgetCapacity: 4,
          hostBudgetOwnerId: 'validation-node-owner',
          label: 'nested-clippy',
          ownerId: 'validation-run-owner',
          resource: 'native-heavy',
          root,
          timeoutMs: 5_000,
        }),
      ).rejects.toThrow(
        'nested-clippy refused self-queue on native-heavy: effective owner validation-node-owner aliases validation-run-owner',
      );
      expect(await queuedLabels(root)).toEqual([]);
    } finally {
      await outer.release();
    }
  });

  test('shared inherited identity across worktrees queues normally without reserving host capacity', async () => {
    const root = await temporaryRoot();
    const firstWorktree = join(root, 'shared-owner-first-worktree');
    const secondWorktree = join(root, 'shared-owner-second-worktree');
    const releaseFirst = join(root, 'release-shared-owner-first');
    const secondAcquired = join(root, 'shared-owner-second-acquired');
    await Promise.all([mkdir(firstWorktree), mkdir(secondWorktree)]);
    const sharedEnvironment = { RAWENGINE_RESOURCE_OWNER_ID: 'shared-shell-owner' };
    const first = directLease(
      root,
      `const lease=await acquireResourceLease({resource:'native-heavy',label:'shared-owner-first'});
while(!(await Bun.file(${JSON.stringify(releaseFirst)}).exists())) await Bun.sleep(10);
await lease.release();`,
      firstWorktree,
      sharedEnvironment,
    );
    await waitFor(
      async () =>
        (await readFile(join(root, 'native-heavy.owner.json'), 'utf8').catch(() => '')).includes('shared-owner-first'),
      'first worktree did not acquire the shared inherited owner lease',
    );

    const second = directLease(
      root,
      `const lease=await acquireResourceLease({resource:'native-heavy',label:'shared-owner-second',hostBudgetCapacity:4,hostBudgetOwnerId:'second-node-owner',ownerId:'shared-shell-owner'});
await Bun.write(${JSON.stringify(secondAcquired)},'acquired'); await lease.release();`,
      secondWorktree,
      sharedEnvironment,
    );
    await waitFor(
      async () => (await queuedLabels(root)).includes('shared-owner-second'),
      'second worktree errored instead of queueing behind the legitimate owner',
    );
    expect(second.exitCode).toBeNull();
    expect(await Bun.file(secondAcquired).exists()).toBeFalse();
    expect(await queuedLabels(root, 'validation-host-heavy')).toEqual([]);
    expect(
      (await readdir(root)).some((entry) => entry.startsWith('validation-host-heavy') && entry.endsWith('.owner.json')),
    ).toBeFalse();

    await writeFile(releaseFirst, 'release\n');
    await Promise.all([expectSuccessfulExit(first), expectSuccessfulExit(second)]);
    expect(await Bun.file(secondAcquired).exists()).toBeTrue();
  });

  test('keeps the outer lock until the last nested release while unrelated owners remain FIFO', async () => {
    const root = await temporaryRoot();
    const outer = await acquireResourceLease({ label: 'outer', resource: 'native-heavy', root });
    const nested = await acquireResourceLease({ label: 'nested', resource: 'native-heavy', root });
    const first = directLease(
      root,
      `const lease=await acquireResourceLease({resource:'native-heavy',label:'first-follower'});
console.log('first-acquired'); await lease.release();`,
    );
    await waitFor(async () => (await queuedLabels(root)).includes('first-follower'), 'first follower never queued');
    const second = directLease(
      root,
      `const lease=await acquireResourceLease({resource:'native-heavy',label:'second-follower'});
console.log('second-acquired'); await lease.release();`,
    );
    await waitFor(async () => (await queuedLabels(root)).includes('second-follower'), 'second follower never queued');

    await outer.release();
    expect((await readFile(join(root, 'native-heavy.owner.json'), 'utf8')).includes('nested')).toBeTrue();
    expect(first.exitCode).toBeNull();
    await nested.release();
    await Promise.all([expectSuccessfulExit(first), expectSuccessfulExit(second)]);
    expect(await new Response(first.stdout).text()).toContain('first-acquired');
    expect(await new Response(second.stdout).text()).toContain('second-acquired');
    expect(await queuedLabels(root)).toEqual([]);
  });

  test('recovers an interrupted owner with nested frames and admits the next owner', async () => {
    const root = await temporaryRoot();
    const nestedReady = join(root, 'nested-ready');
    const interrupted = directLease(
      root,
      `const outer=await acquireResourceLease({resource:'native-heavy',label:'interrupted-outer'});
const nested=await acquireResourceLease({resource:'native-heavy',label:'interrupted-nested'});
await Bun.write(${JSON.stringify(nestedReady)},'ready');
while(true) await Bun.sleep(10);`,
    );
    await waitFor(async () => await Bun.file(nestedReady).exists(), 'nested owner never became ready');
    interrupted.kill('SIGKILL');
    await interrupted.exited;

    const follower = directLease(
      root,
      `const lease=await acquireResourceLease({resource:'native-heavy',label:'post-interrupt'});
console.log('post-interrupt-acquired'); await lease.release();`,
    );
    await expectSuccessfulExit(follower);
    expect(await new Response(follower.stdout).text()).toContain('post-interrupt-acquired');
    expect(await Bun.file(join(root, 'native-heavy.lock')).exists()).toBeFalse();
  });

  test('completes three concurrent precommit-shaped owners with reentrant native gates in FIFO order', async () => {
    const root = await temporaryRoot();
    const release = (index: number) => join(root, `release-${index}`);
    const acquired = (index: number) => join(root, `acquired-${index}`);
    const worker = (index: number) =>
      directLease(
        root,
        `const identity={hostBudgetCapacity:4,hostBudgetOwnerId:'precommit-node-${index}',ownerId:'precommit-run-${index}'};
const outer=await acquireResourceLease({...identity,resource:'native-heavy',label:'precommit-${index}:native-build'});
const nested=await acquireResourceLease({...identity,resource:'native-heavy',label:'precommit-${index}:performance-bisect'});
await Bun.write(${JSON.stringify(acquired(index))},'acquired');
while(!(await Bun.file(${JSON.stringify(release(index))}).exists())) await Bun.sleep(10);
await nested.release(); await outer.release();`,
      );
    const workers = [worker(0)];
    await waitFor(async () => await Bun.file(acquired(0)).exists(), 'first precommit owner did not acquire');
    workers.push(worker(1));
    await waitFor(
      async () => (await queuedLabels(root)).includes('precommit-1:native-build'),
      'second precommit owner did not queue',
    );
    workers.push(worker(2));
    await waitFor(
      async () => (await queuedLabels(root)).includes('precommit-2:native-build'),
      'third precommit owner did not queue',
    );
    expect(await Bun.file(acquired(1)).exists()).toBeFalse();
    expect(await Bun.file(acquired(2)).exists()).toBeFalse();
    for (let index = 0; index < workers.length; index += 1) {
      await writeFile(release(index), 'release\n');
      await expectSuccessfulExit(workers[index] as ReturnType<typeof Bun.spawn>);
      if (index + 1 < workers.length)
        await waitFor(
          async () => await Bun.file(acquired(index + 1)).exists(),
          `precommit owner ${index + 1} did not acquire`,
        );
    }
    expect(await Bun.file(join(root, 'native-heavy.lock')).exists()).toBeFalse();
  });

  test('orders three-process validation topology before host capacity so the native cycle cannot form', async () => {
    const root = await temporaryRoot();
    const nativeHeld = join(root, 'standalone-native-held');
    const allowStandaloneBudget = join(root, 'allow-standalone-budget');
    const standaloneCompleted = join(root, 'standalone-completed');
    const firstAcquired = join(root, 'first-validation-acquired');
    const releaseFirst = join(root, 'release-first-validation');
    const secondAcquired = join(root, 'second-validation-acquired');
    const validationWorker = (label: string, acquired: string, release?: string) =>
      directLease(
        root,
        `const lease=await acquireResourceLeaseGroup([
  {resource:'validation-class-native-heavy',capacity:1,label:'${label}-class',hostBudgetCapacity:4,hostBudgetOwnerId:'${label}-node',ownerId:'${label}-run'},
  {resource:'native-heavy',label:'${label}-native',hostBudgetCapacity:4,hostBudgetOwnerId:'${label}-node',ownerId:'${label}-run'}
]);
await Bun.write(${JSON.stringify(acquired)},'acquired');
${release === undefined ? '' : `while(!(await Bun.file(${JSON.stringify(release)}).exists())) await Bun.sleep(10);`}
await lease.release();`,
      );

    const standalone = directLease(
      root,
      `const identity={ownerId:'standalone-node-owner'};
const outer=await acquireResourceLease({...identity,resource:'native-heavy',label:'standalone-native'});
await Bun.write(${JSON.stringify(nativeHeld)},'held');
while(!(await Bun.file(${JSON.stringify(allowStandaloneBudget)}).exists())) await Bun.sleep(10);
const nested=await acquireResourceLease({...identity,resource:'native-heavy',label:'standalone-native-budget',hostBudgetCapacity:4,hostBudgetOwnerId:'standalone-node-owner'});
await nested.release(); await outer.release();
await Bun.write(${JSON.stringify(standaloneCompleted)},'completed');`,
    );
    await waitFor(async () => await Bun.file(nativeHeld).exists(), 'standalone command did not hold native');

    const first = validationWorker('first-validation', firstAcquired, releaseFirst);
    await waitFor(
      async () => (await queuedLabels(root)).includes('first-validation-native'),
      'first validation did not queue on native first',
    );
    expect(await queuedLabels(root, 'validation-host-heavy')).toEqual([]);
    expect(await Bun.file(join(root, 'validation-class-native-heavy.owner.json')).exists()).toBeFalse();

    const second = validationWorker('second-validation', secondAcquired);
    await waitFor(
      async () => (await queuedLabels(root)).includes('second-validation-native'),
      'second validation did not queue transitively behind the first',
    );
    expect(await queuedLabels(root, 'validation-host-heavy')).toEqual([]);

    await writeFile(allowStandaloneBudget, 'continue\n');
    await waitFor(
      async () => await Bun.file(standaloneCompleted).exists(),
      'standalone command could not acquire host capacity after validation queued',
    );
    await waitFor(
      async () => await Bun.file(firstAcquired).exists(),
      'first validation did not acquire after standalone',
    );
    expect(await Bun.file(secondAcquired).exists()).toBeFalse();
    await writeFile(releaseFirst, 'release\n');
    await waitFor(
      async () => await Bun.file(secondAcquired).exists(),
      'second validation did not acquire in FIFO order',
    );

    await Promise.all([expectSuccessfulExit(standalone), expectSuccessfulExit(first), expectSuccessfulExit(second)]);
    expect(await Bun.file(join(root, 'native-heavy.lock')).exists()).toBeFalse();
    expect(await queuedLabels(root)).toEqual([]);
  }, 15_000);

  test('reaps a killed oldest waiter without skipping the next live ticket', async () => {
    const root = await temporaryRoot();
    const releaseHolder = join(root, 'release-holder');
    const holder = directLease(
      root,
      `const lease=await acquireResourceLease({resource:'native-heavy',label:'holder'});
while(!(await Bun.file(${JSON.stringify(releaseHolder)}).exists())) await Bun.sleep(10);
await lease.release();`,
    );
    await waitFor(
      async () => (await readFile(join(root, 'native-heavy.owner.json'), 'utf8').catch(() => '')).includes('holder'),
      'holder never acquired its lease',
    );
    const killed = directLease(
      root,
      `const lease=await acquireResourceLease({resource:'native-heavy',label:'killed-waiter',onQueued:()=>process.kill(process.pid,'SIGKILL')});await lease.release();`,
    );
    await killed.exited;
    await waitFor(async () => (await queuedLabels(root)).includes('killed-waiter'), 'killed waiter never queued');
    const follower = directLease(
      root,
      `const lease=await acquireResourceLease({resource:'native-heavy',label:'live-follower'});
console.log('follower-acquired');
await lease.release();`,
    );
    await waitFor(
      async () => (await queuedLabels(root)).includes('live-follower'),
      'live follower never queued',
      10_000,
    );
    await writeFile(releaseHolder, 'release\n');
    expect(await holder.exited).toBe(0);
    expect(await follower.exited).toBe(0);
    expect(await new Response(follower.stdout).text()).toContain('follower-acquired');
    expect(await queuedLabels(root)).toEqual([]);
    expect(await Bun.file(join(root, 'native-heavy.lock')).exists()).toBeFalse();
  }, 60_000);

  test('serializes heavy processes while an uncoordinated lightweight process still runs', async () => {
    const root = await temporaryRoot();
    const firstWorktree = join(root, 'first-worktree');
    const secondWorktree = join(root, 'second-worktree');
    const releaseFirst = join(root, 'release-first-heavy');
    await Promise.all([mkdir(firstWorktree), mkdir(secondWorktree)]);
    const first = coordinated(
      root,
      'first-heavy',
      `console.log('first-start '+Date.now()); while(!(await Bun.file(${JSON.stringify(releaseFirst)}).exists())) await Bun.sleep(10); console.log('first-end '+Date.now())`,
      firstWorktree,
    );
    await waitFor(
      async () =>
        (await readFile(join(root, 'native-heavy.owner.json'), 'utf8').catch(() => '')).includes('first-heavy'),
      'first heavy owner did not acquire native resource',
    );
    const second = coordinated(root, 'second-heavy', `console.log('second-start '+Date.now())`, secondWorktree);
    await waitFor(
      async () => (await queuedLabels(root)).includes('second-heavy'),
      'second worktree did not queue on native resource',
    );
    expect(await queuedLabels(root, 'validation-host-heavy')).not.toContain('host-budget:second-heavy');
    const hostOwners = await Promise.all(
      (await readdir(root))
        .filter((entry) => entry.startsWith('validation-host-heavy') && entry.endsWith('.owner.json'))
        .map(async (entry) => await readFile(join(root, entry), 'utf8')),
    );
    expect(hostOwners.some((owner) => owner.includes('host-budget:second-heavy'))).toBeFalse();
    const lightweightStartedAt = Date.now();
    const lightweight = trackChild(Bun.spawn(['bun', '-e', `await Bun.sleep(20)`]));
    expect(await lightweight.exited).toBe(0);
    expect(Date.now() - lightweightStartedAt).toBeLessThan(250);

    await writeFile(releaseFirst, 'release\n');
    await expectSuccessfulExit(first);
    await expectSuccessfulExit(second);
    const firstOutput = await new Response(first.stdout).text();
    const secondOutput = await new Response(second.stdout).text();
    const firstEnd = Number(firstOutput.match(/first-end (\d+)/)?.[1]);
    const secondStart = Number(secondOutput.match(/second-start (\d+)/)?.[1]);
    expect(secondOutput).toContain('second-heavy waiting for native-heavy: first-heavy pid=');
    expect(secondStart).toBeGreaterThanOrEqual(firstEnd);
  });

  test('recovers a stale owner and reports its identity', async () => {
    const root = await temporaryRoot();
    await seedStaleLock(root, 'interrupted-build');

    const successor = coordinated(root, 'successor', `console.log('successor-ran')`);
    expect(await successor.exited).toBe(0);
    const output = await new Response(successor.stdout).text();
    expect(output).toContain('successor recovered stale native-heavy: interrupted-build pid=2147483647');
    expect(output).toContain('successor-ran');
  });

  test('multiple stale waiters recover once without deleting the successor lease', async () => {
    const root = await temporaryRoot();
    await seedStaleLock(root, 'dead-owner');
    const first = coordinated(
      root,
      'first-successor',
      `console.log('first-start '+Date.now()); await Bun.sleep(120); console.log('first-end '+Date.now())`,
    );
    const second = coordinated(
      root,
      'second-successor',
      `console.log('second-start '+Date.now()); await Bun.sleep(120); console.log('second-end '+Date.now())`,
    );
    await expectSuccessfulExit(first);
    await expectSuccessfulExit(second);
    const outputs = [await new Response(first.stdout).text(), await new Response(second.stdout).text()];
    expect(outputs.some((output) => output.includes('recovered stale native-heavy'))).toBe(true);
    const intervals = outputs.map((output, index) => ({
      end: Number(output.match(new RegExp(`${index === 0 ? 'first' : 'second'}-end (\\d+)`))?.[1]),
      start: Number(output.match(new RegExp(`${index === 0 ? 'first' : 'second'}-start (\\d+)`))?.[1]),
    }));
    const firstInterval = intervals[0];
    const secondInterval = intervals[1];
    if (!firstInterval || !secondInterval) throw new Error('expected two successor intervals');
    expect(firstInterval.end <= secondInterval.start || secondInterval.end <= firstInterval.start).toBe(true);
  });

  test('a killed wrapper reaps its command before releasing the live lease', async () => {
    const root = await temporaryRoot();
    const orphanStartedPath = join(root, 'orphan-started');
    const commandPidPath = join(root, 'command-pid');
    await seedStaleLock(root, 'killed-recoverer');
    const interrupted = coordinated(
      root,
      'interrupted-successor',
      `await Bun.write(${JSON.stringify(commandPidPath)},String(process.pid));
await Bun.write(${JSON.stringify(orphanStartedPath)},'started');
while(true) await Bun.sleep(10);`,
    );
    await waitFor(
      async () =>
        (await readFile(join(root, 'native-heavy.owner.json'), 'utf8').catch(() => '')).includes(
          'interrupted-successor',
        ) && (await Bun.file(orphanStartedPath).exists()),
      'interrupted wrapper never acquired its lease',
      10_000,
    );
    const ownerPid = Number(JSON.parse(await readFile(join(root, 'native-heavy.owner.json'), 'utf8')).pid);
    const commandPid = Number(await readFile(commandPidPath, 'utf8'));
    interrupted.kill('SIGKILL');
    await interrupted.exited;
    const follower = coordinated(root, 'post-kill-follower', `console.log('follower-start '+Date.now())`);
    expect(await follower.exited).toBe(0);
    const followerOutput = await new Response(follower.stdout).text();
    expect(followerOutput).toMatch(
      /post-kill-follower (?:waiting for native-heavy:|recovered stale native-heavy:) interrupted-successor pid=/u,
    );
    await waitFor(
      async () => !processIsAlive(ownerPid) && !processIsAlive(commandPid),
      'supervisor did not reap its command after wrapper interruption',
    );
    expect(await Bun.file(join(root, 'native-heavy.lock')).exists()).toBeFalse();
  }, 15_000);

  test('a sentinel holder exits when its coordinator root disappears', async () => {
    const root = await temporaryRoot();
    const started = join(root, 'holder-started');
    const missingSentinel = join(root, 'never-created');
    const holder = directLease(
      root,
      `const lease=await acquireResourceLease({resource:'native-heavy',label:'root-guarded-holder'});
await Bun.write(${JSON.stringify(started)},'started');
while(!(await Bun.file(${JSON.stringify(missingSentinel)}).exists())) await Bun.sleep(10);
await lease.release();`,
    );
    await waitFor(async () => await Bun.file(started).exists(), 'root-guarded holder did not start');

    await rm(root, { recursive: true, force: true });

    expect(await holder.exited).toBe(143);
  });
});
