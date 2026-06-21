#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

const [source, locale, packageJson] = await Promise.all([
  readFile('src/components/panel/editor/EditorToolbar.tsx', 'utf8'),
  readFile('src/i18n/locales/en.json', 'utf8'),
  readFile('package.json', 'utf8'),
]);

const localeJson = JSON.parse(locale) as {
  editor?: { toolbar?: { historyDepth?: string; tooltips?: Record<string, string> } };
};

const requiredSourceSnippets = [
  'historyDepthLabel',
  'historyDepthTotal',
  'data-testid="editor-history-depth-control"',
  'setIsHistoryVisible((prev) => !prev)',
  "t('editor.toolbar.tooltips.history')",
];
const missingSource = requiredSourceSnippets.filter((snippet) => !source.includes(snippet));
const toolbar = localeJson.editor?.toolbar;
const failures = missingSource.map((snippet) => `missing EditorToolbar snippet: ${snippet}`);

if (toolbar?.historyDepth === undefined) failures.push('missing locale key: editor.toolbar.historyDepth');
if (toolbar?.tooltips?.history === undefined) failures.push('missing locale key: editor.toolbar.tooltips.history');
if (!packageJson.includes('"check:editor-history-toolbar-ui"')) {
  failures.push('missing package script: check:editor-history-toolbar-ui');
}
if (failures.length > 0) {
  console.error('editor history toolbar UI check failed');
  for (const failure of failures.slice(0, 12)) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('editor history toolbar UI ok');
