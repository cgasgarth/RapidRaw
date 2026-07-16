import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type GitSpawnEnvironment = Readonly<Record<string, string | undefined>>;

export const readStagedAutofixPaths = (root: string, gitEnvironment: GitSpawnEnvironment = process.env): string[] => {
  const result = spawnSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'], {
    cwd: root,
    encoding: 'buffer',
    env: gitEnvironment,
  });
  if (result.status !== 0) throw new Error(result.stderr.toString().trim() || 'unable to read staged paths');
  return result.stdout
    .toString()
    .split('\0')
    .filter((path) => path.length > 0);
};

/** Formats staged blobs and synchronizes only working copies that exactly matched their staged snapshot. */
export const runScopedAutofix = (
  root: string,
  paths: readonly string[],
  biomeCommand: readonly string[] = ['bun', 'node_modules/@biomejs/biome/bin/biome'],
  gitEnvironment: GitSpawnEnvironment = process.env,
): number => {
  if (paths.length === 0) return 0;
  const [executable, ...command] = biomeCommand;
  const formatted: Array<{
    blob: string;
    formattedContent: Buffer;
    mode: string;
    path: string;
    stagedContent: Buffer;
    synchronizeWorkingCopy: boolean;
  }> = [];
  for (const path of paths) {
    const indexEntry = spawnSync('git', ['ls-files', '-s', '-z', '--', path], {
      cwd: root,
      encoding: 'buffer',
      env: gitEnvironment,
    });
    if (indexEntry.status !== 0) return indexEntry.status ?? 1;
    const metadata = indexEntry.stdout.toString().split('\0')[0] ?? '';
    const match = /^(\d+)\s+([0-9a-f]+)\s+\d+\t/u.exec(metadata);
    if (match === null) return 1;
    const staged = spawnSync('git', ['show', `:${path}`], {
      cwd: root,
      encoding: 'buffer',
      env: gitEnvironment,
    });
    if (staged.status !== 0) return staged.status ?? 1;
    const fix = spawnSync(executable, [...command, 'check', '--write', '--stdin-file-path', path], {
      cwd: root,
      encoding: 'buffer',
      input: staged.stdout,
    });
    if (fix.status !== 0) {
      process.stderr.write(fix.stderr);
      return fix.status ?? 1;
    }
    if (fix.stdout.equals(staged.stdout)) continue;
    const nextBlob = spawnSync('git', ['hash-object', '-w', '--stdin'], {
      cwd: root,
      encoding: 'utf8',
      env: gitEnvironment,
      input: fix.stdout,
    });
    if (nextBlob.status !== 0) return nextBlob.status ?? 1;
    const workingPath = join(root, path);
    const workingContent = readFileSync(workingPath);
    formatted.push({
      blob: nextBlob.stdout.trim(),
      formattedContent: fix.stdout,
      mode: match[1],
      path,
      stagedContent: staged.stdout,
      synchronizeWorkingCopy: workingContent.equals(staged.stdout),
    });
  }
  for (const entry of formatted) {
    const update = spawnSync('git', ['update-index', '--cacheinfo', entry.mode, entry.blob, entry.path], {
      cwd: root,
      env: gitEnvironment,
      stdio: 'inherit',
    });
    if (update.status !== 0) return update.status ?? 1;
  }
  for (const entry of formatted) {
    if (!entry.synchronizeWorkingCopy) continue;
    const workingPath = join(root, entry.path);
    if (!readFileSync(workingPath).equals(entry.stagedContent)) continue;
    writeFileSync(workingPath, entry.formattedContent);
  }
  return 0;
};
