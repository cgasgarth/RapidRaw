#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

const [source, locale, packageJson, currentPrLocal] = await Promise.all([
  readFile('src/components/modals/CommandPaletteModal.tsx', 'utf8'),
  readFile('src/i18n/locales/en.json', 'utf8'),
  readFile('package.json', 'utf8'),
  readFile('tests/integration/checks/check-current-pr-local.ts', 'utf8'),
]);

const localeJson = JSON.parse(locale) as {
  modals?: { commandPalette?: { coverage?: Record<string, string> } };
};

const requiredSourceSnippets = [
  'coverageCategories',
  'data-testid="command-palette-coverage-summary"',
  'data-command-palette-result-count={visibleCommands.length}',
  'data-command-palette-category={category}',
  'modals.commandPalette.coverage.resultCount',
];
const coverage = localeJson.modals?.commandPalette?.coverage ?? {};
const failures = [
  ...requiredSourceSnippets.filter((snippet) => !source.includes(snippet)).map((snippet) => `missing: ${snippet}`),
  ...['resultCount_one', 'resultCount_other']
    .filter((key) => coverage[key] === undefined)
    .map((key) => `missing locale: ${key}`),
];

if (!packageJson.includes('"check:command-palette-coverage-ui"')) {
  failures.push('missing package script: check:command-palette-coverage-ui');
}
if (!currentPrLocal.includes("'check:command-palette-coverage-ui'")) {
  failures.push('missing current-pr-local route: check:command-palette-coverage-ui');
}

if (failures.length > 0) {
  console.error('command palette coverage UI check failed');
  for (const failure of failures.slice(0, 12)) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('command palette coverage UI ok');
