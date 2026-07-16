import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  type MainCommandContext,
  parseCommandArguments,
  runLatestMainCommand,
  shouldMonitorMain,
} from '../../../scripts/ci/run-latest-main-command';

test('accepts Bun-stripped and explicit command separators', () => {
  expect(parseCommandArguments(['cargo', 'test'])).toEqual(['cargo', 'test']);
  expect(parseCommandArguments(['--', 'cargo', 'test'])).toEqual(['cargo', 'test']);
});

interface FakeChild {
  complete(exitCode: number): void;
  exitCode: number | null;
  exited: Promise<number>;
  kill(): void;
  pid: number;
}

const fakeChild = (): FakeChild => {
  const completion = Promise.withResolvers<number>();
  const child: FakeChild = {
    complete(exitCode) {
      child.exitCode = exitCode;
      completion.resolve(exitCode);
    },
    exitCode: null,
    exited: completion.promise,
    kill() {},
    pid: 42,
  };
  return child;
};

const mainPush: MainCommandContext = {
  eventName: 'push',
  ref: 'refs/heads/main',
  runSha: 'a'.repeat(40),
};

test('only push validation for main is supersession-aware', () => {
  expect(shouldMonitorMain(mainPush)).toBeTrue();
  expect(shouldMonitorMain({ ...mainPush, eventName: 'workflow_dispatch' })).toBeFalse();
  expect(shouldMonitorMain({ ...mainPush, eventName: 'schedule' })).toBeFalse();
  expect(shouldMonitorMain({ ...mainPush, ref: 'refs/heads/codex/proof' })).toBeFalse();
});

test('skips an expensive command when main is already newer', async () => {
  let spawnCount = 0;
  const receipt = await runLatestMainCommand({
    command: ['expensive-proof'],
    context: mainPush,
    readRemoteMainSha: async () => 'b'.repeat(40),
    spawnCommand: () => {
      spawnCount += 1;
      return fakeChild();
    },
  });
  expect(receipt.status).toBe('superseded');
  expect(receipt.observedMainSha).toBe('b'.repeat(40));
  expect(spawnCount).toBe(0);
});

test('stops a running command once a newer main SHA is proven', async () => {
  const child = fakeChild();
  let checks = 0;
  let stopCount = 0;
  const receipt = await runLatestMainCommand({
    command: ['expensive-proof'],
    context: mainPush,
    pollIntervalMs: 1,
    readRemoteMainSha: async () => (++checks === 1 ? (mainPush.runSha ?? null) : 'c'.repeat(40)),
    spawnCommand: () => child,
    stopChild: async () => {
      stopCount += 1;
      child.complete(143);
    },
  });
  expect(receipt.status).toBe('superseded');
  expect(receipt.exitCode).toBe(0);
  expect(stopCount).toBe(1);
});

test('manual proofs run fully and a remote lookup failure never skips work', async () => {
  for (const [context, lookupFailure] of [
    [{ ...mainPush, eventName: 'workflow_dispatch' }, 'null'],
    [mainPush, 'null'],
    [mainPush, 'throw'],
  ] as const) {
    const child = fakeChild();
    let remoteChecks = 0;
    const running = runLatestMainCommand({
      command: ['proof'],
      context,
      pollIntervalMs: 1,
      readRemoteMainSha: async () => {
        remoteChecks += 1;
        if (lookupFailure === 'throw') throw new Error('network unavailable');
        return null;
      },
      spawnCommand: () => child,
    });
    child.complete(0);
    const receipt = await running;
    expect(receipt.status).toBe('completed');
    expect(receipt.remoteCheckFailures).toBe(context.eventName === 'workflow_dispatch' ? 0 : 1);
    expect(remoteChecks).toBe(context.eventName === 'workflow_dispatch' ? 0 : 1);
  }
});

