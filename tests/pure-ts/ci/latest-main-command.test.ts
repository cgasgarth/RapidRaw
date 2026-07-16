import { expect, test } from 'bun:test';

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
