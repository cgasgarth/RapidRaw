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
const child = Bun.spawn(command, { detached: true, stderr: 'inherit', stdout: 'inherit' });
await lease.updateOwnerPid(child.pid);
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    try {
      process.kill(-child.pid, signal);
    } catch {
      child.kill(signal);
    }
  });
}
const exitCode = await child.exited;
await lease.release();
process.exit(exitCode);
