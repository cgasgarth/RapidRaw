import type { DerivedOutputReceipt } from '../../../schemas/derivedOutputReceiptSchemas';
import { TextColors, TextVariants } from '../../../types/typography';
import UiText from '../../ui/primitives/Text';
import DerivedOutputReceiptPanel from './DerivedOutputReceiptPanel';

interface ComputationalMergeReviewItem {
  label: string;
  status: 'pending' | 'ready' | 'review';
  value: string;
}

interface ComputationalMergeReviewSection {
  rows: Array<{
    label: string;
    value: string;
  }>;
  title: string;
}

interface ComputationalMergeReviewPanelProps {
  derivedOutputReceipt?: DerivedOutputReceipt;
  items: ComputationalMergeReviewItem[];
  limitation: string;
  onOpenDerivedOutput?: (path: string) => void;
  onExportDerivedOutput?: (path: string) => void;
  proofStatus: string;
  sections?: ComputationalMergeReviewSection[];
  testId?: string;
  title: string;
}

const statusClassName = {
  pending: 'text-text-secondary',
  ready: 'text-accent',
  review: 'text-yellow-400',
} as const;

export default function ComputationalMergeReviewPanel({
  derivedOutputReceipt,
  items,
  limitation,
  onExportDerivedOutput,
  onOpenDerivedOutput,
  proofStatus,
  sections = [],
  testId,
  title,
}: ComputationalMergeReviewPanelProps) {
  const validationStatus = items.some((item) => item.status === 'pending')
    ? 'needs_review'
    : items.some((item) => item.status === 'review')
      ? 'pending'
      : 'passed';
  const warnings = items.filter((item) => item.status === 'pending').map((item) => `${item.label}: ${item.value}`);

  return (
    <div className="grid gap-3" data-testid={testId}>
      <section className="rounded-md border border-border-color bg-bg-primary p-4">
        <div className="mb-3 flex items-start justify-between gap-4">
          <UiText variant={TextVariants.heading}>{title}</UiText>
          <UiText variant={TextVariants.small} color={TextColors.secondary} className="shrink-0">
            {proofStatus}
          </UiText>
        </div>
        <div className="grid gap-2">
          {items.map((item) => {
            return (
              <div key={item.label} className="grid grid-cols-[minmax(120px,0.9fr)_minmax(160px,1.1fr)] gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={`h-2 w-2 shrink-0 rounded-full bg-current ${statusClassName[item.status]}`}
                  />
                  <UiText as="span" variant={TextVariants.small} color={TextColors.secondary} className="truncate">
                    {item.label}
                  </UiText>
                </div>
                <UiText as="span" variant={TextVariants.small} className="min-w-0 truncate">
                  {item.value}
                </UiText>
              </div>
            );
          })}
        </div>
        {sections.map((section) => (
          <div key={section.title} className="mt-4 border-t border-border-color pt-3">
            <UiText variant={TextVariants.small} color={TextColors.secondary} className="mb-2 block">
              {section.title}
            </UiText>
            <div className="grid gap-2">
              {section.rows.map((row) => (
                <div key={row.label} className="grid grid-cols-[minmax(120px,0.9fr)_minmax(160px,1.1fr)] gap-3">
                  <UiText as="span" variant={TextVariants.small} color={TextColors.secondary} className="truncate">
                    {row.label}
                  </UiText>
                  <UiText as="span" variant={TextVariants.small} className="min-w-0 truncate">
                    {row.value}
                  </UiText>
                </div>
              ))}
            </div>
          </div>
        ))}
        <UiText variant={TextVariants.small} color={TextColors.secondary} className="mt-3 block leading-relaxed">
          {limitation}
        </UiText>
      </section>
      {derivedOutputReceipt ? (
        <DerivedOutputReceiptPanel
          receipt={derivedOutputReceipt}
          onOpenOutput={onOpenDerivedOutput}
          onExportOutput={onExportDerivedOutput}
          sourceLineageSummary={`${derivedOutputReceipt.sourceCount} sources / ${derivedOutputReceipt.sourceGraphRevisions
            .slice(0, 3)
            .join(', ')}`}
          validationStatus={validationStatus}
          validationStatusLabel={proofStatus}
          warnings={warnings}
        />
      ) : null}
    </div>
  );
}
