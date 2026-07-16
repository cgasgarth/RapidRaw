import { describe, expect, test } from 'bun:test';
import { relative, resolve } from 'node:path';

import ts from '@typescript/typescript6';

const repositoryRoot = resolve(import.meta.dir, '../../..');

const parseProject = (relativePath: string): ts.ParsedCommandLine => {
  const configPath = resolve(repositoryRoot, relativePath);
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error !== undefined) {
    throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  }

  return ts.parseJsonConfigFileContent(config.config, ts.sys, repositoryRoot, undefined, configPath);
};

const relativeFiles = (project: ts.ParsedCommandLine): Set<string> =>
  new Set(project.fileNames.map((fileName) => relative(repositoryRoot, fileName)));

const expectBundlerProject = (project: ts.ParsedCommandLine): void => {
  expect(project.options.allowImportingTsExtensions).toBe(true);
  expect(project.options.module).toBe(ts.ModuleKind.Preserve);
  expect(project.options.moduleDetection).toBe(ts.ModuleDetectionKind.Force);
  expect(project.options.moduleResolution).toBe(ts.ModuleResolutionKind.Bundler);
  expect(project.options.noEmit).toBe(true);
  expect(project.options.strict).toBe(true);
  expect(project.options.target).toBe(ts.ScriptTarget.ESNext);
  expect(project.options.verbatimModuleSyntax).toBe(true);
};

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

describe('TypeScript 6/7 runtime project boundaries', () => {
  test('keeps browser production source free of Bun ambient types', () => {
    const project = parseProject('tsconfig.json');
    const files = relativeFiles(project);

    expectBundlerProject(project);
    expect(project.options.types).toEqual([]);
    expect(files.has('src/main.ts')).toBe(true);
    expect([...files].some((path) => path.startsWith('scripts/'))).toBe(false);
    expect([...files].some((path) => path.startsWith('tests/'))).toBe(false);
  });

  test('loads Bun ambient types only for Bun-executed scripts', () => {
    const project = parseProject('scripts/tsconfig.json');
    const files = relativeFiles(project);

    expectBundlerProject(project);
    expect(project.options.types).toEqual(['bun']);
    expect(files.has('scripts/validation/run.ts')).toBe(true);
  });

  test('keeps the portable schema source runtime-neutral', () => {
    const project = parseProject('packages/rawengine-schema/tsconfig.json');
    const files = relativeFiles(project);

    expectBundlerProject(project);
    expect(project.options.types).toEqual([]);
    expect(files.has('packages/rawengine-schema/src/index.ts')).toBe(true);
    expect([...files].some((path) => path.startsWith('packages/rawengine-schema/scripts/'))).toBe(false);
  });

  test('resolves the maintained TypeScript 7 and TypeScript 6 compiler entrypoints', () => {
    expect(compilerVersion('node_modules/typescript/bin/tsc')).toMatch(/^Version 7\./u);
    expect(compilerVersion('node_modules/@typescript/typescript6/bin/tsc6')).toMatch(/^Version 6\./u);
  });
});
