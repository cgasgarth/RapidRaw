import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  nodeCacheKey,
  planValidation,
  readCacheRecord,
  runValidation,
  validateManifest,
} from '../../scripts/validation/engine';
import { type ValidationNode, validationManifest } from '../../scripts/validation/manifest';
import { classesForPath } from '../../scripts/validation/ownership';

const isolatedGitEnvironment = (): Record<string, string> =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => !entry[0].startsWith('GIT_') && entry[1] !== undefined,
    ),
  );
const initFixtureRepository = (root: string): void => {
  const result = Bun.spawnSync(['git', 'init', '-q'], { cwd: root, env: isolatedGitEnvironment(), stderr: 'pipe' });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
};

describe('affected validation DAG', () => {
  test('fixture git init cannot rewrite the real worktree config under hook-scoped Git variables', async () => {
    const repositoryRoot = join(import.meta.dir, '../..');
    const commonDirectory = Bun.spawnSync(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: repositoryRoot,
      stdout: 'pipe',
    })
      .stdout.toString()
      .trim();
    const before = Bun.spawnSync(['git', 'config', '--local', '--get', 'core.bare'], {
      cwd: repositoryRoot,
      stdout: 'pipe',
    })
      .stdout.toString()
      .trim();
    const priorDir = process.env.GIT_DIR;
    const priorWorkTree = process.env.GIT_WORK_TREE;
    process.env.GIT_DIR = commonDirectory;
    process.env.GIT_WORK_TREE = repositoryRoot;
    try {
      const fixture = await mkdtemp(join(tmpdir(), 'rapidraw-isolated-git-init-'));
      initFixtureRepository(fixture);
      expect(
        Bun.spawnSync(['git', 'config', '--get', 'core.bare'], {
          cwd: fixture,
          env: isolatedGitEnvironment(),
          stdout: 'pipe',
        })
          .stdout.toString()
          .trim(),
      ).toBe('false');
    } finally {
      if (priorDir === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = priorDir;
      if (priorWorkTree === undefined) delete process.env.GIT_WORK_TREE;
      else process.env.GIT_WORK_TREE = priorWorkTree;
    }
    const after = Bun.spawnSync(['git', 'config', '--local', '--get', 'core.bare'], {
      cwd: repositoryRoot,
      stdout: 'pipe',
    })
      .stdout.toString()
      .trim();
    expect(after).toBe(before);
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

  test('commit failure cancels an independent active node and returns deterministic nonzero', async () => {
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
      command: ['/bin/sh', '-c', 'mkdir -p dist; sleep 5; touch dist/should-not-exist'],
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
    expect(await Bun.file(join(root, 'dist', 'should-not-exist')).exists()).toBeFalse();
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