test('a stalled remote lookup fails closed and still runs the command', async () => {
  const child = fakeChild();
  const running = runLatestMainCommand({
    command: ['proof'],
    context: mainPush,
    pollIntervalMs: 1,
    readRemoteMainSha: async () => await new Promise<string | null>(() => {}),
    remoteCheckTimeoutMs: 10,
    spawnCommand: () => child,
  });
  await Bun.sleep(20);
  child.complete(0);
  const receipt = await running;
  expect(receipt.status).toBe('completed');
  expect(receipt.remoteCheckFailures).toBeGreaterThan(0);
});

test('supersession stops a real process group and its descendant promptly', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rapidraw-main-supersession-'));
  const pidFile = join(directory, 'descendant.pid');
  let descendantPid: number | undefined;
  let bodyError: unknown;
  let cleanupError: unknown;
  try {
    let checks = 0;
    const startedAt = performance.now();
    const receipt = await runLatestMainCommand({
      command: [
        'bun',
        '-e',
        `const child=Bun.spawn(['bun','-e','await Bun.sleep(60_000)']);await Bun.write(${JSON.stringify(pidFile)},String(child.pid));await Bun.sleep(60_000);`,
      ],
      context: mainPush,
      pollIntervalMs: 10,
      readRemoteMainSha: async () => {
        checks += 1;
        if (checks === 1) return mainPush.runSha ?? null;
        for (let attempt = 0; attempt < 200 && !(await Bun.file(pidFile).exists()); attempt += 1) await Bun.sleep(5);
        return 'd'.repeat(40);
      },
    });
    expect(receipt.status).toBe('superseded');
    expect(performance.now() - startedAt).toBeLessThan(2_000);
    descendantPid = Number(await Bun.file(pidFile).text());
    let descendantAlive = true;
    for (let attempt = 0; attempt < 100 && descendantAlive; attempt += 1) {
      try {
        process.kill(descendantPid, 0);
        await Bun.sleep(10);
      } catch {
        descendantAlive = false;
      }
    }
    expect(descendantAlive).toBeFalse();
    descendantPid = undefined;
  } catch (error) {
    bodyError = error;
  } finally {
    if (descendantPid !== undefined) {
      try {
        process.kill(descendantPid, 'SIGKILL');
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) cleanupError = error;
      }
    }
    try {
      await rm(directory, { force: true, recursive: true });
    } catch (error) {
      cleanupError ??= error;
    }
  }
  if (bodyError !== undefined) throw bodyError;
  if (cleanupError !== undefined) throw cleanupError;
}, 5_000);

test('CLI publishes a receipt and semantic GitHub output', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rapidraw-main-currentness-'));
  const receiptPath = join(directory, 'receipt.json');
  const outputPath = join(directory, 'github-output');
  try {
    const child = Bun.spawn(['bun', 'scripts/ci/run-latest-main-command.ts', '--', 'true'], {
      env: {
        ...process.env,
        GITHUB_EVENT_NAME: 'workflow_dispatch',
        GITHUB_OUTPUT: outputPath,
        RAWENGINE_MAIN_COMMAND_RECEIPT: receiptPath,
      },
      stderr: 'pipe',
      stdout: 'pipe',
    });
    expect(await child.exited, await new Response(child.stderr).text()).toBe(0);
    expect(await Bun.file(outputPath).text()).toBe('run-command=true\n');
    const receipt: unknown = JSON.parse(await Bun.file(receiptPath).text());
    expect(receipt).toMatchObject({
      contractId: 'rapidraw.main-command-supersession.v1',
      status: 'completed',
    });
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('propagates a current command failure', async () => {
  const child = fakeChild();
  const running = runLatestMainCommand({
    command: ['proof'],
    context: mainPush,
    readRemoteMainSha: async () => mainPush.runSha ?? null,
    spawnCommand: () => child,
  });
  child.complete(7);
  const receipt = await running;
  expect(receipt.status).toBe('failed');
  expect(receipt.exitCode).toBe(7);
});
