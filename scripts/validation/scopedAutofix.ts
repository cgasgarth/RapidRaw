import { spawnSync } from 'node:child_process';

export const readStagedAutofixPaths = (root: string): string[] => {
  const result = spawnSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'], {
    cwd: root,
    encoding: 'buffer',
  });
  if (result.status !== 0) throw new Error(result.stderr.toString().trim() || 'unable to read staged paths');
  return result.stdout
    .toString()
    .split('\0')
    .filter((path) => path.length > 0);
};

/** Formats staged blobs through Biome stdin, never the working copy. */
export const runScopedAutofix = (
  root: string,
  paths: readonly string[],
  biomeCommand: readonly string[] = ['bun', 'node_modules/@biomejs/biome/bin/biome'],
): number => {
  if (paths.length === 0) return 0;
  const [executable, ...command] = biomeCommand;
  const formatted: Array<{ blob: string; mode: string; path: string }> = [];
  for (const path of paths) {
    const indexEntry = spawnSync('git', ['ls-files', '-s', '-z', '--', path], { cwd: root, encoding: 'buffer' });
    if (indexEntry.status !== 0) return indexEntry.status ?? 1;
    const metadata = indexEntry.stdout.toString().split('\0')[0] ?? '';
    const match = /^(\d+)\s+([0-9a-f]+)\s+\d+\t/u.exec(metadata);
    if (match === null) return 1;
    const staged = spawnSync('git', ['show', `:${path}`], { cwd: root, encoding: 'buffer' });
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
    const nextBlob = spawnSync('git', ['hash-object', '-w', '--stdin'], {
      cwd: root,
      encoding: 'utf8',
      input: fix.stdout,
    });
    if (nextBlob.status !== 0) return nextBlob.status ?? 1;
    formatted.push({ blob: nextBlob.stdout.trim(), mode: match[1], path });
  }
  for (const entry of formatted) {
    const update = spawnSync('git', ['update-index', '--cacheinfo', entry.mode, entry.blob, entry.path], {
      cwd: root,
      stdio: 'inherit',
    });
    if (update.status !== 0) return update.status ?? 1;
  }
  return 0;
};
