#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

const [modalSource, schemaSource, locale, packageJson, currentPrLocal] = await Promise.all([
  readFile('src/components/modals/CommandPaletteModal.tsx', 'utf8'),
  readFile('src/schemas/commandPaletteSchemas.ts', 'utf8'),
  readFile('src/i18n/locales/en.json', 'utf8'),
  readFile('package.json', 'utf8'),
  readFile('tests/integration/checks/check-current-pr-local.ts', 'utf8'),
]);

const localeJson = JSON.parse(locale) as {
  modals?: { commandPalette?: { commands?: Record<string, string> } };
};

const requiredModalSnippets = [
  "id: 'negativeLab'",
  "command.id === 'negativeLab'",
  'selectedCommandPaths.length > 0',
  'negativeModalState',
  'targetPaths: selectedCommandPaths',
  'modals.commandPalette.commands.negativeLab',
];
const failures = requiredModalSnippets
  .filter((snippet) => !modalSource.includes(snippet))
  .map((snippet) => `missing modal snippet: ${snippet}`);

if (!schemaSource.includes("'negativeLab'")) failures.push('missing schema command id: negativeLab');
if (localeJson.modals?.commandPalette?.commands?.negativeLab === undefined) {
  failures.push('missing locale key: modals.commandPalette.commands.negativeLab');
}
if (!packageJson.includes('"check:command-palette-negative-lab-ui"')) {
  failures.push('missing package script: check:command-palette-negative-lab-ui');
}
if (!currentPrLocal.includes("'check:command-palette-negative-lab-ui'")) {
  failures.push('missing current-pr-local route: check:command-palette-negative-lab-ui');
}

if (failures.length > 0) {
  console.error('command palette negative lab UI check failed');
  for (const failure of failures.slice(0, 12)) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('command palette negative lab UI ok');
