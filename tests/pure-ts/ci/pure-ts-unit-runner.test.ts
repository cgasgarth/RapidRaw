import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runPureTsUnitShards, selectPureTsFailureContext } from '../../../scripts/ci/run-pure-ts-unit';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

const temporaryRoot = async (label: string): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), `rapidraw-${label}-`));
  temporaryRoots.push(root);
  return root;
};

const signalProcessGroup = (pid: number, signal: 'SIGTERM' | 'SIGKILL'): void => {
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // The child already exited.
    }
  }
};

const processIsAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const writeProcessBudgetFixture = async (root: string, countRoot: string, files: number): Promise<void> => {
  await mkdir(countRoot, { recursive: true });
  for (let index = 0; index < files; index += 1) {
    await writeFile(
      join(root, `budget-${String(index)}.test.ts`),
      `import { expect, test } from 'bun:test';
const countRoot=Bun.env.RAWENGINE_TEST_PROCESS_COUNT_ROOT;
if(countRoot===undefined)throw new Error('missing process count root');
const countPath=countRoot+'/'+String(process.pid);
const previous=Number((await Bun.file(countPath).text().catch(()=>'0')).trim());
await Bun.write(countPath,String(previous+1));
if(previous+1>2)for(;;)Math.sqrt(Math.random());
test('budget ${String(index)}',()=>expect(previous+1).toBeLessThanOrEqual(2));
`,
    );
  }
};

describe('pure TypeScript unit runner', () => {
  test('retains the assertion and test location when compacting noisy shard diagnostics', () => {
    const output = [
      ...Array.from({ length: 40 }, (_, index) => `leading noise ${String(index)}`),
      'error: expect(received).toBe(expected)',
      '      at <anonymous> (/repo/tests/pure-ts/example.test.ts:42:11)',
      '(fail) example contract',
      ...Array.from({ length: 40 }, (_, index) => `trailing noise ${String(index)}`),
    ].join('\n');
    const context = selectPureTsFailureContext(output);
    expect(context).toContain('error: expect(received).toBe(expected)');
    expect(context).toContain('/repo/tests/pure-ts/example.test.ts:42:11');
    expect(context).toContain('(fail) example contract');
    expect(context).not.toContain('leading noise 0');
    expect(context).not.toContain('trailing noise 39');
  });

  test('shards file-process accumulation without reducing total worker concurrency', async () => {
    const root = await temporaryRoot('unit-shard-process-budget');
    const tests = join(root, 'tests');
    const countRoot = join(root, 'counts');
    await mkdir(tests);
    await writeProcessBudgetFixture(tests, countRoot, 4);
    const monolith = Bun.spawn(['bun', 'test', '--no-orphans', '--isolate', '--reporter=dot', tests], {
      detached: true,
      env: { ...process.env, RAWENGINE_TEST_PROCESS_COUNT_ROOT: countRoot },
      stderr: 'pipe',
      stdout: 'pipe',
    });
    let monolithTimedOut = false;
    const timeout = setTimeout(() => {
      monolithTimedOut = true;
      signalProcessGroup(monolith.pid, 'SIGTERM');
    }, 350);
    const monolithExit = await monolith.exited;
    clearTimeout(timeout);
    expect(monolithTimedOut, `monolithic fixture unexpectedly exited ${String(monolithExit)}`).toBeTrue();
    await rm(countRoot, { force: true, recursive: true });
    await mkdir(countRoot);

    const results = await runPureTsUnitShards({
      env: { RAWENGINE_TEST_PROCESS_COUNT_ROOT: countRoot },
      shardCount: 2,
      shardTimeoutMs: 2_000,
      target: tests,
      workersPerShard: 1,
    });
    expect(results.map(({ exitCode }) => exitCode)).toEqual([0, 0]);
    expect(results.every(({ timedOut }) => !timedOut)).toBeTrue();
    expect(await readdir(countRoot)).toHaveLength(2);
  }, 10_000);

  test('terminates a CPU-runaway shard on its independent bound with failure diagnostics intact', async () => {
    const root = await temporaryRoot('unit-shard-timeout');
    await writeFile(join(root, 'runaway.test.ts'), 'for(;;)Math.sqrt(Math.random());\n');
    const [result] = await runPureTsUnitShards({
      shardCount: 1,
      shardTimeoutMs: 250,
      target: root,
      workersPerShard: 1,
    });
    expect(result).toBeDefined();
    if (result === undefined) throw new Error('missing shard result');
    expect(result.timedOut).toBeTrue();
    expect(result.exitCode).not.toBe(0);
    expect(result.durationMs).toBeLessThan(2_000);
    expect(processIsAlive(result.pid)).toBeFalse();
  }, 5_000);
});
