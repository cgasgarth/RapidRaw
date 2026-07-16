import { describe, expect, test } from 'bun:test';
import { relative, resolve } from 'node:path';

import { API } from 'typescript/unstable/async';

const repositoryRoot = resolve(import.meta.dir, '../../..');

const repositoryRelative = (path: string): string => relative(repositoryRoot, path);

describe('complete TypeScript 7 Bun test project', () => {
  test('strictly includes every TypeScript Bun test source', async () => {
    const api = new API({ cwd: repositoryRoot });
    try {
      const project = await api.parseConfigFile(resolve(import.meta.dir, 'tsconfig.json'));
      const configuredTests = project.fileNames
        .map(repositoryRelative)
        .filter((path) => path.endsWith('.test.ts') || path.endsWith('.test.tsx'))
        .sort();
      const discoveredTests = Array.from(
        new Bun.Glob('tests/pure-ts/**/*.test.{ts,tsx}').scanSync({ cwd: repositoryRoot, onlyFiles: true }),
      ).sort();

      expect(discoveredTests.some((path) => path.endsWith('.test.ts'))).toBe(true);
      expect(discoveredTests.some((path) => path.endsWith('.test.tsx'))).toBe(true);
      expect(configuredTests).toEqual(discoveredTests);
    } finally {
      await api.close();
    }
  });
});
