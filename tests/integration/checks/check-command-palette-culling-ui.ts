#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

const [modalSource, schemaSource, locale, packageJson] = await Promise.all([
  readFile('src/components/modals/CommandPaletteModal.tsx', 'utf8'),
  readFile('src/schemas/commandPaletteSchemas.ts', 'utf8'),
  readFile('src/i18n/locales/en.json', 'utf8'),
  readFile('package.json', 'utf8'),
]);

const localeJson = JSON.parse(locale) as {
  modals?: { commandPalette?: { commands?: Record<string, string> } };
};

const requiredModalSnippets = [
  "id: 'culling'",
  'useLibraryStore',
  'selectedCommandPaths',
  'cullingModalState',
  'pathsToCull: selectedCommandPaths',
  'modals.commandPalette.commands.culling',
];
const failures = requiredModalSnippets
  .filter((snippet) => !modalSource.includes(snippet))
  .map((snippet) => `missing modal snippet: ${snippet}`);

if (!schemaSource.includes("'culling'")) failures.push('missing schema command id: culling');
if (localeJson.modals?.commandPalette?.commands?.culling === undefined) {
  failures.push('missing locale key: modals.commandPalette.commands.culling');
}
if (!packageJson.includes('"check:command-palette-culling-ui"')) {
  failures.push('missing package script: check:command-palette-culling-ui');
}

if (failures.length > 0) {
  console.error('command palette culling UI check failed');
  for (const failure of failures.slice(0, 12)) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('command palette culling UI ok');
