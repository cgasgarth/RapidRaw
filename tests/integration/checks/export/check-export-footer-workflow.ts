#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';
import { Status } from '../../../../src/components/ui/ExportImportProperties.ts';
import { useProcessStore } from '../../../../src/store/useProcessStore.ts';

const [exportPanelSource, processStoreSource, localeSource, packageSource] = await Promise.all([
  readFile('src/components/panel/right/export/ExportPanel.tsx', 'utf8'),
  readFile('src/store/useProcessStore.ts', 'utf8'),
  readFile('src/i18n/locales/en.json', 'utf8'),
  readFile('package.json', 'utf8'),
]);

const locale = JSON.parse(localeSource) as { export?: { status?: Record<string, string> } };
const packageJson = JSON.parse(packageSource) as { scripts?: Record<string, string> };
const statusKeys = locale.export?.status ?? {};
const failures: string[] = [];

const requiredPanelSnippets = [
  'type ExportFooterWorkflowState =',
  "'estimating'",
  "'queued'",
  "'running'",
  "'completed'",
  "'failed'",
  "'canceled'",
  "'importing-linked-variant'",
  "'imported-linked-variant'",
  'data-testid="export-footer-workflow-state"',
  'data-export-footer-workflow-state={exportFooterWorkflowState}',
  'data-export-footer-can-cancel={String(isExporting)}',
  'data-export-footer-can-retry={String((status === Status.Error || status === Status.Cancelled) && canExport)}',
  'data-export-footer-can-open={String(canUseReceiptActions && canOpenReceiptInEditor)}',
  'data-export-footer-can-import-linked-variant={String(canImportLinkedVariant)}',
  'const canImportLinkedVariant =',
  'currentExternalVariantImportedPath === null',
  'disabled={!canImportLinkedVariant}',
  'disabled={!canUseReceiptActions}',
  "t('export.status.exportAgain')",
  "t('export.status.retryExport')",
  'const canShowReceipt = status === Status.Success && Boolean(firstReceiptOutput);',
];

for (const snippet of requiredPanelSnippets) {
  if (!exportPanelSource.includes(snippet)) failures.push(`ExportPanel missing ${snippet}`);
}

const requiredStoreSnippets = [
  'isStartingNewExport',
  'isTerminalWithoutReceipt',
  'isResetting',
  'lastReceipt: undefined',
  'progress: { current: 0, total: 0 }',
];

for (const snippet of requiredStoreSnippets) {
  if (!processStoreSource.includes(snippet)) failures.push(`useProcessStore missing ${snippet}`);
}

const requiredLocaleKeys = [
  'exportAgain',
  'footerCanceled',
  'footerCompleted',
  'footerFailed',
  'footerIdle',
  'footerImportedLinkedVariant',
  'footerImportingLinkedVariant',
  'footerQueued',
  'footerRunning',
  'retryExport',
];

for (const key of requiredLocaleKeys) {
  if (statusKeys[key] === undefined) failures.push(`missing locale export.status.${key}`);
}

if (
  packageJson.scripts?.['check:export-footer-workflow'] !==
  'bun tests/integration/checks/export/check-export-footer-workflow.ts'
) {
  failures.push('package.json missing check:export-footer-workflow');
}

const receipt = {
  completedAt: '2026-06-30T00:00:00.000Z',
  outputs: [
    {
      byteSize: 1024,
      format: 'tiff',
      outputPath: '/tmp/export.tiff',
      sourcePath: '/tmp/source.ARW',
    },
  ],
  total: 1,
};

useProcessStore.setState({
  exportState: {
    errorMessage: '',
    lastReceipt: receipt,
    progress: { current: 1, total: 1 },
    status: Status.Success,
  },
});

useProcessStore.getState().setExportState({ progress: { current: 0, total: 3 }, status: Status.Exporting });
const startedState = useProcessStore.getState().exportState;
if (startedState.lastReceipt !== undefined) failures.push('new export did not clear stale receipt');
if (startedState.errorMessage !== '') failures.push('new export did not clear stale error');
if (startedState.progress.current !== 0 || startedState.progress.total !== 3) {
  failures.push('new export did not preserve provided queued progress');
}

useProcessStore.getState().setExportState({ errorMessage: 'boom', status: Status.Error });
const failedState = useProcessStore.getState().exportState;
if (failedState.lastReceipt !== undefined) failures.push('failed export retained stale receipt');
if (failedState.errorMessage !== 'boom') failures.push('failed export did not preserve error message');

useProcessStore.getState().setExportState({ status: Status.Exporting });
const restartedState = useProcessStore.getState().exportState;
if (restartedState.errorMessage !== '') failures.push('retry export did not clear stale error');
if (restartedState.progress.current !== 0 || restartedState.progress.total !== 0) {
  failures.push('retry export without progress did not reset stale progress');
}

if (failures.length > 0) {
  console.error('export footer workflow check failed');
  for (const failure of failures.slice(0, 16)) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('export footer workflow ok');
