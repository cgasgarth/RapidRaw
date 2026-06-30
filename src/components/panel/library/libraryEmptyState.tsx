import { Image as ImageIcon, SlidersHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { SearchCriteria } from '../../../store/useLibraryStore';
import { TextColors, TextVariants } from '../../../types/typography';
import { EditedStatus, type FilterCriteria, RawStatus } from '../../ui/AppProperties';
import Button from '../../ui/primitives/Button';
import UiText from '../../ui/primitives/Text';

interface RawOnlyEmptyStateProps {
  onResetRawFilter: () => void;
}

interface RawOnlyEmptyStateInput {
  filterCriteria: FilterCriteria;
  searchCriteria: SearchCriteria;
  sourceImageCount: number;
  visibleImageCount: number;
}

export function shouldShowRawOnlyEmptyState({
  filterCriteria,
  searchCriteria,
  sourceImageCount,
  visibleImageCount,
}: RawOnlyEmptyStateInput): boolean {
  return (
    visibleImageCount === 0 &&
    sourceImageCount > 0 &&
    filterCriteria.rawStatus === RawStatus.RawOnly &&
    filterCriteria.rating === 0 &&
    (filterCriteria.editedStatus || EditedStatus.All) === EditedStatus.All &&
    filterCriteria.colors.length === 0 &&
    searchCriteria.tags.length === 0 &&
    searchCriteria.text.trim().length === 0
  );
}

export function LibraryRawOnlyEmptyState({ onResetRawFilter }: RawOnlyEmptyStateProps) {
  const { t } = useTranslation();

  return (
    <section
      className="flex flex-col items-center justify-center px-6 text-center"
      data-testid="library-raw-only-empty-state"
    >
      <div className="flex h-14 w-14 items-center justify-center rounded-full border border-border-color bg-surface text-accent">
        <ImageIcon size={28} aria-hidden="true" />
      </div>
      <UiText variant={TextVariants.heading} color={TextColors.secondary} className="mt-4">
        {t('library.empty.rawOnlyTitle', {
          defaultValue: 'No RAW files here',
        })}
      </UiText>
      <UiText color={TextColors.secondary} className="mt-2 max-w-md">
        {t('library.empty.rawOnlyDescription', {
          defaultValue: 'RAW-only is hiding the JPEGs and other files in this folder.',
        })}
      </UiText>
      <Button
        className="mt-5 bg-surface text-text-primary shadow-none border border-border-color/60"
        data-testid="library-raw-only-empty-state-reset"
        onClick={onResetRawFilter}
        type="button"
      >
        <SlidersHorizontal size={16} />
        {t('library.empty.rawOnlyReset', {
          defaultValue: 'Show all files',
        })}
      </Button>
    </section>
  );
}
