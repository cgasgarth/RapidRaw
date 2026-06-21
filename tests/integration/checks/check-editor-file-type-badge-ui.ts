#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

const [source, locale, packageJson] = await Promise.all([
  readFile('src/components/panel/editor/EditorToolbar.tsx', 'utf8'),
  readFile('src/i18n/locales/en.json', 'utf8'),
  readFile('package.json', 'utf8'),
]);

const localeJson = JSON.parse(locale) as {
  editor?: { toolbar?: { tooltips?: Record<string, string> } };
};

const requiredSourceSnippets = [
  'fileTypeLabel',
  'exec(fullFileName)',
  'data-testid="editor-file-type-badge"',
  "t('editor.toolbar.tooltips.fileType')",
];
const failures = requiredSourceSnippets
  .filter((snippet) => !source.includes(snippet))
  .map((snippet) => `missing: ${snippet}`);

if (localeJson.editor?.toolbar?.tooltips?.fileType === undefined) {
  failures.push('missing locale: editor.toolbar.tooltips.fileType');
}
if (!packageJson.includes('"check:editor-file-type-badge-ui"')) {
  failures.push('missing package script: check:editor-file-type-badge-ui');
}

if (failures.length > 0) {
  console.error('editor file type badge UI check failed');
  for (const failure of failures.slice(0, 12)) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('editor file type badge UI ok');
