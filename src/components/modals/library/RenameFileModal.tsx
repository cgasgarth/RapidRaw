import { type ChangeEvent, type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useManagedFocus } from '../../../hooks/ui/useManagedFocus';
import { useModalTransition } from '../../../hooks/ui/useModalTransition';
import { TextVariants } from '../../../types/typography';
import { FILENAME_VARIABLES } from '../../ui/ExportImportProperties';
import UiText from '../../ui/Text';

interface RenameFileModalProps {
  filesToRename: Array<string>;
  isOpen: boolean;
  onClose: () => void;
  onSave: (template: string) => void;
}

const getDefaultNameTemplate = (filesToRename: Array<string>, isSingleFile: boolean) => {
  if (isSingleFile && filesToRename[0]) {
    const fileName = filesToRename[0].split(/[\\/]/).pop();
    const nameWithoutExt = fileName?.substring(0, fileName.lastIndexOf('.'));
    if (nameWithoutExt) {
      return nameWithoutExt;
    }
  }

  return '{original_filename}';
};

export default function RenameFileModal({ filesToRename, isOpen, onClose, onSave }: RenameFileModalProps) {
  const { t } = useTranslation();
  const [nameTemplate, setNameTemplate] = useState('');
  const { isMounted, show } = useModalTransition(isOpen);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useManagedFocus(nameInputRef, show);

  const fileCount = filesToRename.length;
  const isSingleFile = fileCount === 1;

  useEffect(() => {
    if (isOpen) {
      const timer = window.setTimeout(() => {
        setNameTemplate(getDefaultNameTemplate(filesToRename, isSingleFile));
      }, 0);
      return () => {
        window.clearTimeout(timer);
      };
    }

    const timer = window.setTimeout(() => {
      setNameTemplate('');
    }, 300);
    return () => {
      window.clearTimeout(timer);
    };
  }, [isOpen, filesToRename, isSingleFile]);

  const handleSave = useCallback(() => {
    if (nameTemplate.trim()) {
      let finalTemplate = nameTemplate.trim();
      if (!isSingleFile && !finalTemplate.includes('{sequence}') && !finalTemplate.includes('{original_filename}')) {
        finalTemplate = `${finalTemplate}_{sequence}`;
      }
      onSave(finalTemplate);
    }
    onClose();
  }, [nameTemplate, onSave, onClose, isSingleFile]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSave();
      } else if (e.key === 'Escape') {
        onClose();
      }
    },
    [handleSave, onClose],
  );

  const handleVariableClick = (variable: string) => {
    if (!nameInputRef.current) {
      return;
    }
    const input = nameInputRef.current;
    const start = input.selectionStart || 0;
    const end = input.selectionEnd || 0;
    const currentValue = input.value;
    const newValue = currentValue.substring(0, start) + variable + currentValue.substring(end);
    setNameTemplate(newValue);
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
          {isSingleFile
            ? t('modals.renameFile.titleSingle')
            : t('modals.renameFile.titleMultiple', { count: fileCount })}
        </UiText>

        <div className="space-y-8 text-sm">
          <div>
            <UiText variant={TextVariants.heading} className="block mb-2">
              {isSingleFile ? t('modals.renameFile.newName') : t('modals.renameFile.fileNamingTemplate')}
            </UiText>
            <input
              className="w-full bg-bg-primary border border-surface rounded-md p-2 text-sm text-text-primary focus:ring-accent focus:border-accent"
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                setNameTemplate(e.target.value);
              }}
              ref={nameInputRef}
              type="text"
              value={nameTemplate}
            />
            {!isSingleFile && (
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
            )}
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-8">
          <button
            className="px-4 py-2 rounded-md text-text-secondary hover:bg-surface transition-colors"
            onClick={onClose}
          >
            {t('modals.renameFile.cancel')}
          </button>
          <button
            className="px-4 py-2 rounded-md bg-accent shadow-shiny text-button-text font-semibold hover:bg-accent-hover disabled:bg-gray-500 disabled:text-white disabled:cursor-not-allowed transition-colors"
            disabled={!nameTemplate.trim()}
            onClick={handleSave}
          >
            {t('modals.renameFile.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
