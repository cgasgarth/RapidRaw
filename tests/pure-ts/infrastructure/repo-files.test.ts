import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { toRepoPath, walkRepoFiles } from '../../../scripts/lib/ci/repo-files';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

const makeRoot = (): string => {
  const root = join(tmpdir(), `rapidraw-repo-files-${crypto.randomUUID()}`);
  roots.push(root);
  mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
  mkdirSync(join(root, 'docs'), { recursive: true });
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true });
  mkdirSync(join(root, 'src-tauri', 'target'), { recursive: true });

  writeFileSync(join(root, '.github', 'workflows', 'lint.yml'), 'name: lint');
  writeFileSync(join(root, 'docs', 'guide.md'), '# Guide');
  writeFileSync(join(root, 'src', 'main.ts'), 'export const value = 1;');
  writeFileSync(join(root, 'node_modules', 'pkg', 'index.ts'), 'export const ignored = true;');
  writeFileSync(join(root, 'src-tauri', 'target', 'generated.ts'), 'export const ignored = true;');

  return root;
};

describe('repo file walking', () => {
  test('walks visible and dot-directory files while preserving ignored build/dependency paths', () => {
    const root = makeRoot();

    const repoPaths = walkRepoFiles({
      include: ({ repoPath }) => repoPath.endsWith('.ts') || repoPath.endsWith('.yml'),
      root,
    })
      .map((absolutePath) => toRepoPath(root, absolutePath))
      .sort();

    expect(repoPaths).toEqual(['.github/workflows/lint.yml', 'src/main.ts']);
  });

  test('supports scanning from a nested start directory', () => {
    const root = makeRoot();

    const repoPaths = walkRepoFiles({
      include: ({ repoPath }) => repoPath.endsWith('.md'),
      root,
      startDir: join(root, 'docs'),
    }).map((absolutePath) => toRepoPath(root, absolutePath));

    expect(repoPaths).toEqual(['docs/guide.md']);
  });
});
