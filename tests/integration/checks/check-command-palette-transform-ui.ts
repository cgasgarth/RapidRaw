#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

const [modalSource, schemaSource, cropPanelSource, uiStoreSource, locale, packageJson] = await Promise.all([
  readFile('src/components/modals/CommandPaletteModal.tsx', 'utf8'),
  readFile('src/schemas/commandPaletteSchemas.ts', 'utf8'),
  readFile('src/components/panel/right/CropPanel.tsx', 'utf8'),
  readFile('src/store/useUIStore.ts', 'utf8'),
  readFile('src/i18n/locales/en.json', 'utf8'),
  readFile('package.json', 'utf8'),
]);

const localeJson = JSON.parse(locale) as {
  modals?: { commandPalette?: { commands?: Record<string, string> } };
};

const requiredSnippets = [
  [modalSource, "id: 'transformTools'"],
  [modalSource, 'requiresEditorImage: true'],
  [modalSource, 'setRightPanel(Panel.Crop)'],
  [modalSource, 'isTransformModalOpen: true'],
  [modalSource, 'modals.commandPalette.commands.transformTools'],
  [schemaSource, "'transformTools'"],
  [cropPanelSource, 'isTransformModalOpen'],
  [cropPanelSource, 'setUI({ isTransformModalOpen: false })'],
  [uiStoreSource, 'isTransformModalOpen: boolean'],
  [uiStoreSource, 'isTransformModalOpen: false'],
] as const;

const failures = requiredSnippets
  .filter(([source, snippet]) => !source.includes(snippet))
  .map(([, snippet]) => `missing snippet: ${snippet}`);

if (localeJson.modals?.commandPalette?.commands?.transformTools === undefined) {
  failures.push('missing locale key: modals.commandPalette.commands.transformTools');
}
if (!packageJson.includes('"check:command-palette-transform-ui"')) {
  failures.push('missing package script: check:command-palette-transform-ui');
}

if (failures.length > 0) {
  console.error('command palette transform UI check failed');
  for (const failure of failures.slice(0, 12)) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('command palette transform UI ok');
