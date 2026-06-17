#!/usr/bin/env bun
// @ts-check

import { readdirSync, readFileSync } from 'node:fs';

const SCRIPT_DIR = 'scripts';
const MAX_SCRIPTS_WITHOUT_TS_CHECK = 160;

export const collectScriptTypeCoverage = (files) => {
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

const runSelfTest = () => {
  const result = collectScriptTypeCoverage([
    { path: 'scripts/typed.mjs', source: '#!/usr/bin/env bun\n// @ts-check\n' },
    { path: 'scripts/untyped.mjs', source: '#!/usr/bin/env bun\nconsole.log(1);\n' },
    { path: 'scripts/typed.ts', source: '#!/usr/bin/env bun\nconsole.log(1);\n' },
  ]);

  if (result.typedCount !== 2 || result.totalCount !== 3 || result.missingTsCheck[0]?.path !== 'scripts/untyped.mjs') {
    throw new Error('script type coverage self-test failed');
  }

  console.log('script type coverage self-test ok');
};

if (process.argv.includes('--self-test')) {
  runSelfTest();
  process.exit(0);
}

const collectFiles = (directory) =>
  readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = `${directory}/${entry.name}`;
      return entry.isDirectory() ? collectFiles(path) : [path];
    })
    .sort();

const scriptFiles = collectFiles(SCRIPT_DIR)
  .filter((path) => path.endsWith('.js') || path.endsWith('.mjs') || path.endsWith('.ts'))
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
