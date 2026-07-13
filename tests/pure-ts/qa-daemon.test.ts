import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { QaDaemonEngine, type QaLifecycleAdapter } from '../../scripts/qa/daemon-engine';
import type { QaDaemonIdentity, QaDaemonMetrics, QaDaemonResponse } from '../../scripts/qa/daemon-model';
import { qaDaemonPaths, readLiveDaemonState } from '../../scripts/qa/daemon-state';
import { createQaDaemonIdentity } from '../../scripts/qa/identity';

interface FakeSession {
  generation: number;
}

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const identity = (worktree: string, configuration = 'a'.repeat(64), source = 'b'.repeat(64)): QaDaemonIdentity => ({
  worktree,
  configuration,
  source,
  headed: false,
});

function fakeAdapter(events: string[]): QaLifecycleAdapter<FakeSession, string[]> {
  let generation = 0;
  return {
    async start() {
      generation += 1;
      events.push(`start:${generation}`);
      return { generation };
    },
    async stop(session) {
      events.push(`stop:${session.generation}`);
    },
    async refresh(session) {
      events.push(`refresh:${session.generation}`);
    },
    async run(session, job, metrics: QaDaemonMetrics) {
      metrics.contextsCreated += job.scenarioIds.length;
      metrics.contextsClosed += job.scenarioIds.length;
      return job.scenarioIds.map((id) => `${session.generation}:${id}`);
    },
  };
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), 'rapidraw-qa-daemon-'));
  directories.push(directory);
  return directory;
}

function withoutGitEnvironment(environment: NodeJS.ProcessEnv): Record<string, string> {
  const isolated: Record<string, string> = {};
  for (const [key, value] of Object.entries(environment)) {
    if (!key.startsWith('GIT_') && value !== undefined) isolated[key] = value;
  }
  return isolated;
}

function fixtureGit(worktree: string, args: readonly string[], environment: NodeJS.ProcessEnv = process.env) {
  return Bun.spawnSync(['git', ...args], { cwd: worktree, env: withoutGitEnvironment(environment) });
}

async function socketRequest(socketPath: string, value: unknown): Promise<QaDaemonResponse> {
  return await new Promise((resolveResponse, reject) => {
    const socket = connect(socketPath);
    let response = '';
    socket.setEncoding('utf8');
    socket.once('connect', () => socket.write(`${JSON.stringify(value)}\n`));
    socket.on('data', (chunk) => (response += chunk));
    socket.once('end', () => {
      try {
        resolveResponse(JSON.parse(response.trim()) as QaDaemonResponse);
      } catch (error) {
        reject(error);
      }
    });
    socket.once('error', reject);
  });
}

