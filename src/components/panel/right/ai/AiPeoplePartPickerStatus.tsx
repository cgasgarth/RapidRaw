import cx from 'clsx';
import { useTranslation } from 'react-i18next';
import type { AiPeopleMaskAnalysis, AiPeopleMaskPart } from '../../../../schemas/masks/aiMaskingSchemas';
import { TextColors, TextVariants } from '../../../../types/typography';
import { buildAiPeopleMaskPickerModel } from '../../../../utils/ai/aiPeopleMaskPickerModel';
import UiText from '../../../ui/primitives/Text';

interface AiPeoplePartPickerStatusProps {
  analysis?: AiPeopleMaskAnalysis | null;
  error?: string | null;
  onPartSelect?: (part: AiPeopleMaskPart) => void;
  onPersonSelect?: (personId: string) => void;
  selectedPersonId?: string | null;
  status?: 'empty' | 'pending' | 'review' | 'accepted' | 'cancelled' | 'error';
}

export function AiPeoplePartPickerStatus({
  analysis = null,
  error = null,
  onPartSelect,
  onPersonSelect,
  selectedPersonId = null,
  status = analysis === null || analysis.people.length === 0 ? 'empty' : 'review',
}: AiPeoplePartPickerStatusProps) {
  const { t } = useTranslation();
  const pickerModel = buildAiPeopleMaskPickerModel();

  return (
    <div
      className="rounded-md border border-surface bg-bg-primary p-2"
      data-ai-people-status={status}
      data-testid="ai-people-part-picker"
    >
      <UiText variant={TextVariants.label}>{t('editor.masks.aiPeopleParts.title')}</UiText>
      <UiText variant={TextVariants.small} color={TextColors.secondary} className="mt-1 block">
        {t('editor.masks.aiPeopleParts.description')}
      </UiText>
      <div className="mt-2 space-y-1" data-testid="ai-people-candidates">
        {status === 'pending' && (
          <UiText variant={TextVariants.small}>
            {t('editor.masks.aiPeopleParts.pending', { defaultValue: 'Finding people…' })}
          </UiText>
        )}
        {status === 'error' && (
          <UiText variant={TextVariants.small} color={TextColors.error}>
            {error ?? t('editor.masks.aiPeopleParts.error', { defaultValue: 'People detection failed' })}
          </UiText>
        )}
        {analysis?.people.map((person, index) => (
          <button
            className={cx(
              'flex w-full items-center justify-between rounded px-2 py-1 text-left text-[11px]',
              selectedPersonId === person.personId
                ? 'bg-editor-primary-active text-editor-primary-active-text'
                : 'bg-bg-secondary text-text-secondary',
            )}
            data-confidence={person.confidence}
            data-person-id={person.personId}
            data-testid={`ai-people-candidate-${person.personId}`}
            key={person.personId}
            onClick={() => onPersonSelect?.(person.personId)}
            type="button"
          >
            <span>
              {t('editor.masks.aiPeopleParts.candidate', { defaultValue: 'Person {{index}}', index: index + 1 })}
            </span>
            <span>{Math.round(person.confidence * 100)}%</span>
          </button>
        ))}
        {status === 'empty' && (
          <UiText variant={TextVariants.small} color={TextColors.secondary}>
            {t('editor.masks.aiPeopleParts.empty', { defaultValue: 'No people detected' })}
          </UiText>
        )}
      </div>
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
                  onClick={() => onPartSelect?.(option.part)}
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
