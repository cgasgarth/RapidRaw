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
  "id: 'collage'",
  'LayoutTemplate',
  'selectedCommandImages',
  '.slice(0, 9)',
  'collageModalState',
  'sourceImages: selectedCommandImages',
  'modals.commandPalette.commands.collage',
];
const failures = requiredModalSnippets
  .filter((snippet) => !modalSource.includes(snippet))
  .map((snippet) => `missing modal snippet: ${snippet}`);

if (!schemaSource.includes("'collage'")) failures.push('missing schema command id: collage');
if (localeJson.modals?.commandPalette?.commands?.collage === undefined) {
  failures.push('missing locale key: modals.commandPalette.commands.collage');
}
if (!packageJson.includes('"check:command-palette-collage-ui"')) {
  failures.push('missing package script: check:command-palette-collage-ui');
}
if (failures.length > 0) {
  console.error('command palette collage UI check failed');
  for (const failure of failures.slice(0, 12)) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('command palette collage UI ok');
