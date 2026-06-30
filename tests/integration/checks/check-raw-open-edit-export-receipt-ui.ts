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
  readFile('src/hooks/app/useTauriListeners.ts', 'utf8'),
  readFile('src/components/panel/right/export/ExportPanel.tsx', 'utf8'),
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
  ['export raw warning chips', exportPanelSource.includes('data-testid="export-raw-warning-chips"')],
  [
    'export raw warning codes',
    exportPanelSource.includes(
      "data-export-raw-warning-codes={exportRawWarningChips.map((chip) => chip.code).join(',')}",
    ),
  ],
  ['show in Finder action', exportPanelSource.includes('data-testid="export-success-show-in-finder"')],
  ['open in editor action', exportPanelSource.includes('data-testid="export-success-open-in-editor"')],
  ['choose external editor action', exportPanelSource.includes('data-testid="export-success-choose-external-editor"')],
  ['external editor persisted setting', exportPanelSource.includes('externalEditorPath: selectedPath')],
  [
    'external editor configured label',
    exportPanelSource.includes('data-testid="export-success-external-editor-config"'),
  ],
  ['external editor watch invoke', exportPanelSource.includes('Invokes.GetExternalEditorFileWatchSnapshot')],
  ['external editor watch status', exportPanelSource.includes('data-testid="export-success-external-editor-watch"')],
  [
    'external editor save detection marker',
    exportPanelSource.includes('data-external-editor-save-detected={String(currentExternalEditorWatch.detected)}'),
  ],
  ['open in editor uses configured launcher', exportPanelSource.includes('Invokes.LaunchExternalEditor')],
  ['open in editor TIFF gate', exportPanelSource.includes("firstReceiptOutput?.format.toLowerCase() === 'tiff'")],
  ['linked variant import action', exportPanelSource.includes('data-testid="export-success-import-linked-variant"')],
  ['linked variant import invoke', exportPanelSource.includes('Invokes.ImportExternalEditorVariant')],
  ['linked variant bit-depth handoff', exportPanelSource.includes('bitDepth: output.bitDepth ?? null')],
  [
    'linked variant verified bit depth schema',
    exportPanelSource.includes('verifiedBitDepth: z.number().int().positive()'),
  ],
  ['linked variant embedded ICC schema', exportPanelSource.includes('embeddedIccProfile: z.boolean()')],
  [
    'linked variant verified bit depth marker',
    exportPanelSource.includes(
      "data-external-editor-verified-bit-depth={currentExternalVariantVerifiedBitDepth ?? ''}",
    ),
  ],
  [
    'linked variant embedded ICC marker',
    exportPanelSource.includes(
      'data-external-editor-embedded-icc-profile={String(currentExternalVariantEmbeddedIccProfile)}',
    ),
  ],
  ['linked variant color-profile handoff', exportPanelSource.includes('colorProfile: output.colorProfile ?? null')],
  [
    'linked variant rendering-intent handoff',
    exportPanelSource.includes('renderingIntent: output.renderingIntent ?? null'),
  ],
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
  ['Rust configured editor launcher', rustFileSource.includes('launch_external_editor')],
  ['Rust external editor watch snapshot command', rustFileSource.includes('get_external_editor_file_watch_snapshot')],
  ['Rust linked variant artifact', rustFileSource.includes('external_editor.import_linked_variant')],
  [
    'Rust linked variant no-overwrite policy',
    rustFileSource.includes('"noOverwritePolicy": "never_overwrite_original"'),
  ],
  [
    'Rust linked variant verified bit-depth lineage',
    rustFileSource.includes('"bitDepthProvenance": "decoded_tiff_matches_export_receipt"'),
  ],
  [
    'Rust linked variant embedded ICC verification',
    rustFileSource.includes('"embeddedIccProfile": tiff_inspection.embedded_icc_profile'),
  ],
  ['Rust linked variant ICC profile lineage', rustFileSource.includes('"embedded_icc_profile_present"')],
  [
    'Rust linked variant rendering-intent lineage',
    rustFileSource.includes('"renderingIntentProvenance": "export_receipt"'),
  ],
  ['Rust receipt payload', rustExportSource.includes('struct ExportReceipt')],
  ['Rust output byte size', rustExportSource.includes('fs::metadata(output_path)')],
  ['Rust emits export complete payload', rustExportSource.includes('ExportReceipt {')],
  [
    'English receipt locale',
    enLocale.includes('"exportedFile"') &&
      enLocale.includes('"showInFinder"') &&
      enLocale.includes('"openInEditor"') &&
      enLocale.includes('"chooseExternalEditor"') &&
      enLocale.includes('"externalEditorSaveDetected"') &&
      enLocale.includes('"externalEditorWatching"') &&
      enLocale.includes('"importLinkedVariant"') &&
      enLocale.includes('Original left untouched'),
  ],
  [
    'French receipt locale',
    frLocale.includes('"exportedFile"') &&
      frLocale.includes('"showInFinder"') &&
      frLocale.includes('"openInEditor"') &&
      frLocale.includes('"chooseExternalEditor"'),
  ],
  [
    'Spanish receipt locale',
    esLocale.includes('"exportedFile"') &&
      esLocale.includes('"showInFinder"') &&
      esLocale.includes('"openInEditor"') &&
      esLocale.includes('"chooseExternalEditor"'),
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
