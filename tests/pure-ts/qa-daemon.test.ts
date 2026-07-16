import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { isolatedGitEnvironment } from '../../scripts/lib/ci/git-environment';
import { qaDaemonLeaseForState } from '../../scripts/qa/daemon-client';
import { QaDaemonEngine, type QaLifecycleAdapter } from '../../scripts/qa/daemon-engine';
import type {
  QaDaemonIdentity,
  QaDaemonMetrics,
  QaDaemonResponse,
  QaDaemonStateRecord,
} from '../../scripts/qa/daemon-model';
import { qaDaemonPaths, readLiveDaemonState } from '../../scripts/qa/daemon-state';
import { createQaDaemonIdentity } from '../../scripts/qa/identity';
import { createLazyLifecycleAdapter } from '../../scripts/qa/lazy-lifecycle-adapter';

interface FakeSession {
  generation: number;
}

const QA_DAEMON_STARTUP_DIAGNOSTIC_MS = 10_000;

const stopChild = async (child: ReturnType<typeof Bun.spawn>): Promise<void> => {
  if (child.exitCode === null) child.kill('SIGTERM');
  const exited = await Promise.race([child.exited.then(() => true), Bun.sleep(1_000).then(() => false)]);
  if (!exited) child.kill('SIGKILL');
  await child.exited;
};

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
      return undefined;
    },
    async run(session, job, metrics: QaDaemonMetrics) {
      metrics.contextsCreated += job.scenarioIds.length;
      metrics.contextsClosed += job.scenarioIds.length;
      return job.scenarioIds.map((id) => `${session.generation}:${id}`);
    },
  };
}

async function temporaryDirectory(): Promise<{ path: string; [Symbol.asyncDispose](): Promise<void> }> {
  const path = await mkdtemp(resolve(tmpdir(), 'rapidraw-qa-daemon-'));
  return {
    path,
    async [Symbol.asyncDispose]() {
      await rm(path, { recursive: true, force: true });
    },
  };
}

function fixtureGit(worktree: string, args: readonly string[], environment: NodeJS.ProcessEnv = process.env) {
  return Bun.spawnSync(['git', ...args], { cwd: worktree, env: isolatedGitEnvironment(environment) });
}

