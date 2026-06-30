import cx from 'clsx';
import { useTranslation } from 'react-i18next';

import { TextColors, TextVariants } from '../../../../types/typography';
import { buildAiPeopleMaskPickerModel } from '../../../../utils/aiPeopleMaskPickerModel';
import UiText from '../../../ui/Text';

export function AiPeoplePartPickerStatus() {
  const { t } = useTranslation();
  const pickerModel = buildAiPeopleMaskPickerModel();

  return (
    <div className="rounded-md border border-surface bg-bg-primary p-2" data-testid="ai-people-part-picker">
      <UiText variant={TextVariants.label}>{t('editor.masks.aiPeopleParts.title')}</UiText>
      <UiText variant={TextVariants.small} color={TextColors.secondary} className="mt-1 block">
        {t('editor.masks.aiPeopleParts.description')}
      </UiText>
      <div className="mt-2 space-y-2">
        {pickerModel.groups.map((group) => (
          <div data-group-id={group.id} data-testid="ai-people-part-group" key={group.id}>
            <UiText variant={TextVariants.small} color={TextColors.secondary} className="mb-1 block font-medium">
              {group.title}
            </UiText>
            <div className="grid grid-cols-2 gap-1">
              {group.options.map((option) => (
                <button
                  className={cx(
                    'min-w-0 rounded px-2 py-1 text-left text-[11px]',
                    option.disabledReason === null
                      ? 'bg-bg-secondary text-text-primary'
                      : 'cursor-not-allowed bg-bg-secondary/50 text-text-tertiary',
                  )}
                  data-disabled-reason={option.disabledReason ?? ''}
                  data-part={option.part}
                  data-recommended-default={String(option.recommendedDefault)}
                  data-status={option.status}
                  data-testid={`ai-people-part-option-${option.part}`}
                  data-validation-mode={option.validationMode}
                  disabled={option.disabledReason !== null}
                  key={option.part}
                  title={option.disabledReason ?? undefined}
                  type="button"
                >
                  <span className="block truncate">{option.label}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
