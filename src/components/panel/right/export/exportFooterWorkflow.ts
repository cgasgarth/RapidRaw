import { type ExportState, Status } from '../../../ui/ExportImportProperties';

export type ExportFooterWorkflowState =
  | 'canceled'
  | 'cancelling'
  | 'completed'
  | 'estimating'
  | 'failed'
  | 'idle'
  | 'imported-linked-variant'
  | 'importing-linked-variant'
  | 'missing-output'
  | 'partial'
  | 'queued'
  | 'running';

export type ExportFooterStatusTone = 'danger' | 'info' | 'neutral' | 'success' | 'warning';

interface DeriveExportFooterWorkflowInput {
  canExport: boolean;
  canOpenReceiptInEditor: boolean;
  currentExternalVariantImportedPath: string | null;
  exportState: ExportState;
  isCancellingExport: boolean;
  isEstimating: boolean;
  isImportingCurrentExternalVariant: boolean;
}

export interface ExportFooterWorkflow {
  canImportLinkedVariant: boolean;
  canShowReceipt: boolean;
  canUseReceiptActions: boolean;
  hasMissingOutput: boolean;
  hasPartialExport: boolean;
  progressCurrent: number;
  receiptOutputCount: number;
  state: ExportFooterWorkflowState;
  tone: ExportFooterStatusTone;
}

export function deriveExportFooterWorkflow({
  canExport,
  canOpenReceiptInEditor,
  currentExternalVariantImportedPath,
  exportState,
  isCancellingExport,
  isEstimating,
  isImportingCurrentExternalVariant,
}: DeriveExportFooterWorkflowInput): ExportFooterWorkflow {
  const { lastReceipt, progress, status } = exportState;
  const isExporting = status === Status.Exporting;
  const progressCurrent = progress.current || progress.completed || 0;
  const receiptOutputCount = lastReceipt?.outputs.length ?? 0;
  const hasMissingOutput = status === Status.Success && receiptOutputCount === 0;
  const hasPartialExport =
    status === Status.Success &&
    lastReceipt !== undefined &&
    receiptOutputCount > 0 &&
    receiptOutputCount < lastReceipt.total;
  const canShowReceipt =
    (status === Status.Success || status === Status.Cancelled) && receiptOutputCount > 0 && !hasMissingOutput;
  const canUseReceiptActions = canShowReceipt && !isExporting;
  const canImportLinkedVariant =
    canUseReceiptActions &&
    canOpenReceiptInEditor &&
    !isImportingCurrentExternalVariant &&
    currentExternalVariantImportedPath === null;

  const state = deriveWorkflowState({
    canExport,
    canShowReceipt,
    currentExternalVariantImportedPath,
    hasMissingOutput,
    hasPartialExport,
    isCancellingExport,
    isEstimating,
    isExporting,
    isImportingCurrentExternalVariant,
    progressCurrent,
    status,
  });

  return {
    canImportLinkedVariant,
    canShowReceipt,
    canUseReceiptActions,
    hasMissingOutput,
    hasPartialExport,
    progressCurrent,
    receiptOutputCount,
    state,
    tone: workflowTone(state),
  };
}

function deriveWorkflowState({
  canExport,
  canShowReceipt,
  currentExternalVariantImportedPath,
  hasMissingOutput,
  hasPartialExport,
  isCancellingExport,
  isEstimating,
  isExporting,
  isImportingCurrentExternalVariant,
  progressCurrent,
  status,
}: Omit<DeriveExportFooterWorkflowInput, 'canOpenReceiptInEditor' | 'exportState'> & {
  canShowReceipt: boolean;
  hasMissingOutput: boolean;
  hasPartialExport: boolean;
  isExporting: boolean;
  progressCurrent: number;
  status: Status;
}): ExportFooterWorkflowState {
  if (isImportingCurrentExternalVariant) return 'importing-linked-variant';
  if (currentExternalVariantImportedPath !== null) return 'imported-linked-variant';
  if (hasMissingOutput) return 'missing-output';
  if (hasPartialExport) return 'partial';
  if (status === Status.Error) return 'failed';
  if (status === Status.Cancelled) return 'canceled';
  if (isCancellingExport) return 'cancelling';
  if (isExporting) return progressCurrent === 0 ? 'queued' : 'running';
  if (canShowReceipt) return 'completed';
  if (isEstimating && canExport) return 'estimating';
  return 'idle';
}

function workflowTone(state: ExportFooterWorkflowState): ExportFooterStatusTone {
  if (state === 'failed' || state === 'missing-output') return 'danger';
  if (state === 'completed' || state === 'imported-linked-variant') return 'success';
  if (state === 'running' || state === 'importing-linked-variant') return 'info';
  if (state === 'idle') return 'neutral';
  return 'warning';
}
