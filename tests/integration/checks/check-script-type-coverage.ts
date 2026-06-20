#!/usr/bin/env bun

import { readdirSync, readFileSync } from 'node:fs';
import process from 'node:process';

const SCRIPT_DIRS = ['scripts', 'tests/integration/checks'] as const;
const MAX_SCRIPTS_WITHOUT_TS_CHECK = 0;

type ScriptSource = {
  path: string;
  source: string;
};

export const collectScriptTypeCoverage = (files: readonly ScriptSource[]) => {
  const missingTsCheck = files.filter(({ path, source }) => {
    if (path.endsWith('.ts')) {
      return false;
    }

    const firstLines = source.split(/\r?\n/u).slice(0, 3).join('\n');
    return !firstLines.includes('@ts-check');
  });

  return {
    missingTsCheck,
    typedCount: files.length - missingTsCheck.length,
    totalCount: files.length,
  };
};

const runSelfTest = (): void => {
  const result = collectScriptTypeCoverage([
    { path: 'scripts/typed.js', source: '#!/usr/bin/env bun\n// @ts-check\n' },
    { path: 'scripts/untyped.js', source: '#!/usr/bin/env bun\nconsole.log(1);\n' },
    { path: 'scripts/typed.ts', source: '#!/usr/bin/env bun\nconsole.log(1);\n' },
  ]);

  if (result.typedCount !== 2 || result.totalCount !== 3 || result.missingTsCheck[0]?.path !== 'scripts/untyped.js') {
    throw new Error('script type coverage self-test failed');
  }

  console.log('script type coverage self-test ok');
};

if (process.argv.includes('--self-test')) {
  runSelfTest();
  process.exit(0);
}

const collectFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = `${directory}/${entry.name}`;
      return entry.isDirectory() ? collectFiles(path) : [path];
    })
    .sort();

const scriptFiles = SCRIPT_DIRS.flatMap((directory) => collectFiles(directory))
  .filter((path) => path.endsWith('.js') || path.endsWith('.ts'))
  .map((path) => ({ path, source: readFileSync(path, 'utf8') }));

const coverage = collectScriptTypeCoverage(scriptFiles);

if (coverage.missingTsCheck.length > MAX_SCRIPTS_WITHOUT_TS_CHECK) {
  const newDebt = coverage.missingTsCheck
    .slice(MAX_SCRIPTS_WITHOUT_TS_CHECK, MAX_SCRIPTS_WITHOUT_TS_CHECK + 10)
    .map(({ path }) => path);
  throw new Error(
    `Script @ts-check debt increased: ${coverage.missingTsCheck.length}/${coverage.totalCount} missing. New files need @ts-check or a typed-script plan. Examples: ${newDebt.join(', ')}`,
  );
}

console.log(
  `script type coverage ok (${coverage.typedCount}/${coverage.totalCount} @ts-check, debt cap ${MAX_SCRIPTS_WITHOUT_TS_CHECK})`,
);
