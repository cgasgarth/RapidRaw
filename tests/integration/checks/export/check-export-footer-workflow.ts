#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';
import { Status } from '../../../../src/components/ui/ExportImportProperties.ts';
import { useProcessStore } from '../../../../src/store/useProcessStore.ts';

const [exportPanelSource, processStoreSource, localeSource] = await Promise.all([
  readFile('src/components/panel/right/export/ExportPanel.tsx', 'utf8'),
  readFile('src/store/useProcessStore.ts', 'utf8'),
  readFile('src/i18n/locales/en.json', 'utf8'),
]);

const locale = JSON.parse(localeSource) as { export?: { status?: Record<string, string> } };
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
  "'cancelling'",
  "'partial'",
  "'missing-output'",
  "'importing-linked-variant'",
  "'imported-linked-variant'",
  'data-testid="export-footer-workflow-state"',
  'data-export-footer-workflow-state={exportFooterWorkflowState}',
  'data-export-footer-can-cancel={String(isExporting)}',
  'data-export-footer-can-retry={String((status === Status.Error || status === Status.Cancelled) && canExport)}',
  'data-export-footer-can-open={String(canUseReceiptActions && canOpenReceiptInEditor)}',
  'data-export-footer-can-import-linked-variant={String(canImportLinkedVariant)}',
  'data-export-footer-selected-count={numImages}',
  'data-export-footer-smart-preview-state={',
  'data-export-footer-format-profile={exportFooterFormatProfileText}',
  'data-export-footer-latest-receipt-path={latestReceiptOutputPath}',
  'data-export-footer-latest-receipt-hash={latestReceiptHash}',
  'data-testid="export-footer-review-selected"',
  'data-testid="export-footer-review-format-profile"',
  'data-testid="export-footer-review-resize"',
  'data-testid="export-footer-review-smart-preview"',
  'data-testid="export-footer-review-parity"',
  'data-testid="export-footer-review-receipt"',
  'data-testid="export-proof-footer-proof-state"',
  'shouldShowProofDiagnostics',
  'group-open:rotate-180',
  "aria-label={t('export.softProofWarnings.title')}",
  'data-testid="export-output-contract"',
  'data-testid="export-output-contract-status"',
  'data-testid="export-incomplete-alert"',
  "data-export-incomplete-state={hasMissingOutput ? 'missing-output' : 'partial'}",
  'aria-live="polite"',
  'setIsCancellingExport(true);',
  'const canImportLinkedVariant =',
  'const hasMissingOutput =',
  'const hasPartialExport =',
  'const exportContractIssue =',
  'currentExternalVariantImportedPath === null',
  'disabled={!canImportLinkedVariant}',
  'disabled={!canUseReceiptActions}',
  "t('export.status.exportAgain')",
  "t('export.status.retryExport')",
  'const canShowReceipt =',
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
  'reviewParityPending',
  'reviewReceipt',
  'reviewReceiptUnavailable',
  'reviewSelected',
  'reviewSmartPreviewBlocked',
  'reviewSmartPreviewReady',
  'reviewSmartPreviewResolving',
  'retryExport',
];

for (const key of requiredLocaleKeys) {
  if (statusKeys[key] === undefined) failures.push(`missing locale export.status.${key}`);
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
  terminalStatus: 'completed' as const,
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
