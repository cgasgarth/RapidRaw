#!/usr/bin/env bun

import { withResourceLease } from '../lib/ci/resource-coordinator';

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
const exitCode = await withResourceLease({ label, resource }, async () => {
  const child = Bun.spawn(command, { stderr: 'inherit', stdout: 'inherit' });
  return await child.exited;
});
process.exit(exitCode);
