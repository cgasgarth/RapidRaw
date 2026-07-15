import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireResourceLease } from '../../../scripts/lib/ci/resource-coordinator';

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

const directLease = (root: string, script: string, cwd?: string) => {
  const modulePath = join(import.meta.dir, '../../../scripts/lib/ci/resource-coordinator.ts');
  const lifecycle = `const {existsSync}=await import('node:fs');
const lifecycleParent=Number(Bun.env.RAWENGINE_TEST_PARENT_PID);
const lifecycleRoot=${JSON.stringify(root)};
const lifecycle=setInterval(()=>{try{process.kill(lifecycleParent,0)}catch{process.exit(143)}if(!existsSync(lifecycleRoot))process.exit(143)},25);
lifecycle.unref();
try{${script}}finally{clearInterval(lifecycle)}`;
  return trackChild(
    Bun.spawn(['bun', '-e', `import { acquireResourceLease } from ${JSON.stringify(modulePath)};${lifecycle}`], {
      env: {
        ...Bun.env,
        RAWENGINE_RESOURCE_OWNER_ID: crypto.randomUUID(),
        RAWENGINE_RESOURCE_COORDINATOR_ROOT: root,
        RAWENGINE_RESOURCE_WAIT_POLL_MS: '10',
        RAWENGINE_TEST_PARENT_PID: String(process.pid),
      },
      cwd,
      stderr: 'pipe',
      stdout: 'pipe',
    }),
  );
};

const expectSuccessfulExit = async (child: ReturnType<typeof Bun.spawn>): Promise<void> => {
  const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  expect(exitCode, stderr).toBe(0);
};

const coordinated = (root: string, label: string, script: string) =>
  trackChild(
    Bun.spawn(
      [
        'bun',
        'scripts/ci/run-resource-coordinated.ts',
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
        `const outer=await acquireResourceLease({resource:'native-heavy',label:'precommit-${index}:native-build'});
const nested=await acquireResourceLease({resource:'native-heavy',label:'precommit-${index}:performance-bisect'});
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
      `const lease=await acquireResourceLease({resource:'native-heavy',label:'killed-waiter'});await lease.release();`,
    );
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
    killed.kill('SIGKILL');
    await killed.exited;
    await writeFile(releaseHolder, 'release\n');
    expect(await holder.exited).toBe(0);
    expect(await follower.exited).toBe(0);
    expect(await new Response(follower.stdout).text()).toContain('follower-acquired');
    expect(await queuedLabels(root)).toEqual([]);
    expect(await Bun.file(join(root, 'native-heavy.lock')).exists()).toBeFalse();
  }, 15_000);

  test('serializes heavy processes while an uncoordinated lightweight process still runs', async () => {
    const root = await temporaryRoot();
    const first = coordinated(
      root,
      'first-heavy',
      `console.log('first-start '+Date.now()); await Bun.sleep(350); console.log('first-end '+Date.now())`,
    );
    await Bun.sleep(60);
    const second = coordinated(root, 'second-heavy', `console.log('second-start '+Date.now())`);
    const lightweightStartedAt = Date.now();
    const lightweight = trackChild(Bun.spawn(['bun', '-e', `await Bun.sleep(20)`]));
    expect(await lightweight.exited).toBe(0);
    expect(Date.now() - lightweightStartedAt).toBeLessThan(250);

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
