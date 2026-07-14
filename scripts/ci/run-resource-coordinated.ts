#!/usr/bin/env bun

import { acquireResourceLease } from '../lib/ci/resource-coordinator';

const args = process.argv.slice(2);
const separator = args.indexOf('--');
const processIsAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const signalProcessGroup = (pid: number, signal: 'SIGINT' | 'SIGTERM' | 'SIGKILL'): void => {
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

const supervisedParent = args[0] === '--supervise-child-of' ? Number(args[1]) : null;
if (supervisedParent !== null) {
  if (
    !Number.isSafeInteger(supervisedParent) ||
    supervisedParent <= 0 ||
    separator < 0 ||
    separator === args.length - 1
  )
    throw new Error('invalid supervised child invocation');
  const child = Bun.spawn(args.slice(separator + 1), { detached: true, stderr: 'inherit', stdout: 'inherit' });
  let stopReason: 'SIGINT' | 'SIGTERM' | null = null;
  let resolveStop: (() => void) | undefined;
  const stopRequested = new Promise<void>((resolve) => {
    resolveStop = resolve;
  });
  const requestStop = (signal: 'SIGINT' | 'SIGTERM'): void => {
    stopReason ??= signal;
    resolveStop?.();
  };
  const onInterrupt = (): void => requestStop('SIGINT');
  const onTerminate = (): void => requestStop('SIGTERM');
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onTerminate);
  const parentMonitor = setInterval(() => {
    if (!processIsAlive(supervisedParent)) requestStop('SIGTERM');
  }, 25);
  parentMonitor.unref();

  const outcome = await Promise.race([
    child.exited.then((exitCode) => ({ exitCode, stopped: false as const })),
    stopRequested.then(() => ({ exitCode: 143, stopped: true as const })),
  ]);
  if (outcome.stopped) {
    signalProcessGroup(child.pid, stopReason ?? 'SIGTERM');
    const exited = await Promise.race([child.exited.then(() => true), Bun.sleep(1_000).then(() => false)]);
    if (!exited) signalProcessGroup(child.pid, 'SIGKILL');
    await child.exited;
  }
  clearInterval(parentMonitor);
  process.off('SIGINT', onInterrupt);
  process.off('SIGTERM', onTerminate);
  process.exit(outcome.exitCode);
}

const valueAfter = (flag: string): string | undefined => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};
const resource = valueAfter('--resource');
const label = valueAfter('--label');
if (!resource || !label || separator < 0 || separator === args.length - 1) {
  console.error('Usage: run-resource-coordinated.ts --resource name --label name -- command [...args]');
  process.exit(1);
}
const command = args.slice(separator + 1);
const lease = await acquireResourceLease({ label, resource });
try {
  const child = Bun.spawn(['bun', import.meta.path, '--supervise-child-of', String(process.pid), '--', ...command], {
    detached: true,
    stderr: 'inherit',
    stdout: 'inherit',
  });
  await lease.updateOwnerPid(child.pid);
  const forwardSignal = (signal: 'SIGINT' | 'SIGTERM'): void => {
    signalProcessGroup(child.pid, signal);
  };
  const onInterrupt = (): void => forwardSignal('SIGINT');
  const onTerminate = (): void => forwardSignal('SIGTERM');
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onTerminate);
  process.exitCode = await child.exited;
  process.off('SIGINT', onInterrupt);
  process.off('SIGTERM', onTerminate);
} finally {
  await lease.release();
}
