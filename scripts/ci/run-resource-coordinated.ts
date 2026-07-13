#!/usr/bin/env bun

import { acquireResourceLease } from '../lib/ci/resource-coordinator';

const args = process.argv.slice(2);
const separator = args.indexOf('--');
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
  const child = Bun.spawn(command, { detached: true, stderr: 'inherit', stdout: 'inherit' });
  await lease.updateOwnerPid(child.pid);
  const forwardSignal = (signal: 'SIGINT' | 'SIGTERM'): void => {
    try {
      process.kill(-child.pid, signal);
    } catch {
      child.kill(signal);
    }
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
