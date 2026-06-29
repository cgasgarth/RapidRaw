import { Download, ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { TextColors, TextVariants } from '../../types/typography';
import Button from '../ui/Button';
import UiText from '../ui/Text';

import type { DerivedOutputReceipt } from '../../schemas/derivedOutputReceiptSchemas';

interface DerivedOutputReceiptPanelProps {
  exportActionLabel?: string | undefined;
  onOpenOutput?: ((path: string) => void) | undefined;
  onExportOutput?: ((path: string) => void) | undefined;
  receipt: DerivedOutputReceipt;
  sourceLineageSummary?: string | undefined;
  validationStatus?: 'blocked' | 'needs_review' | 'passed' | 'pending' | undefined;
  validationStatusLabel?: string | undefined;
  warnings?: string[] | undefined;
}

export default function DerivedOutputReceiptPanel({
  exportActionLabel,
  onExportOutput,
  onOpenOutput,
  receipt,
  sourceLineageSummary,
  validationStatus = 'pending',
  validationStatusLabel,
  warnings = [],
}: DerivedOutputReceiptPanelProps) {
  const { t } = useTranslation();
  const canOpen = receipt.openInEditorAction.state === 'available' && receipt.openInEditorAction.path !== undefined;
  const canExport = receipt.outputPath !== undefined && onExportOutput !== undefined;
  const isStale = receipt.staleState === 'stale';
  const warningSummary = warnings.join(' | ');
  const lineageSummary =
    sourceLineageSummary ??
    t('modals.derivedOutput.lineageSummary', {
      count: receipt.sourceCount,
      revisions: receipt.sourceGraphRevisions.slice(0, 3).join(', '),
    });
  const staleReasonText =
    receipt.staleReasons?.map((reason) => t(`modals.derivedOutput.staleReason.${reason}`)).join(', ') ?? '';

  const rows = [
    { label: t('modals.derivedOutput.family'), value: t(`modals.derivedOutput.familyValue.${receipt.family}`) },
    { label: t('modals.derivedOutput.status'), value: t(`modals.derivedOutput.statusValue.${receipt.staleState}`) },
    {
      label: t('modals.derivedOutput.validation'),
      value: validationStatusLabel ?? t(`modals.derivedOutput.validationValue.${validationStatus}`),
    },
    { label: t('modals.derivedOutput.lineage'), value: lineageSummary },
    { label: t('modals.derivedOutput.output'), value: receipt.outputArtifactId },
    { label: t('modals.derivedOutput.outputHash'), value: receipt.outputContentHash },
    { label: t('modals.derivedOutput.settingsHash'), value: receipt.settingsHash },
    {
      label: t('modals.derivedOutput.sources'),
      value: t('modals.derivedOutput.sourceCount', { count: receipt.sourceCount }),
    },
    {
      label: t('modals.derivedOutput.storage'),
      value: t(`modals.derivedOutput.storageValue.${receipt.storagePolicy}`),
    },
  ];

  return (
    <section
      className="rounded-md border border-border-color bg-bg-primary p-4"
      data-derived-output-family={receipt.family}
      data-derived-output-open-state={receipt.openInEditorAction.state}
      data-derived-output-review-tray="true"
      data-derived-output-review-family={receipt.family}
      data-derived-output-validation-status={validationStatus}
      data-derived-output-stale-reasons={receipt.staleReasons?.join(',') ?? ''}
      data-derived-output-warning-count={warnings.length}
      data-derived-output-warnings={warningSummary}
      data-output-artifact-id={receipt.outputArtifactId}
      data-output-content-hash={receipt.outputContentHash}
      data-output-path={receipt.outputPath ?? ''}
      data-recipe-hash={receipt.recipeHash ?? ''}
      data-receipt-id={receipt.receiptId}
      data-settings-hash={receipt.settingsHash}
      data-source-lineage-summary={lineageSummary}
      data-sidecar-accepted-apply-id={receipt.provenanceSidecar?.acceptedApplyId ?? ''}
      data-sidecar-accepted-dry-run-id={receipt.provenanceSidecar?.acceptedDryRunId ?? ''}
      data-sidecar-app-build-version={receipt.provenanceSidecar?.app.buildVersion ?? ''}
      data-sidecar-output-path={receipt.provenanceSidecar?.output.path ?? ''}
      data-sidecar-path={receipt.provenanceSidecar?.sidecarPath ?? ''}
      data-sidecar-source-order={receipt.provenanceSidecar?.sourceState.map((source) => source.order).join(',') ?? ''}
      data-sidecar-warning-codes={receipt.provenanceSidecar?.warnings.join(',') ?? ''}
      data-source-content-hashes={receipt.sourceContentHashes.join(',')}
      data-source-count={receipt.sourceCount}
      data-source-graph-revisions={receipt.sourceGraphRevisions.join(',')}
      data-stale-state={receipt.staleState}
      data-storage-policy={receipt.storagePolicy}
      data-testid="derived-output-receipt"
    >
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <UiText variant={TextVariants.heading}>{t('modals.derivedOutput.title')}</UiText>
          <UiText variant={TextVariants.small} color={TextColors.secondary} className="mt-1 block">
            {t('modals.derivedOutput.subtitle')}
          </UiText>
        </div>
        {isStale ? (
          <div
            className="rounded border border-yellow-400/40 bg-yellow-400/10 px-3 py-2 text-right"
            data-testid="derived-output-stale-warning"
          >
            <UiText variant={TextVariants.small} className="block font-semibold text-yellow-300">
              {t('modals.derivedOutput.staleWarningTitle')}
            </UiText>
            <UiText variant={TextVariants.small} color={TextColors.secondary} className="mt-1 block max-w-64">
              {t('modals.derivedOutput.staleWarning', { reasons: staleReasonText })}
            </UiText>
          </div>
        ) : null}
        <div className="flex shrink-0 flex-col gap-2">
          <Button
            className="bg-surface px-3 py-1.5 text-xs"
            data-testid="derived-output-open-in-editor"
            disabled={!canOpen}
            onClick={() => {
              if (receipt.openInEditorAction.path !== undefined) onOpenOutput?.(receipt.openInEditorAction.path);
            }}
            type="button"
          >
            <ExternalLink size={14} />
            {receipt.openInEditorAction.label}
          </Button>
          <Button
            className="bg-surface px-3 py-1.5 text-xs"
            data-testid="derived-output-export-action"
            disabled={!canExport}
            onClick={() => {
              if (receipt.outputPath !== undefined) onExportOutput?.(receipt.outputPath);
            }}
            type="button"
          >
            <Download size={14} />
            {exportActionLabel ?? t('modals.derivedOutput.exportAction')}
          </Button>
        </div>
      </div>
      {warnings.length > 0 ? (
        <div
          className="mb-3 rounded border border-yellow-400/35 bg-yellow-400/10 px-3 py-2"
          data-testid="derived-output-warning-list"
        >
          <UiText variant={TextVariants.small} className="block font-semibold text-yellow-300">
            {t('modals.derivedOutput.warnings')}
          </UiText>
          <UiText variant={TextVariants.small} color={TextColors.secondary} className="mt-1 block">
            {warningSummary}
          </UiText>
        </div>
      ) : null}
      <div className="grid gap-2">
        {rows.map((row) => (
          <div className="grid grid-cols-[minmax(120px,0.9fr)_minmax(160px,1.1fr)] gap-3" key={row.label}>
            <UiText as="span" variant={TextVariants.small} color={TextColors.secondary} className="truncate">
              {row.label}
            </UiText>
            <UiText as="span" variant={TextVariants.small} className="min-w-0 truncate font-mono">
              {row.value}
            </UiText>
          </div>
        ))}
      </div>
    </section>
  );
}
