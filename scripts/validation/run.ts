#!/usr/bin/env bun
import { planValidation, runValidation } from './engine';
import { type ValidationMode, validationManifest } from './manifest';
import { readStagedAutofixPaths, runScopedAutofix } from './scopedAutofix';

const args = process.argv.slice(2);
const valueAfter = (flag: string): string | undefined => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};
const mode = (valueAfter('--mode') ?? 'commit') as ValidationMode;
if (!['commit', 'push', 'pr', 'full', 'release'].includes(mode)) throw new Error(`invalid validation mode: ${mode}`);
const root = process.cwd();
if (args.includes('--fix')) {
  const stagedPaths = readStagedAutofixPaths(root);
  const fixExitCode = runScopedAutofix(root, stagedPaths);
  if (fixExitCode !== 0) process.exit(fixExitCode);
}
const diffArgs = args.includes('--staged')
  ? ['git', 'diff', '--cached', '--name-only', '--diff-filter=ACMR']
  : ['git', 'diff', '--name-only', '--diff-filter=ACMR', valueAfter('--base') ?? 'HEAD'];
const diff = Bun.spawnSync(diffArgs, { cwd: root, stdout: 'pipe', stderr: 'pipe' });
if (diff.exitCode !== 0 && mode !== 'full' && mode !== 'release') throw new Error(diff.stderr.toString().trim());
const changedPaths = diff.stdout.toString().split('\n').filter(Boolean);
if (args.includes('--plan-only')) {
  for (const entry of planValidation(validationManifest, mode, changedPaths)) {
    console.log(`${entry.selected ? 'RUN' : 'SKIP'} ${entry.node.id} (${entry.reason})`);
  }
  process.exit(0);
}
process.exit(
  await runValidation(validationManifest, {
    mode,
    changedPaths,
    noCache: args.includes('--no-cache'),
    verifyCache: args.includes('--verify-cache'),
    explainCache: args.includes('--explain-cache'),
    root,
  }),
);