describe('QA daemon lifecycle', () => {
  test('reuses source changes but restarts configuration changes with fresh-context accounting', async () => {
    const worktree = await temporaryDirectory();
    const events: string[] = [];
    const engine = new QaDaemonEngine(worktree, fakeAdapter(events));
    await engine.run(identity(worktree), { scenarioIds: ['one'], shard: { index: 0, total: 1 } });
    await engine.run(identity(worktree, 'a'.repeat(64), 'c'.repeat(64)), {
      scenarioIds: ['two'],
      shard: { index: 0, total: 1 },
    });
    await engine.run(identity(worktree, 'd'.repeat(64), 'e'.repeat(64)), {
      scenarioIds: ['three'],
      shard: { index: 0, total: 1 },
    });
    await engine.close();
    expect(events).toEqual(['start:1', 'refresh:1', 'stop:1', 'start:2', 'stop:2']);
    expect(engine.metrics).toMatchObject({
      serverStarts: 2,
      browserStarts: 2,
      serverStartsAvoided: 1,
      browserStartsAvoided: 1,
      sourceReuses: 1,
      configurationRestarts: 1,
      jobs: 3,
      contextsCreated: 3,
      contextsClosed: 3,
      leakedContexts: 0,
    });
  });

  test('one-shot and persistent engines return equivalent scenario results', async () => {
    const worktree = await temporaryDirectory();
    const persistent = new QaDaemonEngine(worktree, fakeAdapter([]));
    const oneShot = new QaDaemonEngine(worktree, fakeAdapter([]));
    const job = { scenarioIds: ['compare', 'crop'], shard: { index: 0, total: 1 } } as const;
    expect(await persistent.run(identity(worktree), job)).toEqual(await oneShot.run(identity(worktree), job));
    await Promise.all([persistent.close(), oneShot.close()]);
  });

  test('accounts for serialized worktree wait and avoided process starts', async () => {
    const worktree = await temporaryDirectory();
    let releaseFirst!: () => void;
    let runs = 0;
    const adapter = fakeAdapter([]);
    const run = adapter.run;
    adapter.run = async (...parameters) => {
      runs += 1;
      if (runs === 1) await new Promise<void>((ready) => (releaseFirst = ready));
      return await run(...parameters);
    };
    const engine = new QaDaemonEngine(worktree, adapter);
    const job = { scenarioIds: ['compare'], shard: { index: 0, total: 1 } } as const;
    const first = engine.run(identity(worktree), job);
    while (runs === 0) await Bun.sleep(1);
    const second = engine.run(identity(worktree), job);
    await Bun.sleep(10);
    releaseFirst();
    await Promise.all([first, second]);
    expect(engine.metrics).toMatchObject({ browserStartsAvoided: 1, serverStartsAvoided: 1 });
    expect(engine.metrics.worktreeWaitMs).toBeGreaterThan(0);
    await engine.close();
  });

  test('rejects a request from another worktree', async () => {
    const worktree = await temporaryDirectory();
    const engine = new QaDaemonEngine(worktree, fakeAdapter([]));
    await expect(
      engine.run(identity(resolve(worktree, 'other')), { scenarioIds: ['one'], shard: { index: 0, total: 1 } }),
    ).rejects.toThrow('belongs');
  });

  test('cancellation aborts an active job before session cleanup', async () => {
    const worktree = await temporaryDirectory();
    const events: string[] = [];
    const adapter: QaLifecycleAdapter<FakeSession, void> = {
      async start() {
        events.push('start');
        return { generation: 1 };
      },
      async stop() {
        events.push('stop');
      },
      async run(_session, _job, _metrics, signal) {
        events.push('run');
        await new Promise<void>((_done, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
        );
      },
    };
    const engine = new QaDaemonEngine(worktree, adapter);
    const running = engine.run(identity(worktree), { scenarioIds: ['one'], shard: { index: 0, total: 1 } });
    while (!events.includes('run')) await Bun.sleep(1);
    engine.cancel();
    await expect(running).rejects.toThrow('cancelled');
    await engine.close();
    expect(events).toEqual(['start', 'run', 'stop']);
  });

  test('quarantines malformed and stale ownership records', async () => {
    const worktree = await temporaryDirectory();
    const paths = qaDaemonPaths(worktree);
    await mkdir(paths.directory, { recursive: true });
    await writeFile(paths.state, '{bad json');
    expect(await readLiveDaemonState(worktree)).toBeUndefined();
    await writeFile(
      paths.state,
      JSON.stringify({
        schemaVersion: 1,
        pid: process.pid,
        worktree: resolve(worktree),
        socketPath: paths.socket,
        startedAt: new Date().toISOString(),
        processStartToken: 'stale-token',
      }),
    );
    expect(await readLiveDaemonState(worktree)).toBeUndefined();
    expect(await readFile(paths.state, 'utf8').catch(() => undefined)).toBeUndefined();
  });

  test('keys configuration separately from source content for restart versus HMR reuse', async () => {
    const worktree = await temporaryDirectory();
    const repository = resolve(import.meta.dir, '../..');
    const commonDirectory = fixtureGit(repository, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
      .stdout.toString()
      .trim();
    const commonBareBefore = fixtureGit(repository, ['config', '--bool', 'core.bare']).stdout.toString().trim();
    expect(commonBareBefore).toBe('false');
    const adversarialHookEnvironment = {
      ...process.env,
      GIT_DIR: commonDirectory,
      GIT_INDEX_FILE: resolve(commonDirectory, 'index'),
      GIT_PREFIX: '',
      GIT_WORK_TREE: repository,
    };
    await Bun.write(resolve(worktree, 'package.json'), '{}\n');
    await Bun.write(resolve(worktree, 'bun.lock'), 'lock\n');
    await Bun.write(resolve(worktree, 'vite.config.js'), 'export default {}\n');
    await Bun.write(resolve(worktree, 'source.ts'), 'export const value = 1;\n');
    expect(fixtureGit(worktree, ['init', '-q'], adversarialHookEnvironment).exitCode).toBe(0);
    expect(fixtureGit(worktree, ['add', '.'], adversarialHookEnvironment).exitCode).toBe(0);
    expect(
      fixtureGit(
        worktree,
        ['-c', 'user.name=QA', '-c', 'user.email=qa@example.test', 'commit', '-qm', 'fixture'],
        adversarialHookEnvironment,
      ).exitCode,
    ).toBe(0);
    const initial = await createQaDaemonIdentity(worktree, false);
    await Bun.write(resolve(worktree, 'source.ts'), 'export const value = 2;\n');
    const sourceChange = await createQaDaemonIdentity(worktree, false);
    expect(sourceChange.configuration).toBe(initial.configuration);
    expect(sourceChange.source).not.toBe(initial.source);
    await Bun.write(resolve(worktree, 'bun.lock'), 'lock changed\n');
    const lockChange = await createQaDaemonIdentity(worktree, false);
    expect(lockChange.configuration).not.toBe(sourceChange.configuration);
    await Bun.write(resolve(worktree, 'vite.config.js'), 'export default { base: "/qa" };\n');
    const configChange = await createQaDaemonIdentity(worktree, false);
    expect(configChange.configuration).not.toBe(lockChange.configuration);
    expect(configChange.source).not.toBe(lockChange.source);
    expect(fixtureGit(repository, ['config', '--bool', 'core.bare']).stdout.toString().trim()).toBe(commonBareBefore);
  });

  test('serves JSON health and removes state/socket on authenticated shutdown', async () => {
    const worktree = await temporaryDirectory();
    const repository = resolve(import.meta.dir, '../..');
    const child = Bun.spawn(['bun', 'scripts/qa/daemon.ts', '--worktree', worktree], {
      cwd: repository,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    let state = await readLiveDaemonState(worktree);
    for (let attempt = 0; attempt < 100 && state === undefined; attempt += 1) {
      await Bun.sleep(25);
      state = await readLiveDaemonState(worktree);
    }
    if (state === undefined)
      throw new Error(`Daemon failed to publish state: ${await new Response(child.stderr).text()}`);
    const health = await socketRequest(state.socketPath, { id: 'health', method: 'health' });
    expect(health).toMatchObject({ id: 'health', ok: true });
    const shutdown = await socketRequest(state.socketPath, { id: 'shutdown', method: 'shutdown' });
    expect(shutdown).toEqual({ id: 'shutdown', ok: true, result: { shuttingDown: true } });
    await child.exited;
    expect(await readLiveDaemonState(worktree)).toBeUndefined();
  }, 15_000);

  test('removes ownership state and socket on SIGTERM', async () => {
    const worktree = await temporaryDirectory();
    const repository = resolve(import.meta.dir, '../..');
    const child = Bun.spawn(['bun', 'scripts/qa/daemon.ts', '--worktree', worktree], {
      cwd: repository,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    let state = await readLiveDaemonState(worktree);
    for (let attempt = 0; attempt < 100 && state === undefined; attempt += 1) {
      await Bun.sleep(25);
      state = await readLiveDaemonState(worktree);
    }
    if (state === undefined)
      throw new Error(`Daemon failed to publish state: ${await new Response(child.stderr).text()}`);
    child.kill('SIGTERM');
    await child.exited;
    expect(await readLiveDaemonState(worktree)).toBeUndefined();
    expect(await stat(state.socketPath).catch(() => undefined)).toBeUndefined();
  }, 15_000);
});
