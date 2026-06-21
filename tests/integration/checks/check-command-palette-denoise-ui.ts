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
  "id: 'denoise'",
  'requiresEditorImage: true',
  "command.id === 'denoise'",
  'selectedCommandPaths.length > 0',
  'denoiseModalState',
  'isRaw: selectedImage?.isRaw ?? false',
  'targetPaths: selectedCommandPaths',
  'modals.commandPalette.commands.denoise',
];
const failures = [
  ...requiredModalSnippets
    .filter((snippet) => !modalSource.includes(snippet))
    .map((snippet) => `missing modal snippet: ${snippet}`),
];

if (!schemaSource.includes("'denoise'")) failures.push('missing schema command id: denoise');
if (localeJson.modals?.commandPalette?.commands?.denoise === undefined) {
  failures.push('missing locale key: modals.commandPalette.commands.denoise');
}
if (!packageJson.includes('"check:command-palette-denoise-ui"')) {
  failures.push('missing package script: check:command-palette-denoise-ui');
}
if (!currentPrLocal.includes("'check:command-palette-denoise-ui'")) {
  failures.push('missing current-pr-local route: check:command-palette-denoise-ui');
}

if (failures.length > 0) {
  console.error('command palette denoise UI check failed');
  for (const failure of failures.slice(0, 12)) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('command palette denoise UI ok');
