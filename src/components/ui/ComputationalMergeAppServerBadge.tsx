import { CheckCircle2 } from 'lucide-react';
import type { ComputationalMergeAppServerRouteFamily } from '../../schemas/computationalMergeAppServerSchemas';
import { TextColors, TextVariants } from '../../types/typography';
import { getComputationalMergeAppServerRoutePairSummary } from '../../utils/computationalMergeAppServerRoutePairs';
import UiText from './Text';

interface ComputationalMergeAppServerBadgeProps {
  family: ComputationalMergeAppServerRouteFamily;
  statusLabel: string;
}

export default function ComputationalMergeAppServerBadge({
  family,
  statusLabel,
}: ComputationalMergeAppServerBadgeProps) {
  const routes = getComputationalMergeAppServerRoutePairSummary(family);

  return (
    <div
      aria-label={`${family} app-server routes mapped`}
      className="flex max-w-[300px] shrink-0 flex-col gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2"
    >
      <UiText as="div" variant={TextVariants.small} className="flex items-center gap-2 text-emerald-300">
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        <span>{statusLabel}</span>
      </UiText>
      <UiText as="div" variant={TextVariants.small} color={TextColors.secondary} className="font-mono leading-snug">
        {routes.dryRunToolName}
      </UiText>
      <UiText as="div" variant={TextVariants.small} color={TextColors.secondary} className="font-mono leading-snug">
        {routes.applyToolName}
      </UiText>
    </div>
  );
}
