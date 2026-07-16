import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isolatedGitEnvironment } from '../../scripts/lib/ci/git-environment';
import { acquireResourceLease } from '../../scripts/lib/ci/resource-coordinator';
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

const spawnNestedOutputValidation = (options: {
  coordinator: string;
  ownerId: string;
  repetitions: number;
  root: string;
  waitTimeoutMs?: number;
}) => {
  const coordinatorPath = join(import.meta.dir, '../../scripts/lib/ci/resource-coordinator.ts');
  const enginePath = join(import.meta.dir, '../../scripts/validation/engine.ts');
  const script = `import { acquireResourceLease } from ${JSON.stringify(coordinatorPath)};
import { runValidation, validationOutputResource } from ${JSON.stringify(enginePath)};
const root=${JSON.stringify(options.root)};
const coordinator=${JSON.stringify(options.coordinator)};
const outer=await acquireResourceLease({label:'outer-validation-output',resource:validationOutputResource(root,'dist'),root:coordinator});
try {
  for(let index=0;index<${String(options.repetitions)};index+=1){
    const node={id:'nested-output-'+index,command:['bun','-e',"await Bun.write('dist/artifact',Bun.env.RAWENGINE_RESOURCE_OWNER_ID??'missing')"],dependencies:[],inputs:['frontend'],resourceClass:'light',cachePolicy:'none',modes:['commit'],timeoutMs:2000,outputs:['dist']};
    const exitCode=await runValidation([node],{mode:'commit',changedPaths:['input.ts'],noCache:true,verifyCache:false,explainCache:false,root,resourceCoordinatorRoot:coordinator});
    if(exitCode!==0)process.exit(23);
  }
  console.log('nested-output-complete '+outer.ownerId);
}finally{await outer.release();}`;
  return Bun.spawn(['bun', '-e', script], {
    cwd: options.root,
    env: {
      ...process.env,
      RAWENGINE_RESOURCE_COORDINATOR_ROOT: options.coordinator,
      RAWENGINE_RESOURCE_OWNER_ID: options.ownerId,
      RAWENGINE_RESOURCE_OWNER_ROOT: options.coordinator,
      RAWENGINE_RESOURCE_WAIT_POLL_MS: '10',
      RAWENGINE_RESOURCE_WAIT_TIMEOUT_MS: String(options.waitTimeoutMs ?? 250),
    },
    stderr: 'pipe',
    stdout: 'pipe',
  });
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
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'rapidraw-parent-git-invariants-'));
    const parentRepository = join(fixtureRoot, 'parent');
    const repositoryRoot = join(fixtureRoot, 'linked-worktree');
    const successFixture = join(fixtureRoot, 'isolated-success');
    const independentFixture = join(fixtureRoot, 'isolated-concurrent');
    const failedFixture = join(fixtureRoot, 'isolated-failure');
    await Promise.all(
      [parentRepository, successFixture, independentFixture, failedFixture].map((directory) =>
        mkdir(directory, { recursive: true }),
      ),
    );

    const fixtureGit = (cwd: string, arguments_: string[]) =>
      Bun.spawnSync(['git', ...arguments_], {
        cwd,
        env: isolatedGitEnvironment(),
        stderr: 'pipe',
        stdout: 'pipe',
      });
    const gitText = (cwd: string, arguments_: string[]): string => {
      const result = fixtureGit(cwd, arguments_);
      if (result.exitCode !== 0)
        throw new Error(`git ${arguments_.join(' ')} failed: ${result.stderr.toString().trim()}`);
      return result.stdout.toString().trim();
    };

    expect(await initFixtureRepository(parentRepository)).toEqual({ exitCode: 0, stderr: '' });
    expect(fixtureGit(parentRepository, ['config', '--local', 'core.hooksPath', '.githooks']).exitCode).toBe(0);
    expect(fixtureGit(parentRepository, ['config', '--local', 'core.fsmonitor', 'false']).exitCode).toBe(0);
    expect(
      fixtureGit(parentRepository, [
        '-c',
        'user.name=Validation Fixture',
        '-c',
        'user.email=validation@example.test',
        'commit',
        '--allow-empty',
        '-qm',
        'fixture base',
      ]).exitCode,
    ).toBe(0);
    expect(
      fixtureGit(parentRepository, ['worktree', 'add', '-q', '-b', 'fixture-linked', repositoryRoot]).exitCode,
    ).toBe(0);

    const readOptionalConfig = (key: string): string | undefined => {
      const result = fixtureGit(repositoryRoot, ['config', '--local', '--get', key]);
      if (result.exitCode === 1) return undefined;
      if (result.exitCode !== 0) throw new Error(`git config ${key} failed: ${result.stderr.toString().trim()}`);
      return result.stdout.toString().trim();
    };
    const readParentState = async () => ({
      bare: readOptionalConfig('core.bare'),
      commonDirectory: gitText(repositoryRoot, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
      fsmonitor: readOptionalConfig('core.fsmonitor'),
      gitDirectory: gitText(repositoryRoot, ['rev-parse', '--path-format=absolute', '--git-dir']),
      gitFile: await readFile(join(repositoryRoot, '.git'), 'utf8'),
      hooksPath: readOptionalConfig('core.hooksPath'),
      status: gitText(repositoryRoot, ['status', '--porcelain=v1', '--untracked-files=no']),
      topLevel: gitText(repositoryRoot, ['rev-parse', '--path-format=absolute', '--show-toplevel']),
      unrelatedBranchMerge: readOptionalConfig('branch.concurrent-worker.merge'),
      unrelatedBranchRemote: readOptionalConfig('branch.concurrent-worker.remote'),
    });
    const before = await readParentState();
    const commonConfigBefore = await readFile(join(before.commonDirectory, 'config'));
    expect(before).toMatchObject({
      bare: 'false',
      fsmonitor: 'false',
      hooksPath: '.githooks',
      status: '',
      topLevel: await realpath(repositoryRoot),
      unrelatedBranchMerge: undefined,
      unrelatedBranchRemote: undefined,
    });
    expect(before.gitDirectory.startsWith(`${before.commonDirectory}/worktrees/`)).toBeTrue();
    expect(before.gitFile.trim()).toBe(`gitdir: ${before.gitDirectory}`);
    const hookEnvironment = {
      ...process.env,
      GIT_DIR: before.gitDirectory,
      GIT_INDEX_FILE: join(before.gitDirectory, 'index'),
      GIT_PREFIX: '',
      GIT_WORK_TREE: repositoryRoot,
    };

    const spawnGatedFixtureRepository = (
      root: string,
      environment: NodeJS.ProcessEnv = process.env,
      injectedExitCode = 0,
    ) => {
      const child = Bun.spawn(
        ['/bin/sh', '-c', `printf 'ready\\n'; IFS= read -r _; git init -q; exit ${injectedExitCode}`],
        {
          cwd: root,
          env: isolatedGitEnvironment(environment),
          stderr: 'pipe',
          stdin: 'pipe',
          stdout: 'pipe',
        },
      );
      const stdoutReader = child.stdout.getReader();
      const ready = (async () => {
        const chunk = await stdoutReader.read();
        stdoutReader.releaseLock();
        if (chunk.done || new TextDecoder().decode(chunk.value).trim() !== 'ready')
          throw new Error('fixture git child did not reach its deterministic release barrier');
      })();
      const result = Promise.all([child.exited, new Response(child.stderr).text()]).then(([exitCode, stderr]) => ({
        exitCode,
        stderr,
      }));
      return {
        child,
        ready,
        release: () => {
          child.stdin.write('run\n');
          child.stdin.end();
        },
        result,
      };
    };

    const success = spawnGatedFixtureRepository(successFixture, hookEnvironment);
    const independent = spawnGatedFixtureRepository(independentFixture);
    const failed = spawnGatedFixtureRepository(failedFixture, hookEnvironment, 23);
    const children = [success, independent, failed];
    try {
      await Promise.all(children.map((child) => child.ready));
      success.release();
      expect(await success.result).toEqual({ exitCode: 0, stderr: '' });

      // Exact interleaving: one synthetic child has completed, two remain at
      // the release barrier, and an unrelated coordinator-style common-config
      // update lands between them. A whole-file snapshot must differ here.
      expect(independent.child.exitCode).toBeNull();
      expect(failed.child.exitCode).toBeNull();
      expect(
        fixtureGit(repositoryRoot, ['config', '--local', 'branch.concurrent-worker.remote', 'origin']).exitCode,
      ).toBe(0);
      expect(
        fixtureGit(repositoryRoot, ['config', '--local', 'branch.concurrent-worker.merge', 'refs/heads/main']).exitCode,
      ).toBe(0);
      expect(readOptionalConfig('branch.concurrent-worker.remote')).toBe('origin');
      expect((await readFile(join(before.commonDirectory, 'config'))).equals(commonConfigBefore)).toBeFalse();

      independent.release();
      failed.release();
      expect(await independent.result).toEqual({ exitCode: 0, stderr: '' });
      expect(await failed.result).toEqual({ exitCode: 23, stderr: '' });
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
      const after = await readParentState();
      expect(after).toEqual({
        ...before,
        unrelatedBranchMerge: 'refs/heads/main',
        unrelatedBranchRemote: 'origin',
      });
    } finally {
      for (const { child } of children) {
        if (child.exitCode === null) child.kill('SIGTERM');
        await child.exited;
      }
      await rm(fixtureRoot, { force: true, recursive: true });
    }
  });

  test.each([
    [['docs/guide.md'], ['docs', 'format'], ['rust-clippy', 'bundle-build']],
    [['src/components/Editor.tsx'], ['typecheck', 'unit', 'lint'], ['rust-clippy']],
    [['src-tauri/src/lib.rs'], ['rustfmt', 'rust-clippy'], ['bundle-build', 'native-boundaries']],
    [['.github/workflows/lint.yml'], ['actions', 'action-pins', 'format'], ['rust-clippy']],
    [['src-tauri/Cargo.lock'], ['rust-clippy', 'license-rust', 'native-leaves'], ['docs']],
  ])('classifies %p conservatively', (paths, included, excluded) => {
    const plan = planValidation(validationManifest, 'commit', paths);
    const selected = new Set(plan.filter((entry) => entry.selected).map((entry) => entry.node.id));
    for (const id of included) expect(selected.has(id)).toBeTrue();
    for (const id of excluded) expect(selected.has(id)).toBeFalse();
  });

  test('commit skips exhaustive native builds while push retains them', () => {
    const selected = (mode: 'commit' | 'push') =>
      new Set(
        planValidation(validationManifest, mode, ['src-tauri/src/lib.rs'])
          .filter((entry) => entry.selected)
          .map((entry) => entry.node.id),
      );
    const commit = selected('commit');
    const push = selected('push');
    expect(commit.has('tauri-contracts')).toBeFalse();
    expect(commit.has('native-boundaries')).toBeFalse();
    expect(push.has('tauri-contracts')).toBeTrue();
    expect(push.has('native-boundaries')).toBeTrue();
  });

  test('manifest compile gates share the cross-worktree native lease', () => {
    const manifestById = new Map(validationManifest.map((node) => [node.id, node]));
    for (const id of ['rust-clippy', 'browser-harness', 'tauri-contracts', 'native-boundaries']) {
      expect(manifestById.get(id)?.queueResources).toEqual(['native-heavy']);
    }
    for (const id of ['rust-clippy', 'tauri-contracts', 'native-boundaries']) {
      expect(manifestById.get(id)?.resourceClass).toBe('native-heavy');
    }
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
      modes: ['push'],
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
      modes: ['push'],
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

  test('shared producer artifact is generated once, reused, and regenerated from a corrupt output root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rapidraw-validation-artifact-'));
    expect(await initFixtureRepository(root)).toEqual({ exitCode: 0, stderr: '' });
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
    expect(await runValidation([producer, consumer], options)).toBe(0);
    expect(await readFile(join(root, 'dist', 'artifact'), 'utf8')).toBe('proof');
  });

  test('timeout kills grandchildren and releases the shared resource-class lease', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rapidraw-validation-cancel-'));
    const grandchildPidPath = join(tmpdir(), `rapidraw-validation-grandchild-${crypto.randomUUID()}.pid`);
    expect(await initFixtureRepository(root)).toEqual({ exitCode: 0, stderr: '' });
    await writeFile(join(root, 'input.rs'), 'fn input() {}\n');
    const timeoutNode: ValidationNode = {
      id: 'timeout-native',
      command: [
        '/bin/sh',
        '-c',
        `mkdir -p dist; touch dist/partial; sleep 30 & echo $! > ${JSON.stringify(grandchildPidPath)}; wait`,
      ],
      dependencies: [],
      inputs: ['rust'],
      resourceClass: 'native-heavy',
      cachePolicy: 'none',
      modes: ['commit'],
      outputs: ['dist'],
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
    const grandchild = Number((await readFile(grandchildPidPath, 'utf8')).trim());
    await Bun.sleep(100);
    expect(() => process.kill(grandchild, 0)).toThrow();
    expect(await Bun.file(join(root, 'dist')).exists()).toBeFalse();
    await rm(grandchildPidPath, { force: true });
    expect(
      await runValidation(
        [{ ...timeoutNode, id: 'next-native', command: ['/usr/bin/true'], timeoutMs: 1000 }],
        options,
      ),
    ).toBe(0);
  });

  test('native queue time does not consume the post-acquisition execution timeout', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rapidraw-validation-native-queue-'));
    const root = join(directory, 'worktree');
    const coordinator = join(directory, 'locks');
    const queuePath = join(coordinator, 'native-heavy.queue');
    const wrapperPath = join(import.meta.dir, '../../scripts/ci/run-resource-coordinated.ts');
    await mkdir(root);
    expect(await initFixtureRepository(root)).toEqual({ exitCode: 0, stderr: '' });
    await writeFile(join(root, 'input.rs'), 'fn input() {}\n');
    const holder = await acquireResourceLease({
      label: 'blocking-native-build',
      ownerId: 'blocking-native-owner',
      resource: 'native-heavy',
      root: coordinator,
    });
    const queuedNode: ValidationNode = {
      id: 'queued-native-command',
      command: [
        'bun',
        wrapperPath,
        '--resource',
        'native-heavy',
        '--label',
        'nested-native-command',
        '--',
        '/usr/bin/true',
      ],
      dependencies: [],
      inputs: ['rust'],
      resourceClass: 'native-heavy',
      cachePolicy: 'none',
      modes: ['push'],
      queueTimeoutMs: 2_000,
      queueResources: ['native-heavy'],
      timeoutMs: 400,
    };
    const options = {
      mode: 'push' as const,
      changedPaths: ['input.rs'],
      noCache: true,
      verifyCache: false,
      explainCache: false,
      root,
      resourceCoordinatorRoot: coordinator,
    };
    let settled = false;
    const validation = runValidation([queuedNode], options).finally(() => {
      settled = true;
    });
    let result: number | undefined;
    try {
      const queueDeadline = Date.now() + 2_000;
      while ((await readdir(queuePath).catch(() => [])).length === 0 && Date.now() < queueDeadline) await Bun.sleep(5);
      expect((await readdir(queuePath)).length).toBeGreaterThan(0);
      await Bun.sleep(500);
      expect(settled).toBeFalse();
    } finally {
      await holder.release();
      result = await validation;
    }
    expect(result).toBe(0);
    expect(await Bun.file(join(coordinator, 'native-heavy.lock')).exists()).toBeFalse();

    expect(
      await runValidation(
        [
          {
            ...queuedNode,
            id: 'slow-native-command',
            command: [...queuedNode.command.slice(0, -1), '/bin/sh', '-c', 'sleep 2'],
            timeoutMs: 100,
          },
        ],
        options,
      ),
    ).toBe(1);
    expect(await Bun.file(join(coordinator, 'native-heavy.lock')).exists()).toBeFalse();

    const stalledHolder = await acquireResourceLease({
      label: 'stalled-native-owner',
      ownerId: 'stalled-native-owner-id',
      resource: 'native-heavy',
      root: coordinator,
    });
    try {
      expect(
        await runValidation(
          [{ ...queuedNode, id: 'bounded-native-queue', queueTimeoutMs: 25, timeoutMs: 2_000 }],
          options,
        ),
      ).toBe(1);
      expect(
        (await readFile(join(coordinator, 'native-heavy.owner.json'), 'utf8')).includes('stalled-native-owner'),
      ).toBe(true);
    } finally {
      await stalledHolder.release();
    }
    expect(await Bun.file(join(coordinator, 'native-heavy.lock')).exists()).toBeFalse();
    await rm(directory, { force: true, recursive: true });
  });

  test('shared host-budget queue time is excluded while post-acquisition timeout stays strict', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rapidraw-validation-host-budget-'));
    const root = join(directory, 'worktree');
    const coordinator = join(directory, 'locks');
    await mkdir(root);
    expect(await initFixtureRepository(root)).toEqual({ exitCode: 0, stderr: '' });
    await writeFile(join(root, 'input.ts'), 'export const input = true;\n');
    const holder = await acquireResourceLease({
      capacity: 4,
      label: 'blocking-host-pressure',
      ownerId: 'blocking-host-pressure-owner',
      resource: 'validation-host-heavy',
      root: coordinator,
      weight: 4,
    });
    const unitNode: ValidationNode = {
      id: 'weighted-unit-command',
      command: ['/usr/bin/true'],
      dependencies: [],
      inputs: ['frontend'],
      resourceClass: 'suite-exclusive',
      cachePolicy: 'none',
      modes: ['push'],
      queueTimeoutMs: 2_000,
      timeoutMs: 100,
    };
    const options = {
      mode: 'push' as const,
      changedPaths: ['input.ts'],
      noCache: true,
      verifyCache: false,
      explainCache: false,
      hostBudgetCapacity: 4,
      root,
      resourceCoordinatorRoot: coordinator,
    };

    let settled = false;
    const queuedValidation = runValidation([unitNode], options).finally(() => {
      settled = true;
    });
    try {
      const queuePath = join(coordinator, 'validation-host-heavy.queue');
      const queueDeadline = Date.now() + 2_000;
      while ((await readdir(queuePath).catch(() => [])).length === 0 && Date.now() < queueDeadline) await Bun.sleep(5);
      expect((await readdir(queuePath)).length).toBeGreaterThan(0);
      await Bun.sleep(250);
      expect(settled).toBeFalse();
    } finally {
      await holder.release();
    }
    expect(await queuedValidation).toBe(0);

    expect(
      await runValidation([{ ...unitNode, id: 'slow-weighted-unit', command: ['/bin/sh', '-c', 'sleep 1'] }], options),
    ).toBe(1);
    expect((await readdir(coordinator)).some((entry) => entry.startsWith('validation-host-heavy'))).toBeFalse();
    await rm(directory, { force: true, recursive: true });
  });

  test('commit native wrapper bypasses weighted host pressure while retaining its native lock', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rapidraw-validation-nested-native-'));
    const root = join(directory, 'worktree');
    const coordinator = join(directory, 'locks');
    const runner = join(import.meta.dir, '../../scripts/ci/run-resource-coordinated.ts');
    try {
      await mkdir(root);
      expect(await initFixtureRepository(root)).toEqual({ exitCode: 0, stderr: '' });
      await writeFile(join(root, 'input.rs'), 'fn input() {}\n');
      const nestedClippyNode: ValidationNode = {
        id: 'rust-clippy',
        command: [
          'bun',
          runner,
          '--resource',
          'native-heavy',
          '--label',
          'rust-clippy',
          '--',
          'bun',
          '-e',
          "console.log('nested-clippy-ran')",
        ],
        dependencies: [],
        inputs: ['rust'],
        resourceClass: 'native-heavy',
        cachePolicy: 'none',
        modes: ['commit'],
        queueResources: ['native-heavy'],
        queueTimeoutMs: 2_000,
        timeoutMs: 2_000,
      };
      const hostPressure = await acquireResourceLease({
        capacity: 4,
        label: 'commit-must-bypass-host-pressure',
        ownerId: 'commit-host-pressure-owner',
        resource: 'validation-host-heavy',
        root: coordinator,
        weight: 4,
      });
      try {
        expect(
          await runValidation([nestedClippyNode], {
            mode: 'commit',
            changedPaths: ['input.rs'],
            noCache: true,
            verifyCache: false,
            explainCache: false,
            root,
            resourceCoordinatorRoot: coordinator,
          }),
        ).toBe(0);
      } finally {
        await hostPressure.release();
      }
      expect((await readdir(coordinator)).some((entry) => entry.endsWith('.lock'))).toBeFalse();
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test('parallel nodes in one validation run reserve independent cross-class host weight', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rapidraw-validation-node-budget-'));
    const root = join(directory, 'worktree');
    const coordinator = join(directory, 'locks');
    const sentinel = join(directory, 'host-pressure-sentinel');
    await mkdir(root);
    expect(await initFixtureRepository(root)).toEqual({ exitCode: 0, stderr: '' });
    await Promise.all([
      writeFile(join(root, 'input.rs'), 'fn input() {}\n'),
      writeFile(join(root, 'input.ts'), 'export const input = true;\n'),
    ]);
    const exclusivePressure = [
      'bun',
      '-e',
      `import {rm} from 'node:fs/promises';const path=${JSON.stringify(sentinel)};if(await Bun.file(path).exists())process.exit(9);await Bun.write(path,String(process.pid));await Bun.sleep(120);await rm(path,{force:true})`,
    ];
    const node = (id: string, input: 'frontend' | 'rust', resourceClass: 'cpu-heavy' | 'native-heavy') => ({
      id,
      command: exclusivePressure,
      dependencies: [],
      inputs: [input],
      resourceClass,
      cachePolicy: 'none' as const,
      modes: ['push' as const],
      timeoutMs: 2_000,
    });
    expect(
      await runValidation(
        [node('same-run-native', 'rust', 'native-heavy'), node('same-run-cpu', 'frontend', 'cpu-heavy')],
        {
          mode: 'push',
          changedPaths: ['input.rs', 'input.ts'],
          noCache: true,
          verifyCache: false,
          explainCache: false,
          hostBudgetCapacity: 4,
          root,
          resourceCoordinatorRoot: coordinator,
        },
      ),
    ).toBe(0);
    expect(await Bun.file(sentinel).exists()).toBeFalse();
    await rm(directory, { force: true, recursive: true });
  });

  test('separate worktree processes contend on one stable native-heavy class lease', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rapidraw-validation-contention-'));
    try {
      const firstWorktree = join(root, 'one');
      const secondWorktree = join(root, 'two');
      await mkdir(firstWorktree);
      await mkdir(secondWorktree);
      const coordinator = join(root, 'locks');
      const firstAcquired = join(root, 'first-acquired');
      const orderingReceipt = join(root, 'lease-ordering.jsonl');
      const modulePath = join(import.meta.dir, '../../scripts/lib/ci/resource-coordinator.ts');
      const script = `import { appendFile, writeFile } from 'node:fs/promises';
import { acquireResourceLease } from ${JSON.stringify(modulePath)};
const lease=await acquireResourceLease({resource:'validation-class-native-heavy',label:process.cwd(),pollMs:10});
await appendFile(${JSON.stringify(orderingReceipt)},JSON.stringify({event:Bun.env.LEASE_EVENT})+'\\n');
if(Bun.env.LEASE_READY)await writeFile(Bun.env.LEASE_READY,'ready');
await Bun.sleep(180);
await appendFile(${JSON.stringify(orderingReceipt)},JSON.stringify({event:Bun.env.LEASE_RELEASE_EVENT})+'\\n');
await lease.release();`;
      const env = { ...process.env, RAWENGINE_RESOURCE_COORDINATOR_ROOT: coordinator };
      const first = Bun.spawn(['bun', '-e', script], {
        cwd: firstWorktree,
        env: {
          ...env,
          LEASE_EVENT: 'first-acquired',
          LEASE_READY: firstAcquired,
          LEASE_RELEASE_EVENT: 'first-releasing',
          RAWENGINE_RESOURCE_OWNER_ID: crypto.randomUUID(),
        },
        stdout: 'pipe',
        stderr: 'pipe',
      });
      for (let attempt = 0; !(await Bun.file(firstAcquired).exists()); attempt += 1) {
        if (attempt >= 200) throw new Error('first process did not publish lease acquisition');
        await Bun.sleep(10);
      }
      const second = Bun.spawn(['bun', '-e', script], {
        cwd: secondWorktree,
        env: {
          ...env,
          LEASE_EVENT: 'second-acquired',
          LEASE_RELEASE_EVENT: 'second-releasing',
          RAWENGINE_RESOURCE_OWNER_ID: crypto.randomUUID(),
        },
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const [firstExit, secondExit] = await Promise.all([
        new Response(first.stdout).text(),
        new Response(second.stdout).text(),
        first.exited,
        second.exited,
      ]).then((results) => [results[2], results[3]] as const);
      expect([firstExit, secondExit]).toEqual([0, 0]);
      const events = (await readFile(orderingReceipt, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => (JSON.parse(line) as { event: string }).event);
      expect(events).toEqual(['first-acquired', 'first-releasing', 'second-acquired', 'second-releasing']);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test('commit suites run concurrently across isolated worktrees without a global host throttle', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rapidraw-validation-suite-exclusive-'));
    const firstWorktree = join(root, 'one');
    const secondWorktree = join(root, 'two');
    const coordinator = join(root, 'locks');
    const rendezvous = join(root, 'parallel-suite-rendezvous');
    await Promise.all([mkdir(firstWorktree), mkdir(secondWorktree)]);
    await Promise.all([
      writeFile(join(firstWorktree, 'input.ts'), 'export const input = 1;\n'),
      writeFile(join(secondWorktree, 'input.ts'), 'export const input = 2;\n'),
    ]);
    const command = [
      'bun',
      '-e',
      `import {mkdir,readdir} from 'node:fs/promises';const root=${JSON.stringify(rendezvous)};await mkdir(root+'/'+process.pid,{recursive:true});for(let attempt=0;;attempt+=1){if((await readdir(root)).length>=2)break;if(attempt===200)process.exit(9);await Bun.sleep(10)}await Bun.sleep(50)`,
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

  test('producer outputs are worktree-scoped, stale-safe, and serialized only for the same worktree', async () => {
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
        await mkdir(join(worktree, 'dist'));
        await writeFile(join(worktree, 'dist', 'artifact'), 'stale');
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
    const parallelProducer: ValidationNode = {
      ...producer,
      command: [
        'bun',
        '-e',
        "import {mkdir,readdir} from 'node:fs/promises';const rendezvous='../parallel-rendezvous';await mkdir(`${rendezvous}/${process.pid}`,{recursive:true});for(let attempt=0;;attempt+=1){if((await readdir(rendezvous)).length>=3)break;if(attempt===250)process.exit(10);await Bun.sleep(20)}const path='dist/artifact';await mkdir('dist',{recursive:true});if(await Bun.file(path).exists())process.exit(9);await Bun.write(path,String(process.pid));await Bun.file(path).delete()",
      ],
      timeoutMs: 8_000,
    };
    expect(
      await Promise.all(parallelWorktrees.map((worktree) => runValidation([parallelProducer], options(worktree)))),
    ).toEqual([0, 0, 0]);
    expect(validationOutputResource(parallelWorktrees[0], 'dist')).not.toBe(
      validationOutputResource(parallelWorktrees[1], 'dist'),
    );
    expect(await readdir(join(root, 'parallel-rendezvous'))).toHaveLength(3);
  });

  test('programmatic nested validation inherits its active output-lease owner without self-queueing', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rapidraw-validation-nested-output-'));
    const root = join(directory, 'worktree');
    const coordinator = join(directory, 'locks');
    try {
      await mkdir(root);
      await writeFile(join(root, 'input.ts'), 'export const input = true;\n');
      await initFixtureRepository(root);
      const child = spawnNestedOutputValidation({
        coordinator,
        ownerId: 'nested-output-owner',
        repetitions: 2,
        root,
      });
      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      expect(exitCode, `${stdout}\n${stderr}`).toBe(0);
      expect(stdout).toContain('nested-output-complete nested-output-owner');
      expect(await Bun.file(join(coordinator, `${validationOutputResource(root, 'dist')}.lock`)).exists()).toBeFalse();
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test('keeps repeated nested output leases bounded across concurrent unrelated owners', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rapidraw-validation-nested-output-stress-'));
    const root = join(directory, 'worktree');
    const coordinator = join(directory, 'locks');
    const children: Array<ReturnType<typeof Bun.spawn>> = [];
    try {
      await mkdir(root);
      await writeFile(join(root, 'input.ts'), 'export const input = true;\n');
      await initFixtureRepository(root);
      for (let index = 0; index < 3; index += 1) {
        children.push(
          spawnNestedOutputValidation({
            coordinator,
            ownerId: `nested-output-owner-${String(index)}`,
            repetitions: 3,
            root,
            waitTimeoutMs: 4_000,
          }),
        );
      }
      const results = await Promise.all(
        children.map(async (child) => {
          const [exitCode, stdout, stderr] = await Promise.all([
            child.exited,
            new Response(child.stdout).text(),
            new Response(child.stderr).text(),
          ]);
          return { exitCode, stderr, stdout };
        }),
      );
      expect(
        results.map(({ exitCode }) => exitCode),
        results.map(({ stderr, stdout }) => `${stdout}\n${stderr}`).join('\n---\n'),
      ).toEqual([0, 0, 0]);
      for (let index = 0; index < results.length; index += 1) {
        expect(results[index]?.stdout).toContain(`nested-output-complete nested-output-owner-${String(index)}`);
      }
      expect(await Bun.file(join(coordinator, `${validationOutputResource(root, 'dist')}.lock`)).exists()).toBeFalse();
    } finally {
      for (const child of children) {
        if (child.exitCode === null) child.kill('SIGKILL');
      }
      await Promise.allSettled(children.map((child) => child.exited));
      await rm(directory, { force: true, recursive: true });
    }
  });

  test('holds producer output ownership through downstream consumers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rapidraw-validation-output-lifetime-'));
    const worktree = join(root, 'worktree');
    const coordinator = join(root, 'locks');
    await mkdir(worktree);
    await writeFile(join(worktree, 'input.ts'), 'export const input = true;\n');
    await initFixtureRepository(worktree);
    const producer = (token: string): ValidationNode => ({
      id: `producer-${token}`,
      command: [
        'bun',
        '-e',
        `import {mkdir} from 'node:fs/promises';await mkdir('dist',{recursive:true});await Bun.write('dist/artifact',${JSON.stringify(token)})`,
      ],
      dependencies: [],
      inputs: ['frontend'],
      resourceClass: 'light',
      cachePolicy: 'none',
      modes: ['commit'],
      timeoutMs: 2_000,
      outputs: ['dist'],
    });
    const consumer = (token: string): ValidationNode => ({
      id: `consumer-${token}`,
      command: [
        'bun',
        '-e',
        `await Bun.sleep(500);if((await Bun.file('dist/artifact').text())!==${JSON.stringify(token)})process.exit(9)`,
      ],
      dependencies: [`producer-${token}`],
      inputs: ['frontend'],
      resourceClass: 'light',
      cachePolicy: 'none',
      modes: ['commit'],
      timeoutMs: 2_000,
    });
    const options = {
      mode: 'commit' as const,
      changedPaths: ['input.ts'],
      noCache: true,
      verifyCache: false,
      explainCache: false,
      root: worktree,
      resourceCoordinatorRoot: coordinator,
    };

    const first = runValidation([producer('one'), consumer('one')], options);
    await Bun.sleep(10);
    const second = runValidation([producer('two'), consumer('two')], options);
    expect(await Promise.all([first, second])).toEqual([0, 0]);
  });

  test('commit failure preserves an independent active node disposition and returns deterministic nonzero', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rapidraw-validation-fail-fast-'));
    expect(await initFixtureRepository(root)).toEqual({ exitCode: 0, stderr: '' });
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
    expect(await initFixtureRepository(root)).toEqual({ exitCode: 0, stderr: '' });
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
    expect(await initFixtureRepository(root)).toEqual({ exitCode: 0, stderr: '' });
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

  test('SIGINT cancels a native queue wait without releasing its live holder', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rapidraw-validation-queued-sigint-'));
    expect(await initFixtureRepository(root)).toEqual({ exitCode: 0, stderr: '' });
    await writeFile(join(root, 'input.rs'), 'fn input() {}\n');
    const lockRoot = join(root, 'locks');
    const holder = await acquireResourceLease({
      label: 'live-native-holder',
      ownerId: 'live-native-holder-id',
      resource: 'native-heavy',
      root: lockRoot,
    });
    try {
      const enginePath = join(import.meta.dir, '../../scripts/validation/engine.ts');
      const script = `import { runValidation } from ${JSON.stringify(enginePath)};
const node={id:'queued-signal',command:['/usr/bin/true'],dependencies:[],inputs:['rust'],resourceClass:'native-heavy',cachePolicy:'none',modes:['push'],queueResources:['native-heavy'],timeoutMs:60000};
setTimeout(()=>process.kill(process.pid,'SIGINT'),100);
const code=await runValidation([node],{mode:'push',changedPaths:['input.rs'],noCache:true,verifyCache:false,explainCache:false,root:process.cwd(),resourceCoordinatorRoot:process.cwd()+'/locks'});
process.exit(code);`;
      const child = Bun.spawn(['bun', '-e', script], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
      expect(await child.exited).toBe(130);
      expect(await Bun.file(join(lockRoot, 'native-heavy.queue')).exists()).toBeFalse();
      expect((await readFile(join(lockRoot, 'native-heavy.owner.json'), 'utf8')).includes('live-native-holder')).toBe(
        true,
      );
      expect(
        (await readdir(lockRoot)).filter(
          (entry) => entry !== 'native-heavy.lock' && entry !== 'native-heavy.owner.json',
        ),
      ).toEqual([]);
    } finally {
      await holder.release();
    }
    expect(await readdir(lockRoot).catch(() => [])).toEqual([]);
  }, 10_000);
});
