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
  [modalSource, "id: 'lensCorrection'"],
  [modalSource, 'requiresEditorImage: true'],
  [modalSource, 'setRightPanel(Panel.Crop)'],
  [modalSource, 'isLensCorrectionModalOpen: true'],
  [modalSource, 'modals.commandPalette.commands.lensCorrection'],
  [schemaSource, "'lensCorrection'"],
  [cropPanelSource, 'isLensCorrectionModalOpen'],
  [cropPanelSource, 'setUI({ isLensCorrectionModalOpen: false })'],
  [uiStoreSource, 'isLensCorrectionModalOpen: boolean'],
  [uiStoreSource, 'isLensCorrectionModalOpen: false'],
] as const;

const failures = requiredSnippets
  .filter(([source, snippet]) => !source.includes(snippet))
  .map(([, snippet]) => `missing snippet: ${snippet}`);

if (localeJson.modals?.commandPalette?.commands?.lensCorrection === undefined) {
  failures.push('missing locale key: modals.commandPalette.commands.lensCorrection');
}
if (!packageJson.includes('"check:command-palette-lens-ui"')) {
  failures.push('missing package script: check:command-palette-lens-ui');
}
if (failures.length > 0) {
  console.error('command palette lens UI check failed');
  for (const failure of failures.slice(0, 12)) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('command palette lens UI ok');
