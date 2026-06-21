#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

const [source, locale, packageJson] = await Promise.all([
  readFile('src/components/panel/MainLibrary.tsx', 'utf8'),
  readFile('src/i18n/locales/en.json', 'utf8'),
  readFile('package.json', 'utf8'),
]);

const localeJson = JSON.parse(locale) as {
  library?: { header?: { status?: Record<string, string> } };
};

const requiredSourceSnippets = [
  'data-testid="library-header-workflow-status"',
  'data-library-header-status={item.label}',
  'libraryHeaderStatusItems',
  'filterCriteria.editedStatus',
  'sortCriteria.order',
  'LibraryViewMode.Recursive',
];

const missingSource = requiredSourceSnippets.filter((snippet) => !source.includes(snippet));
const requiredKeys = [
  'searchLabel',
  'searchReady',
  'filterLabel',
  'filterReady',
  'sortLabel',
  'sortValue',
  'viewLabel',
  'ascending',
  'descending',
];
const statusKeys = localeJson.library?.header?.status ?? {};
const missingLocaleKeys = requiredKeys.filter((key) => statusKeys[key] === undefined);

const failures = [
  ...missingSource.map((snippet) => `missing MainLibrary snippet: ${snippet}`),
  ...missingLocaleKeys.map((key) => `missing locale key: library.header.status.${key}`),
];

if (!packageJson.includes('"check:library-header-ui"')) {
  failures.push('missing package script: check:library-header-ui');
}

if (failures.length > 0) {
  console.error('library header UI check failed');
  for (const failure of failures.slice(0, 12)) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('library header UI ok');
