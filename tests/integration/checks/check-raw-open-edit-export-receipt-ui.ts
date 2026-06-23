#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

const [
  exportStateSource,
  eventSchemaSource,
  listenerSource,
  exportPanelSource,
  appSource,
  editorViewSource,
  rustExportSource,
  rustFileSource,
  enLocale,
  frLocale,
  esLocale,
  packageJson,
] = await Promise.all([
  readFile('src/components/ui/ExportImportProperties.ts', 'utf8'),
  readFile('src/schemas/tauriEventSchemas.ts', 'utf8'),
  readFile('src/hooks/useTauriListeners.ts', 'utf8'),
  readFile('src/components/panel/right/ExportPanel.tsx', 'utf8'),
  readFile('src/App.tsx', 'utf8'),
  readFile('src/components/views/EditorView.tsx', 'utf8'),
  readFile('src-tauri/src/export_processing.rs', 'utf8'),
  readFile('src-tauri/src/file_management.rs', 'utf8'),
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
  ['open in editor action', exportPanelSource.includes('data-testid="export-success-open-in-editor"')],
  ['open in editor uses shell opener', exportPanelSource.includes('openShellPath(firstReceiptOutput.outputPath)')],
  ['open in editor TIFF gate', exportPanelSource.includes("firstReceiptOutput?.format.toLowerCase() === 'tiff'")],
  ['linked variant import action', exportPanelSource.includes('data-testid="export-success-import-linked-variant"')],
  ['linked variant import invoke', exportPanelSource.includes('Invokes.ImportExternalEditorVariant')],
  ['linked variant import callback prop', exportPanelSource.includes('onLinkedVariantImported?.(receipt.outputPath)')],
  ['library export reveal callback', appSource.includes('onLinkedVariantImported={handleLinkedVariantImported}')],
  ['editor export reveal callback', editorViewSource.includes('onLinkedVariantImported={handleLinkedVariantImported}')],
  ['linked variant refresh before select', appSource.includes('await handleLibraryRefresh()')],
  [
    'linked variant selection',
    appSource.includes('libraryActivePath: path') && editorViewSource.includes('multiSelectedPaths: [path]'),
  ],
  ['linked variant imported state', exportPanelSource.includes('data-testid="export-success-linked-variant-imported"')],
  ['clears stale receipt on new export', exportPanelSource.includes('lastReceipt: undefined')],
  ['Rust linked variant command', rustFileSource.includes('import_external_editor_variant')],
  ['Rust linked variant artifact', rustFileSource.includes('external_editor.import_linked_variant')],
  ['Rust receipt payload', rustExportSource.includes('struct ExportReceipt')],
  ['Rust output byte size', rustExportSource.includes('fs::metadata(output_path)')],
  ['Rust emits export complete payload', rustExportSource.includes('ExportReceipt {')],
  [
    'English receipt locale',
    enLocale.includes('"exportedFile"') &&
      enLocale.includes('"showInFinder"') &&
      enLocale.includes('"openInEditor"') &&
      enLocale.includes('"importLinkedVariant"'),
  ],
  [
    'French receipt locale',
    frLocale.includes('"exportedFile"') && frLocale.includes('"showInFinder"') && frLocale.includes('"openInEditor"'),
  ],
  [
    'Spanish receipt locale',
    esLocale.includes('"exportedFile"') && esLocale.includes('"showInFinder"') && esLocale.includes('"openInEditor"'),
  ],
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