async function socketRequest(socketPath: string, value: unknown): Promise<QaDaemonResponse> {
  return await new Promise((resolveResponse, reject) => {
    const socket = connect(socketPath);
    let response = '';
    socket.setEncoding('utf8');
    socket.setTimeout(1_000, () => socket.destroy(new Error('QA daemon test socket response timed out.')));
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

interface CapturedStream {
  completed: Promise<void>;
  text(): string;
}

function captureStream(stream: ReadableStream<Uint8Array>, onLine?: (line: string) => void): CapturedStream {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let pending = '';
  const completed = (async () => {
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        const decoded = decoder.decode(chunk.value, { stream: true });
        text += decoded;
        pending += decoded;
        let newline = pending.indexOf('\n');
        while (newline >= 0) {
          onLine?.(pending.slice(0, newline));
          pending = pending.slice(newline + 1);
          newline = pending.indexOf('\n');
        }
      }
      const tail = decoder.decode();
      text += tail;
      pending += tail;
      if (pending !== '') onLine?.(pending);
    } finally {
      reader.releaseLock();
    }
  })();
  return { completed, text: () => text };
}

const spawnQaDaemon = (repository: string, worktree: string) => {
  const child = Bun.spawn([process.execPath, 'scripts/qa/daemon.ts', '--worktree', worktree], {
    cwd: repository,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (!(child.stdout instanceof ReadableStream) || !(child.stderr instanceof ReadableStream))
    throw new Error('QA daemon diagnostic pipes were not attached.');
  const readiness = Promise.withResolvers<void>();
  let readinessSettled = false;
  const stdout = captureStream(child.stdout, (line) => {
    try {
      const message: unknown = JSON.parse(line);
      if (typeof message === 'object' && message !== null && Reflect.get(message, 'event') === 'ready') {
        readinessSettled = true;
        readiness.resolve();
      }
    } catch {
      // Non-JSON output remains available in diagnostics.
    }
  });
  const stderr = captureStream(child.stderr);
  void stdout.completed.then(() => {
    if (!readinessSettled) readiness.reject(new Error('QA daemon stdout closed before readiness.'));
  });
  return {
    child,
    ready: readiness.promise,
    diagnostics() {
      return `pid=${String(child.pid)} exit=${String(child.exitCode)}\nstdout:\n${stdout.text()}\nstderr:\n${stderr.text()}`;
    },
    async [Symbol.asyncDispose]() {
      await stopChild(child);
      await Promise.all([stdout.completed, stderr.completed]);
    },
  };
};

const waitForDaemonState = async (
  daemon: ReturnType<typeof spawnQaDaemon>,
  worktree: string,
): Promise<QaDaemonStateRecord> => {
  const outcome = await Promise.race([
    daemon.ready.then(() => 'ready' as const),
    daemon.child.exited.then(() => 'exited' as const),
    Bun.sleep(QA_DAEMON_STARTUP_DIAGNOSTIC_MS).then(() => 'diagnostic-deadline' as const),
  ]);
  if (outcome !== 'ready') {
    throw new Error(`QA daemon readiness failed (${outcome}).\n${daemon.diagnostics()}`);
  }
  const state = await readLiveDaemonState(worktree);
  if (state === undefined)
    throw new Error(`QA daemon announced readiness without live state.\n${daemon.diagnostics()}`);
  const health = await socketRequest(state.socketPath, { id: 'startup', method: 'health' });
  if (!health.ok) throw new Error(`QA daemon readiness health check failed.\n${daemon.diagnostics()}`);
  return state;
};

describe('QA daemon lifecycle', () => {
  test('does not load the browser lifecycle until the first browser job', async () => {
    await using directory = await temporaryDirectory();
    const worktree = directory.path;
    const events: string[] = [];
    let loads = 0;
    const lazyAdapter = createLazyLifecycleAdapter(async () => {
      loads += 1;
      return fakeAdapter(events);
    });
    const engine = new QaDaemonEngine(worktree, lazyAdapter);
    expect(loads).toBe(0);
    expect(engine.metrics.serverStarts).toBe(0);
    await engine.run(identity(worktree), { scenarioIds: ['one'], shard: { index: 0, total: 1 } });
    await engine.close();
    expect(loads).toBe(1);
    expect(events).toEqual(['start:1', 'stop:1']);
  });

  test('only grants shutdown ownership to the process that won daemon publication', () => {
    const state = {
      schemaVersion: 1 as const,
      pid: 202,
      worktree: '/tmp/winner',
      socketPath: '/tmp/winner.sock',
      startedAt: '2026-01-01T00:00:00.000Z',
      processStartToken: 'winner-token',
    };
    expect(qaDaemonLeaseForState(state, 101)).toEqual({ state, startedByCaller: false });
    expect(qaDaemonLeaseForState(state, 202)).toEqual({ state, startedByCaller: true });
  });

  test('reuses source changes but restarts configuration changes with fresh-context accounting', async () => {
    await using directory = await temporaryDirectory();
    const worktree = directory.path;
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
    await using directory = await temporaryDirectory();
    const worktree = directory.path;
    const persistent = new QaDaemonEngine(worktree, fakeAdapter([]));
    const oneShot = new QaDaemonEngine(worktree, fakeAdapter([]));
    const job = { scenarioIds: ['compare', 'crop'], shard: { index: 0, total: 1 } } as const;
    expect(await persistent.run(identity(worktree), job)).toEqual(await oneShot.run(identity(worktree), job));
    await Promise.all([persistent.close(), oneShot.close()]);
  });

  test('discards a failed session before the next isolated job', async () => {
    await using directory = await temporaryDirectory();
    const worktree = directory.path;
    const events: string[] = [];
    const adapter = fakeAdapter(events);
    const run = adapter.run;
    let attempts = 0;
    adapter.run = async (...parameters) => {
      attempts += 1;
      if (attempts === 1) throw new Error('session poisoned');
      return await run(...parameters);
    };
    const engine = new QaDaemonEngine(worktree, adapter);
    const job = { scenarioIds: ['compare'], shard: { index: 0, total: 1 } } as const;
    await expect(engine.run(identity(worktree), job)).rejects.toThrow('session poisoned');
    expect(await engine.run(identity(worktree), job)).toEqual(['2:compare']);
    expect(events).toEqual(['start:1', 'stop:1', 'start:2']);
    expect(engine.metrics.sessionRecoveries).toBe(1);
    await engine.close();
  });

  test('accounts for serialized worktree wait and avoided process starts', async () => {
    await using directory = await temporaryDirectory();
    const worktree = directory.path;
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

  test('accounts for a source refresh restart without claiming process reuse', async () => {
    await using directory = await temporaryDirectory();
    const worktree = directory.path;
    const adapter = fakeAdapter([]);
    adapter.refresh = async (_session, _identity, metrics) => {
      metrics.browserStarts += 1;
      metrics.serverStarts += 1;
      return { browserRestarted: true, serverRestarted: true };
    };
    const engine = new QaDaemonEngine(worktree, adapter);
    const job = { scenarioIds: ['compare'], shard: { index: 0, total: 1 } } as const;
    await engine.run(identity(worktree), job);
    await engine.run(identity(worktree, 'a'.repeat(64), 'c'.repeat(64)), job);
    expect(engine.metrics).toMatchObject({
      browserStarts: 2,
      browserStartsAvoided: 0,
      serverStarts: 2,
      serverStartsAvoided: 0,
      sourceRefreshes: 1,
      sourceReuses: 0,
    });
    await engine.close();
  });

  test('rejects a request from another worktree', async () => {
    await using directory = await temporaryDirectory();
    const worktree = directory.path;
    const engine = new QaDaemonEngine(worktree, fakeAdapter([]));
    await expect(
      engine.run(identity(resolve(worktree, 'other')), { scenarioIds: ['one'], shard: { index: 0, total: 1 } }),
    ).rejects.toThrow('belongs');
  });

  test('cancellation aborts an active job before session cleanup', async () => {
    await using directory = await temporaryDirectory();
    const worktree = directory.path;
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
    await using directory = await temporaryDirectory();
    const worktree = directory.path;
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
    await using directory = await temporaryDirectory();
    const worktree = directory.path;
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
    await using directory = await temporaryDirectory();
    const worktree = directory.path;
    const repository = resolve(import.meta.dir, '../..');
    await using daemon = spawnQaDaemon(repository, worktree);
    const state = await waitForDaemonState(daemon, worktree);
    const health = await socketRequest(state.socketPath, { id: 'health', method: 'health' });
    expect(health).toMatchObject({ id: 'health', ok: true });
    const shutdown = await socketRequest(state.socketPath, { id: 'shutdown', method: 'shutdown' });
    expect(shutdown).toEqual({ id: 'shutdown', ok: true, result: { shuttingDown: true } });
    await daemon.child.exited;
    expect(await readLiveDaemonState(worktree)).toBeUndefined();
  }, 40_000);

  test('removes ownership state and socket on SIGTERM', async () => {
    await using directory = await temporaryDirectory();
    const worktree = directory.path;
    const repository = resolve(import.meta.dir, '../..');
    await using daemon = spawnQaDaemon(repository, worktree);
    const state = await waitForDaemonState(daemon, worktree);
    daemon.child.kill('SIGTERM');
    await Promise.race([
      daemon.child.exited,
      Bun.sleep(3_000).then(() => {
        throw new Error('QA daemon did not exit within the SIGTERM cleanup deadline.');
      }),
    ]);
    expect(await readLiveDaemonState(worktree)).toBeUndefined();
    expect(await stat(state.socketPath).catch(() => undefined)).toBeUndefined();
  }, 40_000);
});
