import { afterEach, describe, expect, test } from 'bun:test';
import { type SpawnSyncOptionsWithStringEncoding, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isolatedGitEnvironment } from '../../scripts/lib/ci/git-environment';
import { readStagedAutofixPaths, runScopedAutofix } from '../../scripts/validation/scopedAutofix';

const roots: string[] = [];
const git = (root: string, ...args: string[]) =>
  spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    env: isolatedGitEnvironment(process.env),
  });
const gitWithInput = (root: string, input: string, ...args: string[]) =>
  spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    env: isolatedGitEnvironment(process.env),
    input,
  } as SpawnSyncOptionsWithStringEncoding);

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe('scoped precommit autofix', () => {
  test('formats only the staged snapshot and preserves unrelated working hunks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rapidraw-scoped-autofix-'));
    roots.push(root);
    expect(git(root, 'init', '-q').status).toBe(0);
    await writeFile(
      join(root, 'biome.json'),
      JSON.stringify({
        $schema: 'https://biomejs.dev/schemas/2.0.0/schema.json',
        formatter: { enabled: true },
        linter: { enabled: false },
      }),
    );
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'src/intended.ts'), 'export const intended={value:1}\n');
    await writeFile(join(root, 'src/unrelated.ts'), 'export const unrelated={value:1}\n');
    expect(git(root, 'add', '.').status).toBe(0);
    expect(
      git(root, '-c', 'user.email=test@example.invalid', '-c', 'user.name=RapidRaw-test', 'commit', '-qm', 'fixture')
        .status,
    ).toBe(0);

    const workingIntended = 'export const intended={value:2};\nexport const extra={value:3}\n';
    await writeFile(join(root, 'src/intended.ts'), workingIntended);
    await writeFile(join(root, 'src/unrelated.ts'), 'export const unrelated={value:2}\n');
    const stagedBlob = gitWithInput(root, 'export const intended={value:2};\n', 'hash-object', '-w', '--stdin');
    expect(stagedBlob.status).toBe(0);
    expect(git(root, 'update-index', '--cacheinfo', '100644', stagedBlob.stdout.trim(), 'src/intended.ts').status).toBe(
      0,
    );

    expect(readStagedAutofixPaths(root)).toEqual(['src/intended.ts']);
    expect(
      runScopedAutofix(root, readStagedAutofixPaths(root), [
        'bun',
        join(process.cwd(), 'node_modules/@biomejs/biome/bin/biome'),
      ]),
    ).toBe(0);
    expect(git(root, 'diff', '--cached', '--name-only').stdout.trim()).toBe('src/intended.ts');
    expect(git(root, 'diff', '--name-only').stdout.trim().split('\n').sort()).toEqual([
      'src/intended.ts',
      'src/unrelated.ts',
    ]);
    expect(await readFile(join(root, 'src/intended.ts'), 'utf8')).toBe(workingIntended);
    expect(git(root, 'show', ':src/intended.ts').stdout).toContain('intended = { value: 2 };');
  });
});
