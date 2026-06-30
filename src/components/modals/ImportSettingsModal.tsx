import { type ChangeEvent, type KeyboardEvent, useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useManagedFocus } from '../../hooks/ui/useManagedFocus';
import { useModalTransition } from '../../hooks/ui/useModalTransition';
import { TextVariants } from '../../types/typography';
import { FILENAME_VARIABLES } from '../ui/ExportImportProperties';
import Switch from '../ui/Switch';
import UiText from '../ui/Text';

interface ImportSettings {
  dateFolderFormat: string;
  deleteAfterImport: boolean;
  filenameTemplate: string;
  organizeByDate: boolean;
}

interface ImportSettingsModalProps {
  fileCount: number;
  isOpen: boolean;
  onClose: () => void;
  onSave: (settings: ImportSettings) => void;
}

export default function ImportSettingsModal({ fileCount, isOpen, onClose, onSave }: ImportSettingsModalProps) {
  const { t } = useTranslation();
  const { isMounted, show } = useModalTransition(isOpen);

  const [filenameTemplate, setFilenameTemplate] = useState('{original_filename}');
  const [organizeByDate, setOrganizeByDate] = useState(false);
  const [dateFolderFormat, setDateFolderFormat] = useState('YYYY/MM-DD');
  const [deleteAfterImport, setDeleteAfterImport] = useState(false);
  const filenameInputRef = useRef<HTMLInputElement>(null);

  useManagedFocus(filenameInputRef, show);

  const handleSave = useCallback(() => {
    let finalFilenameTemplate = filenameTemplate;
    if (
      fileCount > 1 &&
      !filenameTemplate.includes('{sequence}') &&
      !filenameTemplate.includes('{original_filename}')
    ) {
      finalFilenameTemplate = `${filenameTemplate}_{sequence}`;
    }

    onSave({
      filenameTemplate: finalFilenameTemplate,
      organizeByDate,
      dateFolderFormat,
      deleteAfterImport,
    });
    onClose();
  }, [onSave, onClose, filenameTemplate, organizeByDate, dateFolderFormat, deleteAfterImport, fileCount]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Enter') {
        handleSave();
      } else if (e.key === 'Escape') {
        onClose();
      }
    },
    [handleSave, onClose],
  );

  const handleVariableClick = (variable: string) => {
    if (!filenameInputRef.current) {
      return;
    }
    const input = filenameInputRef.current;
    const start = input.selectionStart || 0;
    const end = input.selectionEnd || 0;
    const currentValue = input.value;
    const newValue = currentValue.substring(0, start) + variable + currentValue.substring(end);
    setFilenameTemplate(newValue);
    setTimeout(() => {
      input.focus();
      const newCursorPos = start + variable.length;
      input.setSelectionRange(newCursorPos, newCursorPos);
    }, 0);
  };

  if (!isMounted) {
    return null;
  }

  return (
    <div
      className={`fixed inset-0 flex items-center justify-center z-50 bg-black/30 backdrop-blur-xs transition-opacity duration-300 ease-in-out ${
        show ? 'opacity-100' : 'opacity-0'
      }`}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      onKeyDown={handleKeyDown}
      role="presentation"
    >
      <div
        aria-modal="true"
        className={`bg-surface rounded-lg shadow-xl p-6 w-full max-w-lg transform transition-all duration-300 ease-out ${
          show ? 'scale-100 opacity-100 translate-y-0' : 'scale-95 opacity-0 -translate-y-4'
        }`}
        role="dialog"
      >
        <UiText variant={TextVariants.title} className="mb-4">
          {t('modals.importSettings.title')}
        </UiText>

        <div className="space-y-8 text-sm">
          <div>
            <UiText variant={TextVariants.heading} className="block mb-2">
              {t('modals.importSettings.fileNaming')}
            </UiText>
            <input
              className="w-full bg-bg-primary border border-surface rounded-md p-2 text-sm text-text-primary focus:ring-accent focus:border-accent"
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                setFilenameTemplate(e.target.value);
              }}
              ref={filenameInputRef}
              type="text"
              value={filenameTemplate}
            />
            <div className="flex flex-wrap gap-2 mt-2">
              {FILENAME_VARIABLES.map((variable: string) => (
                <button
                  className="px-2 py-1 bg-surface text-text-secondary text-xs rounded-md hover:bg-card-active transition-colors"
                  key={variable}
                  onClick={() => {
                    handleVariableClick(variable);
                  }}
                >
                  {variable}
                </button>
              ))}
            </div>
          </div>

          <div>
            <UiText variant={TextVariants.heading} className="block mb-2">
              {t('modals.importSettings.folderOrganization')}
            </UiText>
            <Switch
              label={t('modals.importSettings.organizeByDate')}
              checked={organizeByDate}
              onChange={setOrganizeByDate}
            />
            {organizeByDate && (
              <div className="mt-2">
                <UiText variant={TextVariants.label} className="block mb-1">
                  {t('modals.importSettings.dateFormat')}
                </UiText>
                <input
                  className="w-full bg-bg-primary border border-surface rounded-md p-2 text-sm text-text-primary focus:ring-accent focus:border-accent"
                  onChange={(e: ChangeEvent<HTMLInputElement>) => {
                    setDateFolderFormat(e.target.value);
                  }}
                  placeholder={t('modals.importSettings.dateFormatPlaceholder')}
                  type="text"
                  value={dateFolderFormat}
                />
              </div>
            )}
          </div>

          <div>
            <UiText variant={TextVariants.heading} className="block mb-2">
              {t('modals.importSettings.sourceFiles')}
            </UiText>
            <Switch
              checked={deleteAfterImport}
              label={t('modals.importSettings.deleteAfterImport')}
              onChange={setDeleteAfterImport}
            />
            {deleteAfterImport && (
              <UiText variant={TextVariants.small} className="mt-1">
                {t('modals.importSettings.deleteWarning')}
              </UiText>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-8">
          <button
            className="px-4 py-2 rounded-md text-text-secondary hover:bg-surface transition-colors"
            onClick={onClose}
          >
            {t('modals.importSettings.cancel')}
          </button>
          <button
            className="px-4 py-2 rounded-md bg-accent shadow-shiny text-button-text font-semibold hover:bg-accent-hover transition-colors"
            onClick={handleSave}
          >
            {t('modals.importSettings.startImport')}
          </button>
        </div>
      </div>
    </div>
  );
}
