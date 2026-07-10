import cx from 'clsx';
import type { ReactNode } from 'react';

import { TextVariants } from '../../types/typography';
import { professionalInspectorDensityTokens } from './inspectorTokens';
import UiText from './primitives/Text';

interface CompactInspectorSectionHeaderProps {
  actions?: ReactNode;
  className?: string;
  modified?: boolean;
  modifiedLabel?: string;
  summary?: ReactNode;
  testId?: string;
  title: ReactNode;
}

export default function CompactInspectorSectionHeader({
  actions,
  className,
  modified = false,
  modifiedLabel = 'Modified',
  summary,
  testId,
  title,
}: CompactInspectorSectionHeaderProps) {
  const density = professionalInspectorDensityTokens;

  return (
    <div
      className={cx(density.sectionHeader.compactRoot, className)}
      data-inspector-section-header="true"
      data-modified={String(modified)}
      data-testid={testId}
    >
      <div className={density.sectionHeader.compactTitleGroup}>
        <UiText variant={TextVariants.heading} className={cx('min-w-0 truncate', density.sectionHeader.title)}>
          {title}
        </UiText>
        {modified ? (
          <span
            aria-label={modifiedLabel}
            className={density.sectionHeader.modifiedIndicator}
            role="status"
            title={modifiedLabel}
          />
        ) : null}
      </div>
      {summary ? <div className={density.sectionHeader.compactSummary}>{summary}</div> : null}
      {actions ? <div className={density.sectionHeader.compactActions}>{actions}</div> : null}
    </div>
  );
}
