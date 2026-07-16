import { afterAll, describe, expect, test } from 'bun:test';
import { relative, resolve } from 'node:path';

import { API } from 'typescript/unstable/async';
import { z } from 'zod';

const repositoryRoot = resolve(import.meta.dir, '../../..');
const api = new API({ cwd: repositoryRoot });

const baseConfigSchema = z.object({
  compilerOptions: z.object({
    module: z.literal('preserve'),
    moduleDetection: z.literal('force'),
    moduleResolution: z.literal('bundler'),
    noEmit: z.literal(true),
    strict: z.literal(true),
    target: z.literal('esnext'),
    verbatimModuleSyntax: z.literal(true),
  }),
});

const packageSchema = z.object({
  dependencies: z.record(z.string(), z.string()),
  devDependencies: z.record(z.string(), z.string()),
  scripts: z.record(z.string(), z.string()),
});

const installedPackageSchema = z.object({
  name: z.string(),
  peerDependencies: z.record(z.string(), z.string()).optional(),
  version: z.string(),
});

afterAll(async () => {
  await api.close();
});

const parseProject = async (relativePath: string) => api.parseConfigFile(resolve(repositoryRoot, relativePath));

const relativeFiles = (fileNames: readonly string[]): Set<string> =>
  new Set(fileNames.map((fileName) => relative(repositoryRoot, fileName)));

const compilerVersion = (entrypoint: string): string => {
  const result = Bun.spawnSync(['bun', resolve(repositoryRoot, entrypoint), '--version'], {
    cwd: repositoryRoot,
    stderr: 'pipe',
    stdout: 'pipe',
  });
  if (result.exitCode !== 0) {
    throw new Error(new TextDecoder().decode(result.stderr));
  }
  return new TextDecoder().decode(result.stdout).trim();
};

describe('TypeScript 7 runtime project boundaries', () => {
  test('uses strict Bun-recommended compiler semantics', async () => {
    const config = baseConfigSchema.parse(await Bun.file(resolve(repositoryRoot, 'tsconfig.base.json')).json());
    expect(config.compilerOptions).toEqual({
      module: 'preserve',
      moduleDetection: 'force',
      moduleResolution: 'bundler',
      noEmit: true,
      strict: true,
      target: 'esnext',
      verbatimModuleSyntax: true,
    });
  });

  test('keeps browser production source free of Bun ambient types', async () => {
    const project = await parseProject('tsconfig.json');
    const files = relativeFiles(project.fileNames);

    expect(project.options['types']).toEqual([]);
    expect(files.has('src/main.ts')).toBe(true);
    expect([...files].some((path) => path.startsWith('scripts/'))).toBe(false);
    expect([...files].some((path) => path.startsWith('tests/'))).toBe(false);
  });

  test('loads Bun ambient types only for Bun-executed scripts', async () => {
    const project = await parseProject('scripts/tsconfig.json');
    const files = relativeFiles(project.fileNames);

    expect(project.options['types']).toEqual(['bun']);
    expect(files.has('scripts/validation/run.ts')).toBe(true);
  });

  test('keeps the portable schema source runtime-neutral', async () => {
    const project = await parseProject('packages/rawengine-schema/tsconfig.json');
    const files = relativeFiles(project.fileNames);

    expect(project.options['types']).toEqual([]);
    expect(files.has('packages/rawengine-schema/src/index.ts')).toBe(true);
    expect([...files].some((path) => path.startsWith('packages/rawengine-schema/scripts/'))).toBe(false);
  });

  test('declares one current compiler and no compatibility lane', async () => {
    const packageJson = packageSchema.parse(await Bun.file(resolve(repositoryRoot, 'package.json')).json());
    expect(packageJson.devDependencies['typescript']).toMatch(/^\^7\./u);
    expect(Object.keys(packageJson.devDependencies).filter((name) => name.startsWith('@typescript/'))).toEqual([]);
    expect(Object.keys(packageJson.scripts).filter((name) => name.includes('compat'))).toEqual([]);
    expect(compilerVersion('node_modules/typescript/bin/tsc')).toMatch(/^Version 7\./u);
  });

  test('requires direct dependency TypeScript peers to accept the installed compiler', async () => {
    const packageJson = packageSchema.parse(await Bun.file(resolve(repositoryRoot, 'package.json')).json());
    const compiler = installedPackageSchema.parse(
      await Bun.file(resolve(repositoryRoot, 'node_modules/typescript/package.json')).json(),
    );
    const directDependencyNames = Object.keys({ ...packageJson.dependencies, ...packageJson.devDependencies });
    const typedPeers: Array<{ name: string; range: string; version: string }> = [];

    for (const dependencyName of directDependencyNames) {
      const dependency = installedPackageSchema.parse(
        await Bun.file(resolve(repositoryRoot, 'node_modules', dependencyName, 'package.json')).json(),
      );
      const range = dependency.peerDependencies?.['typescript'];
      if (range !== undefined) typedPeers.push({ name: dependency.name, range, version: dependency.version });
    }

    expect(compiler.version).toMatch(/^7\./u);
    expect(typedPeers.map(({ name }) => name).sort()).toEqual(['i18next', 'react-i18next']);
    for (const dependency of typedPeers) {
      expect({
        acceptsInstalledCompiler: Bun.semver.satisfies(compiler.version, dependency.range),
        dependency: `${dependency.name}@${dependency.version}`,
      }).toEqual({ acceptsInstalledCompiler: true, dependency: `${dependency.name}@${dependency.version}` });
    }
  });
});
