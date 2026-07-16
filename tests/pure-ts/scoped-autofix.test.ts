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
  test('commits import-order drift format-green on the first scoped fix', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rapidraw-scoped-autofix-imports-'));
    roots.push(root);
    expect(git(root, 'init', '-q').status).toBe(0);
    expect(git(root, 'config', 'core.fsmonitor', 'false').status).toBe(0);
    await writeFile(
      join(root, 'biome.json'),
      JSON.stringify({
        $schema: 'https://biomejs.dev/schemas/2.0.0/schema.json',
        formatter: { enabled: true },
        linter: { enabled: false },
      }),
    );
    const source =
      "import { join } from 'node:path';\nimport { readFile } from 'node:fs/promises';\nexport { join, readFile };\n";
    await writeFile(join(root, 'fixture.ts'), source);
    expect(git(root, 'add', '.').status).toBe(0);

    const gitEnvironment = isolatedGitEnvironment(process.env);
    const biomeCommand = ['bun', join(process.cwd(), 'node_modules/@biomejs/biome/bin/biome')];
    expect(runScopedAutofix(root, readStagedAutofixPaths(root, gitEnvironment), biomeCommand, gitEnvironment)).toBe(0);
    const formatted = git(root, 'show', ':fixture.ts').stdout;
    expect(formatted.indexOf('node:fs/promises')).toBeLessThan(formatted.indexOf('node:path'));
    expect(await readFile(join(root, 'fixture.ts'), 'utf8')).toBe(formatted);
    expect(
      git(root, '-c', 'user.email=test@example.invalid', '-c', 'user.name=RapidRaw-test', 'commit', '-qm', 'fixture')
        .status,
    ).toBe(0);
    expect(git(root, 'status', '--porcelain').stdout).toBe('');
    expect(spawnSync(biomeCommand[0], [biomeCommand[1], 'ci', 'fixture.ts'], { cwd: root }).status).toBe(0);
  });

  test('formats only the staged snapshot and preserves partially staged working hunks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rapidraw-scoped-autofix-'));
    roots.push(root);
    expect(git(root, 'init', '-q').status).toBe(0);
    expect(git(root, 'config', 'core.fsmonitor', 'false').status).toBe(0);
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

    const gitEnvironment = isolatedGitEnvironment(process.env);
    expect(readStagedAutofixPaths(root, gitEnvironment)).toEqual(['src/intended.ts']);
    expect(
      runScopedAutofix(
        root,
        readStagedAutofixPaths(root, gitEnvironment),
        ['bun', join(process.cwd(), 'node_modules/@biomejs/biome/bin/biome')],
        gitEnvironment,
      ),
    ).toBe(0);
    expect(git(root, 'diff', '--cached', '--name-only').stdout.trim()).toBe('src/intended.ts');
    expect(git(root, 'diff', '--name-only').stdout.trim().split('\n').sort()).toEqual([
      'src/intended.ts',
      'src/unrelated.ts',
    ]);
    expect(await readFile(join(root, 'src/intended.ts'), 'utf8')).toBe(workingIntended);
    expect(git(root, 'show', ':src/intended.ts').stdout).toContain('intended = { value: 2 };');
  });

  test('synchronizes a fully staged fix without touching an unrelated dirty file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rapidraw-scoped-autofix-unrelated-'));
    roots.push(root);
    expect(git(root, 'init', '-q').status).toBe(0);
    expect(git(root, 'config', 'core.fsmonitor', 'false').status).toBe(0);
    await writeFile(
      join(root, 'biome.json'),
      JSON.stringify({
        $schema: 'https://biomejs.dev/schemas/2.0.0/schema.json',
        formatter: { enabled: true },
        linter: { enabled: false },
      }),
    );
    await writeFile(join(root, 'intended.ts'), 'export const intended = 1;\n');
    await writeFile(join(root, 'unrelated.ts'), 'export const unrelated = 1;\n');
    expect(git(root, 'add', '.').status).toBe(0);
    expect(
      git(root, '-c', 'user.email=test@example.invalid', '-c', 'user.name=RapidRaw-test', 'commit', '-qm', 'fixture')
        .status,
    ).toBe(0);

    await writeFile(join(root, 'intended.ts'), 'export const intended={value:2}\n');
    expect(git(root, 'add', 'intended.ts').status).toBe(0);
    const unrelated = 'export const unrelated = { keep:   true };\n';
    await writeFile(join(root, 'unrelated.ts'), unrelated);
    const gitEnvironment = isolatedGitEnvironment(process.env);
    expect(
      runScopedAutofix(
        root,
        readStagedAutofixPaths(root, gitEnvironment),
        ['bun', join(process.cwd(), 'node_modules/@biomejs/biome/bin/biome')],
        gitEnvironment,
      ),
    ).toBe(0);

    expect(git(root, 'diff', '--cached', '--name-only').stdout.trim()).toBe('intended.ts');
    expect(git(root, 'diff', '--name-only').stdout.trim()).toBe('unrelated.ts');
    expect(await readFile(join(root, 'unrelated.ts'), 'utf8')).toBe(unrelated);
    expect(await readFile(join(root, 'intended.ts'), 'utf8')).toBe(git(root, 'show', ':intended.ts').stdout);
  });

  test('leaves an already formatted staged path unchanged', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rapidraw-scoped-autofix-noop-'));
    roots.push(root);
    expect(git(root, 'init', '-q').status).toBe(0);
    expect(git(root, 'config', 'core.fsmonitor', 'false').status).toBe(0);
    await writeFile(
      join(root, 'biome.json'),
      JSON.stringify({
        $schema: 'https://biomejs.dev/schemas/2.0.0/schema.json',
        formatter: { enabled: true },
        linter: { enabled: false },
      }),
    );
    const source = 'export const fixture = { value: 1 };\n';
    await writeFile(join(root, 'fixture.ts'), source);
    expect(git(root, 'add', '.').status).toBe(0);
    const indexBefore = git(root, 'ls-files', '-s', 'fixture.ts').stdout;
    const gitEnvironment = isolatedGitEnvironment(process.env);
    expect(
      runScopedAutofix(
        root,
        ['fixture.ts'],
        ['bun', join(process.cwd(), 'node_modules/@biomejs/biome/bin/biome')],
        gitEnvironment,
      ),
    ).toBe(0);
    expect(git(root, 'ls-files', '-s', 'fixture.ts').stdout).toBe(indexBefore);
    expect(git(root, 'show', ':fixture.ts').stdout).toBe(source);
    expect(await readFile(join(root, 'fixture.ts'), 'utf8')).toBe(source);
  });

  test('updates only the fixture index when the parent process exports a hook index', async () => {
    const parentRoot = await mkdtemp(join(tmpdir(), 'rapidraw-parent-index-'));
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'rapidraw-fixture-index-'));
    roots.push(parentRoot, fixtureRoot);

    expect(git(parentRoot, 'init', '-q').status).toBe(0);
    expect(git(parentRoot, 'config', 'core.fsmonitor', 'false').status).toBe(0);
    await writeFile(join(parentRoot, 'parent.ts'), 'export const parent = 1;\n');
    expect(git(parentRoot, 'add', 'parent.ts').status).toBe(0);
    const parentIndexPath = join(parentRoot, '.git/index');
    const parentIndexBefore = await readFile(parentIndexPath);
    const parentEntriesBefore = git(parentRoot, 'ls-files', '-s').stdout;

    const hookEnvironment = { ...process.env, GIT_INDEX_FILE: parentIndexPath };
    const gitEnvironment = isolatedGitEnvironment(hookEnvironment);
    expect(gitEnvironment.GIT_INDEX_FILE).toBeUndefined();
    expect(git(fixtureRoot, 'init', '-q').status).toBe(0);
    expect(git(fixtureRoot, 'config', 'core.fsmonitor', 'false').status).toBe(0);
    await writeFile(
      join(fixtureRoot, 'biome.json'),
      JSON.stringify({
        $schema: 'https://biomejs.dev/schemas/2.0.0/schema.json',
        formatter: { enabled: true },
        linter: { enabled: false },
      }),
    );
    await writeFile(join(fixtureRoot, 'fixture.ts'), 'export const fixture={value:1}\n');
    expect(git(fixtureRoot, 'add', '.').status).toBe(0);

    expect(readStagedAutofixPaths(fixtureRoot, gitEnvironment)).toEqual(['biome.json', 'fixture.ts']);
    expect(
      runScopedAutofix(
        fixtureRoot,
        ['fixture.ts'],
        ['bun', join(process.cwd(), 'node_modules/@biomejs/biome/bin/biome')],
        gitEnvironment,
      ),
    ).toBe(0);

    expect(git(fixtureRoot, 'show', ':fixture.ts').stdout).toContain('fixture = { value: 1 };');
    expect(git(fixtureRoot, 'ls-files', '-s').stdout).toContain('fixture.ts');
    expect(await readFile(parentIndexPath)).toEqual(parentIndexBefore);
    expect(git(parentRoot, 'ls-files', '-s').stdout).toBe(parentEntriesBefore);
  });
});
