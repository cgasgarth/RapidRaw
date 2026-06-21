#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

const [
  exportStateSource,
  eventSchemaSource,
  listenerSource,
  exportPanelSource,
  rustExportSource,
  enLocale,
  frLocale,
  esLocale,
  packageJson,
] = await Promise.all([
  readFile('src/components/ui/ExportImportProperties.ts', 'utf8'),
  readFile('src/schemas/tauriEventSchemas.ts', 'utf8'),
  readFile('src/hooks/useTauriListeners.ts', 'utf8'),
  readFile('src/components/panel/right/ExportPanel.tsx', 'utf8'),
  readFile('src-tauri/src/export_processing.rs', 'utf8'),
  readFile('src/i18n/locales/en.json', 'utf8'),
  readFile('src/i18n/locales/fr.json', 'utf8'),
  readFile('src/i18n/locales/es.json', 'utf8'),
  readFile('package.json', 'utf8'),
]);

const failures = [
  ['ExportReceipt type', exportStateSource.includes('export interface ExportReceipt')],
  ['ExportState lastReceipt', exportStateSource.includes('lastReceipt?: ExportReceipt | undefined')],
  ['Zod export receipt parser', eventSchemaSource.includes('exportReceiptPayloadSchema')],
  ['listener parses export receipt', listenerSource.includes('parseExportReceiptPayload(event.payload)')],
  ['receipt UI test id', exportPanelSource.includes('data-testid="export-success-receipt"')],
  ['show in Finder action', exportPanelSource.includes('data-testid="export-success-show-in-finder"')],
  ['clears stale receipt on new export', exportPanelSource.includes('lastReceipt: undefined')],
  ['Rust receipt payload', rustExportSource.includes('struct ExportReceipt')],
  ['Rust output byte size', rustExportSource.includes('fs::metadata(output_path)')],
  ['Rust emits export complete payload', rustExportSource.includes('ExportReceipt {')],
  ['English receipt locale', enLocale.includes('"exportedFile"') && enLocale.includes('"showInFinder"')],
  ['French receipt locale', frLocale.includes('"exportedFile"') && frLocale.includes('"showInFinder"')],
  ['Spanish receipt locale', esLocale.includes('"exportedFile"') && esLocale.includes('"showInFinder"')],
  ['package script', packageJson.includes('"check:raw-open-edit-export-receipt-ui"')],
]
  .filter(([, passed]) => !passed)
  .map(([label]) => label);

if (failures.length > 0) {
  console.error('RAW open/edit/export receipt UI check failed.');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('raw open/edit/export receipt UI ok');
