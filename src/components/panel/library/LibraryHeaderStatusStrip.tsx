import { TextColors, TextVariants, TextWeights } from '../../../types/typography';
import UiText from '../../ui/primitives/Text';

import type { LibraryHeaderStatusItem } from './libraryHeaderStatus';

export default function LibraryHeaderStatusStrip({ items }: { items: LibraryHeaderStatusItem[] }) {
  return (
    <div
      className="flex min-w-0 flex-wrap items-center gap-2 border-l border-surface pl-2"
      data-testid="library-header-workflow-status"
    >
      {items.map((item) => (
        <div
          className="flex items-center gap-1 rounded border border-surface bg-bg-secondary px-2 py-1"
          data-library-header-status={item.label}
          key={item.label}
        >
          <UiText as="span" variant={TextVariants.small} color={TextColors.secondary}>
            {item.label}
          </UiText>
          <UiText as="span" variant={TextVariants.small} color={TextColors.primary} weight={TextWeights.medium}>
            {item.value}
          </UiText>
        </div>
      ))}
    </div>
  );
}
