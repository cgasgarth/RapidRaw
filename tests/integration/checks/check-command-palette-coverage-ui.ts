#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

const [source, locale, packageJson] = await Promise.all([
  readFile('src/components/modals/CommandPaletteModal.tsx', 'utf8'),
  readFile('src/i18n/locales/en.json', 'utf8'),
  readFile('package.json', 'utf8'),
]);

const localeJson = JSON.parse(locale) as {
  modals?: { commandPalette?: { coverage?: Record<string, string>; unavailable?: Record<string, string> } };
};

const requiredSourceSnippets = [
  'coverageCategories',
  'data-testid="command-palette-coverage-summary"',
  'data-command-palette-result-count={visibleCommands.length}',
  'data-command-palette-selected-source-count={selectedCommandPaths.length}',
  'data-command-palette-category={category}',
  'data-command-palette-disabled-reason={disabledReasonKey ?? undefined}',
  'disabled={disabledReasonKey !== null}',
  'modals.commandPalette.coverage.resultCount',
  'modals.commandPalette.coverage.selectedSourceCount',
  'modals.commandPalette.unavailable.selectImage',
  'modals.commandPalette.unavailable.selectSource',
];
const coverage = localeJson.modals?.commandPalette?.coverage ?? {};
const unavailable = localeJson.modals?.commandPalette?.unavailable ?? {};
const failures = [
  ...requiredSourceSnippets.filter((snippet) => !source.includes(snippet)).map((snippet) => `missing: ${snippet}`),
  ...['resultCount_one', 'resultCount_other', 'selectedSourceCount_one', 'selectedSourceCount_other']
    .filter((key) => coverage[key] === undefined)
    .map((key) => `missing locale: ${key}`),
  ...['selectImage', 'selectSource']
    .filter((key) => unavailable[key] === undefined)
    .map((key) => `missing unavailable locale: ${key}`),
];

if (!packageJson.includes('"check:command-palette-coverage-ui"')) {
  failures.push('missing package script: check:command-palette-coverage-ui');
}
if (failures.length > 0) {
  console.error('command palette coverage UI check failed');
  for (const failure of failures.slice(0, 12)) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('command palette coverage UI ok');
