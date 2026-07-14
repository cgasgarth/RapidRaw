import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isolatedGitEnvironment } from '../../scripts/lib/ci/git-environment';
import {
  boundedToolIdentity,
  classifyProcessTermination,
  freezeValidationSnapshot,
  nodeCacheKey,
  planValidation,
  readCacheRecord,
  runValidation,
  validateManifest,
  validationOutputResource,
} from '../../scripts/validation/engine';
import { type ValidationNode, validationManifest } from '../../scripts/validation/manifest';
import { classesForPath } from '../../scripts/validation/ownership';

const initFixtureRepository = async (
  root: string,
  environment: NodeJS.ProcessEnv = process.env,
  injectedExitCode = 0,
): Promise<{ exitCode: number; stderr: string }> => {
  const child = Bun.spawn(['/bin/sh', '-c', `git init -q; exit ${injectedExitCode}`], {
    cwd: root,
    env: isolatedGitEnvironment(environment),
    stderr: 'pipe',
    stdout: 'ignore',
  });
  const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  return { exitCode, stderr };
};

describe('affected validation DAG', () => {
  test('classifies nonzero, signal, timeout, and possible OOM exits exactly', () => {
    expect(classifyProcessTermination(1, { interrupted: false, timedOut: false })).toEqual({
      reason: 'nonzero-exit',
    });
    expect(classifyProcessTermination(137, { interrupted: false, timedOut: false })).toEqual({
      reason: 'possible-oom-or-external-sigkill',
      signal: 'SIGKILL',
    });
    expect(classifyProcessTermination(143, { interrupted: false, timedOut: true })).toEqual({
      reason: 'timeout',
      signal: 'SIGTERM',
    });
  });
  test('concurrent fixture git children cannot rewrite parent config under hook-scoped variables or failure', async () => {
    const repositoryRoot = join(import.meta.dir, '../..');
    const commonDirectory = Bun.spawnSync(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: repositoryRoot,
      stdout: 'pipe',
    })
      .stdout.toString()
      .trim();
    const gitDirectory = Bun.spawnSync(['git', 'rev-parse', '--path-format=absolute', '--git-dir'], {
      cwd: repositoryRoot,
      stdout: 'pipe',
    })
      .stdout.toString()
      .trim();
    const readParentState = async () => ({
      bare: Bun.spawnSync(['git', 'config', '--local', '--get', 'core.bare'], {
        cwd: repositoryRoot,
        stdout: 'pipe',
      })
        .stdout.toString()
        .trim(),
      config: await readFile(join(commonDirectory, 'config')),
      gitDirectory: Bun.spawnSync(['git', 'rev-parse', '--path-format=absolute', '--git-dir'], {
        cwd: repositoryRoot,
        stdout: 'pipe',
      })
        .stdout.toString()
        .trim(),
      status: Bun.spawnSync(['git', 'status', '--porcelain=v1', '--untracked-files=no'], {
        cwd: repositoryRoot,
        stdout: 'pipe',
      }).stdout.toString(),
    });
    const before = await readParentState();
    const successFixture = await mkdtemp(join(tmpdir(), 'rapidraw-isolated-git-success-'));
    const independentFixture = await mkdtemp(join(tmpdir(), 'rapidraw-isolated-git-concurrent-'));
    const failedFixture = await mkdtemp(join(tmpdir(), 'rapidraw-isolated-git-failure-'));
    const hookEnvironment = { ...process.env, GIT_DIR: commonDirectory, GIT_WORK_TREE: repositoryRoot };
    try {
      const [success, independent, failed] = await Promise.all([
        initFixtureRepository(successFixture, hookEnvironment),
        initFixtureRepository(independentFixture),
        initFixtureRepository(failedFixture, hookEnvironment, 23),
      ]);
      expect(success).toEqual({ exitCode: 0, stderr: '' });
      expect(independent).toEqual({ exitCode: 0, stderr: '' });
      expect(failed).toEqual({ exitCode: 23, stderr: '' });
      for (const fixture of [successFixture, independentFixture, failedFixture]) {
        expect(
          Bun.spawnSync(['git', 'config', '--get', 'core.bare'], {
            cwd: fixture,
            env: isolatedGitEnvironment(),
            stdout: 'pipe',
          })
            .stdout.toString()
            .trim(),
        ).toBe('false');
      }
    } finally {
      await Promise.all(
        [successFixture, independentFixture, failedFixture].map((fixture) => rm(fixture, { recursive: true })),
      );
    }
    const after = await readParentState();
    expect(after.bare).toBe('false');
    expect(after.bare).toBe(before.bare);
    expect(after.config.equals(before.config)).toBeTrue();
    expect(after.gitDirectory).toBe(gitDirectory);
    expect(after.gitDirectory).toBe(before.gitDirectory);
    expect(after.status).toBe(before.status);
  });

  test.each([
    [['docs/guide.md'], ['docs', 'format'], ['rust-clippy', 'bundle-build']],
    [['src/components/Editor.tsx'], ['typecheck', 'unit', 'lint'], ['rust-clippy']],
    [['src-tauri/src/lib.rs'], ['rustfmt', 'rust-clippy', 'native-boundaries'], ['bundle-build']],
    [['.github/workflows/lint.yml'], ['actions', 'action-pins', 'format'], ['rust-clippy']],
    [['src-tauri/Cargo.lock'], ['rust-clippy', 'license-rust', 'native-leaves'], ['docs']],
  ])('classifies %p conservatively', (paths, included, excluded) => {
    const plan = planValidation(validationManifest, 'commit', paths);
    const selected = new Set(plan.filter((entry) => entry.selected).map((entry) => entry.node.id));
    for (const id of included) expect(selected.has(id)).toBeTrue();
    for (const id of excluded) expect(selected.has(id)).toBeFalse();
  });

  test('dependency closure selects the shared producer once', () => {
    const plan = planValidation(validationManifest, 'push', ['src/App.tsx']);
    expect(plan.filter((entry) => entry.node.id === 'bundle-build' && entry.selected)).toHaveLength(1);
    expect(plan.find((entry) => entry.node.id === 'bundle-proof')?.selected).toBeTrue();
  });

  test('manifest rejects missing dependency edges', () => {
    const node: ValidationNode = {
      id: 'consumer',
      command: ['true'],
      dependencies: ['missing'],
      inputs: ['scripts'],
      resourceClass: 'light',
      cachePolicy: 'local',
      modes: ['commit'],
      timeoutMs: 1000,
    };
    expect(() => validateManifest([node])).toThrow('validation dependency missing');
  });

  test('ownership propagates schema and dependency changes through consumers', () => {
    expect(classesForPath('packages/rawengine-schema/src/index.ts')).toEqual(
      expect.arrayContaining(['schema', 'frontend']),
    );
    expect(classesForPath('src-tauri/Cargo.lock')).toEqual(
      expect.arrayContaining(['dependencies', 'rust', 'frontend']),
    );
  });

  test('content, command, environment, and dependency identities invalidate keys', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rapidraw-validation-'));
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src', 'value.ts'), 'export const value = 1;\n');
    const base: ValidationNode = {
      id: 'test',
      command: ['bun', 'test'],
      dependencies: [],
      inputs: ['frontend'],
      resourceClass: 'light',
      cachePolicy: 'local',
      modes: ['commit'],
      timeoutMs: 1000,
    };
    const first = await nodeCacheKey(base, root, ['dependency-a']);
    await writeFile(join(root, 'src', 'value.ts'), 'export const value = 2;\n');
    const content = await nodeCacheKey(base, root, ['dependency-a']);
    const command = await nodeCacheKey({ ...base, command: ['bun', 'test', '--rerun'] }, root, ['dependency-a']);
    const dependency = await nodeCacheKey(base, root, ['dependency-b']);
    expect(new Set([first, content, command, dependency]).size).toBe(4);
  });

  test('corrupt, mismatched, and expired cache records are ignored', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rapidraw-validation-cache-'));
    const record = join(root, 'record.json');
    await writeFile(record, '{broken');
    expect(await readCacheRecord(record, 'key')).toBeUndefined();
    await writeFile(
      record,
      JSON.stringify({
        key: 'key',
        node: 'test',
        durationMs: 1,
        status: 'success',
        outputDigest: 'digest',
        artifacts: {},
        createdAt: new Date(0).toISOString(),
      }),
    );
    expect(await readCacheRecord(record, 'other')).toBeUndefined();
    expect(await readCacheRecord(record, 'key', 1000)).toBeUndefined();
  });

  test('frozen snapshot excludes declared output roots but detects adjacent source mutation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rapidraw-validation-snapshot-'));
    await mkdir(join(root, 'private-artifacts'), { recursive: true });
    await writeFile(join(root, 'source.ts'), 'export const source = 1;\n');
    await writeFile(join(root, 'private-artifacts', 'receipt.json'), '{"revision":1}\n');
    const initial = await freezeValidationSnapshot(root);
    await writeFile(join(root, 'private-artifacts', 'receipt.json'), '{"revision":2}\n');
    expect((await freezeValidationSnapshot(root)).identity).toBe(initial.identity);
    await writeFile(join(root, 'source.ts'), 'export const source = 2;\n');
    expect((await freezeValidationSnapshot(root)).identity).not.toBe(initial.identity);
  });

  test('toolchain identity fails closed within a bounded probe budget', () => {
    const startedAt = performance.now();
    expect(boundedToolIdentity('stalled', ['/bin/sh', '-c', 'sleep 30'], 25)).toBe('stalled:timeout:');
    expect(performance.now() - startedAt).toBeLessThan(500);
  });

  test('shared producer artifact is generated once and reused by its consumer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rapidraw-validation-artifact-'));
    initFixtureRepository(root);
    await writeFile(join(root, 'input.ts'), 'export const input = true;\n');
    const producer: ValidationNode = {
      id: 'producer',
      command: [
        'bun',
        '-e',
        "const f=Bun.file('dist/artifact');if(await f.exists())process.exit(9);await Bun.write(f,'proof')",
      ],
      dependencies: [],
      inputs: ['frontend'],
      outputs: ['dist'],
      resourceClass: 'light',
      cachePolicy: 'local',
      modes: ['commit'],
      timeoutMs: 5000,
    };
    const consumer: ValidationNode = {
      ...producer,
      id: 'consumer',
      command: ['bun', '-e', "if(!(await Bun.file('dist/artifact').exists()))process.exit(8)"],
      dependencies: ['producer'],
      outputs: [],
    };
    const options = {
      mode: 'commit' as const,
      changedPaths: ['input.ts'],
      noCache: false,
      verifyCache: false,
      explainCache: false,
      root,
      resourceCoordinatorRoot: join(root, 'locks'),
    };
    expect(await runValidation([producer, consumer], options)).toBe(0);
    expect(await runValidation([producer, consumer], options)).toBe(0);
    await writeFile(join(root, 'dist', 'artifact'), 'croof');
    expect(await runValidation([producer, consumer], options)).toBe(1);
  });

  test('timeout kills grandchildren and releases the shared resource-class lease', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rapidraw-validation-cancel-'));
    initFixtureRepository(root);
    await writeFile(join(root, 'input.rs'), 'fn input() {}\n');
    const timeoutNode: ValidationNode = {
      id: 'timeout-native',
      command: ['/bin/sh', '-c', 'mkdir -p dist; sleep 30 & echo $! > dist/grandchild.pid; wait'],
      dependencies: [],
      inputs: ['rust'],
      resourceClass: 'native-heavy',
      cachePolicy: 'none',
      modes: ['commit'],
      timeoutMs: 100,
    };
    const options = {
      mode: 'commit' as const,
      changedPaths: ['input.rs'],
      noCache: true,
      verifyCache: false,
      explainCache: false,
      root,
      resourceCoordinatorRoot: join(root, 'locks'),
    };
    expect(await runValidation([timeoutNode], options)).toBe(1);
    const grandchild = Number((await readFile(join(root, 'dist', 'grandchild.pid'), 'utf8')).trim());
    await Bun.sleep(100);
    expect(() => process.kill(grandchild, 0)).toThrow();
    expect(
      await runValidation(
        [{ ...timeoutNode, id: 'next-native', command: ['/usr/bin/true'], timeoutMs: 1000 }],
        options,
      ),
    ).toBe(0);
  });

  test('separate worktree processes contend on one stable native-heavy class lease', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rapidraw-validation-contention-'));
    const firstWorktree = join(root, 'one');
    const secondWorktree = join(root, 'two');
    await mkdir(firstWorktree);
    await mkdir(secondWorktree);
    const coordinator = join(root, 'locks');
    const modulePath = join(import.meta.dir, '../../scripts/lib/ci/resource-coordinator.ts');
    const script = `import { acquireResourceLease } from ${JSON.stringify(modulePath)};
const started=Date.now();
const lease=await acquireResourceLease({resource:'validation-class-native-heavy',label:process.cwd(),pollMs:10});
console.log(JSON.stringify({waitedMs:Date.now()-started}));
await Bun.sleep(180);
await lease.release();`;
    const env = { ...process.env, RAWENGINE_RESOURCE_COORDINATOR_ROOT: coordinator };
    const first = Bun.spawn(['bun', '-e', script], { cwd: firstWorktree, env, stdout: 'pipe', stderr: 'pipe' });
    await Bun.sleep(25);
    const second = Bun.spawn(['bun', '-e', script], { cwd: secondWorktree, env, stdout: 'pipe', stderr: 'pipe' });
    const [firstOutput, secondOutput, firstExit, secondExit] = await Promise.all([
      new Response(first.stdout).text(),
      new Response(second.stdout).text(),
      first.exited,
      second.exited,
    ]);
    expect([firstExit, secondExit]).toEqual([0, 0]);
    const receipt = JSON.parse(secondOutput.trim().split('\n').at(-1) ?? '{}') as { waitedMs: number };
    expect(firstOutput).toContain('"waitedMs"');
    expect(receipt.waitedMs).toBeGreaterThanOrEqual(120);
  });

  test('full unit suites are exclusive across worktrees while other CPU work stays parallel', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rapidraw-validation-suite-exclusive-'));
    const firstWorktree = join(root, 'one');
    const secondWorktree = join(root, 'two');
    const coordinator = join(root, 'locks');
    const sentinel = join(root, 'shared-suite-state');
    await Promise.all([mkdir(firstWorktree), mkdir(secondWorktree)]);
    await Promise.all([
      writeFile(join(firstWorktree, 'input.ts'), 'export const input = 1;\n'),
      writeFile(join(secondWorktree, 'input.ts'), 'export const input = 2;\n'),
    ]);
    const command = [
      'bun',
      '-e',
      `import {rm} from 'node:fs/promises';const p=${JSON.stringify(sentinel)};if(await Bun.file(p).exists())process.exit(9);await Bun.write(p,String(process.pid));await Bun.sleep(180);await rm(p,{force:true})`,
    ];
    const suite: ValidationNode = {
      id: 'unit-suite',
      command,
      dependencies: [],
      inputs: ['frontend'],
      resourceClass: 'suite-exclusive',
      cachePolicy: 'none',
      modes: ['commit'],
      timeoutMs: 2_000,
    };
    const options = (worktree: string) => ({
      mode: 'commit' as const,
      changedPaths: ['input.ts'],
      noCache: true,
      verifyCache: false,
      explainCache: false,
      root: worktree,
      resourceCoordinatorRoot: coordinator,
    });
    const first = runValidation([suite], options(firstWorktree));
    await Bun.sleep(25);
    const second = runValidation([suite], options(secondWorktree));
    expect(await Promise.all([first, second])).toEqual([0, 0]);
    expect(validationManifest.find((node) => node.id === 'unit')?.resourceClass).toBe('suite-exclusive');
  });

  test('producer outputs are worktree-scoped and serialized only for the same worktree', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rapidraw-validation-producer-ownership-'));
    const sameWorktree = join(root, 'same');
    const parallelWorktrees = [join(root, 'one'), join(root, 'two'), join(root, 'three')];
    const coordinator = join(root, 'locks');
    await mkdir(sameWorktree);
    await Promise.all(parallelWorktrees.map((worktree) => mkdir(worktree)));
    await Promise.all(
      [sameWorktree, ...parallelWorktrees].map(async (worktree) => {
        await writeFile(join(worktree, 'input.ts'), 'export const input = true;\n');
        await initFixtureRepository(worktree);
      }),
    );
    const producer: ValidationNode = {
      id: 'producer-output',
      command: [
        'bun',
        '-e',
        "import {mkdir} from 'node:fs/promises';const path='dist/artifact';await mkdir('dist',{recursive:true});if(await Bun.file(path).exists())process.exit(9);await Bun.write(path,String(process.pid));await Bun.sleep(120);await Bun.file(path).delete()",
      ],
      dependencies: [],
      inputs: ['frontend'],
      resourceClass: 'light',
      cachePolicy: 'none',
      modes: ['commit'],
      timeoutMs: 2_000,
      outputs: ['dist'],
    };
    const options = (worktree: string) => ({
      mode: 'commit' as const,
      changedPaths: ['input.ts'],
      noCache: true,
      verifyCache: false,
      explainCache: false,
      root: worktree,
      resourceCoordinatorRoot: coordinator,
    });

    expect(
      await Promise.all([
        runValidation([producer], options(sameWorktree)),
        runValidation([producer], options(sameWorktree)),
      ]),
    ).toEqual([0, 0]);
    const startedAt = performance.now();
    expect(
      await Promise.all(parallelWorktrees.map((worktree) => runValidation([producer], options(worktree)))),
    ).toEqual([0, 0, 0]);
    expect(validationOutputResource(parallelWorktrees[0], 'dist')).not.toBe(
      validationOutputResource(parallelWorktrees[1], 'dist'),
    );
    expect(performance.now() - startedAt).toBeLessThan(1_200);
  });

  test('commit failure preserves an independent active node disposition and returns deterministic nonzero', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rapidraw-validation-fail-fast-'));
    initFixtureRepository(root);
    await writeFile(join(root, 'input.ts'), 'export const input = true;\n');
    const base: ValidationNode = {
      id: 'fail',
      command: ['/bin/sh', '-c', 'sleep 0.05; exit 7'],
      dependencies: [],
      inputs: ['frontend'],
      resourceClass: 'light',
      cachePolicy: 'none',
      modes: ['commit'],
      timeoutMs: 2000,
    };
    const slow: ValidationNode = {
      ...base,
      id: 'slow',
      command: ['/bin/sh', '-c', 'mkdir -p dist; sleep 0.15; touch dist/independent-completed'],
    };
    const result = await runValidation([base, slow], {
      mode: 'commit',
      changedPaths: ['input.ts'],
      noCache: true,
      verifyCache: false,
      explainCache: false,
      root,
      resourceCoordinatorRoot: join(root, 'locks'),
    });
    expect(result).toBe(1);
    expect(await Bun.file(join(root, 'dist', 'independent-completed')).exists()).toBeTrue();
  });

  test('failed child diagnostics retain bounded stdout, stderr, exit, signal, RSS, and reason', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rapidraw-validation-diagnostics-'));
    initFixtureRepository(root);
    await writeFile(join(root, 'input.ts'), 'export const input = true;\n');
    const enginePath = join(import.meta.dir, '../../scripts/validation/engine.ts');
    const script = `import { runValidation } from ${JSON.stringify(enginePath)};
const node={id:'diagnostic',command:['/bin/sh','-c','echo retained-stdout; echo retained-stderr >&2; exit 23'],dependencies:[],inputs:['frontend'],resourceClass:'light',cachePolicy:'none',modes:['commit'],timeoutMs:5000};
process.exit(await runValidation([node],{mode:'commit',changedPaths:['input.ts'],noCache:true,verifyCache:false,explainCache:false,root:process.cwd(),resourceCoordinatorRoot:process.cwd()+'/locks'}));`;
    const child = Bun.spawn(['bun', '-e', script], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
    const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('exit=23 signal=none termination=nonzero-exit');
    expect(stderr).toMatch(/cpu=\d+ms rss=\d+/u);
    expect(stderr).toContain('retained-stdout');
    expect(stderr).toContain('retained-stderr');
  });

  test('SIGINT exits 130, kills the process group, and leaves no resource lease', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rapidraw-validation-sigint-'));
    initFixtureRepository(root);
    await writeFile(join(root, 'input.rs'), 'fn input() {}\n');
    const enginePath = join(import.meta.dir, '../../scripts/validation/engine.ts');
    const script = `import { runValidation } from ${JSON.stringify(enginePath)};
const node={id:'signal',command:['/bin/sh','-c','sleep 30'],dependencies:[],inputs:['rust'],resourceClass:'native-heavy',cachePolicy:'none',modes:['commit'],timeoutMs:60000};
setTimeout(()=>process.kill(process.pid,'SIGINT'),100);
const code=await runValidation([node],{mode:'commit',changedPaths:['input.rs'],noCache:true,verifyCache:false,explainCache:false,root:process.cwd(),resourceCoordinatorRoot:process.cwd()+'/locks'});
process.exit(code);`;
    const child = Bun.spawn(['bun', '-e', script], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
    expect(await child.exited).toBe(130);
    const lockRoot = join(root, 'locks');
    expect(await readdir(lockRoot).catch(() => [])).toEqual([]);
  }, 10_000);
});
