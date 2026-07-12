import { XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { useProcessStore } from '../../../store/useProcessStore';
import { TextColors } from '../../../types/typography';
import {
  cancelImportWithSchema,
  resumeImportJobWithSchema,
  validateImportJobResumeWithSchema,
} from '../../../utils/fileOperationInvokes';
import { type ImportState, Status } from '../../ui/ExportImportProperties';
import Button from '../../ui/primitives/Button';
import UiText from '../../ui/primitives/Text';

export function ImportCancellationButton() {
  const { t } = useTranslation();
  return (
    <Button
      aria-label={t('modals.importSettings.cancel')}
      className="h-7 px-2"
      onClick={() => void cancelImportWithSchema()}
      size="sm"
    >
      <XCircle size={14} className="mr-1" /> {t('modals.importSettings.cancel')}
    </Button>
  );
}

export function ImportResumeButton({ importState }: { importState: ImportState }) {
  const { t } = useTranslation();
  const jobId = importState.jobId;
  if (!jobId) return null;
  return (
    <div className="flex items-center gap-2">
      <Button
        aria-label={t('modals.importSettings.resumeImport')}
        className="h-7 px-2"
        onClick={() => {
          void validateImportJobResumeWithSchema(jobId)
            .then((validation) => {
              useProcessStore.getState().setImportState({ resumeValidation: validation });
              if (validation.invalid.length > 0) {
                toast.error(
                  `Import resume blocked: ${String(validation.invalid.length)} source revision${validation.invalid.length === 1 ? '' : 's'} changed.`,
                );
                return;
              }
              return resumeImportJobWithSchema(jobId).then(() => {
                useProcessStore.getState().setImportState({
                  resumeError: '',
                  status: Status.Importing,
                });
                toast.success(
                  `Import resumed: ${String(validation.resumable.length)} remaining, ${String(validation.verifiedCompleted.length)} already complete.`,
                );
              });
            })
            .catch((error: unknown) => {
              const message = error instanceof Error ? error.message : String(error);
              useProcessStore.getState().setImportState({ resumeError: message });
              toast.error(`Import resume validation failed: ${message}`);
            });
        }}
        size="sm"
      >
        {t('modals.importSettings.resumeImport')}
      </Button>
      {importState.resumeValidation && (
        <UiText as="span" color={TextColors.secondary} className="text-xs" aria-live="polite">
          {importState.resumeValidation.invalid.length > 0
            ? `${String(importState.resumeValidation.invalid.length)} source revision change(s)`
            : `${String(importState.resumeValidation.resumable.length)} resumable`}
        </UiText>
      )}
    </div>
  );
}
