import { type ChangeEvent, type KeyboardEvent, useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useManagedFocus } from '../../../hooks/ui/useManagedFocus';
import { useModalTransition } from '../../../hooks/ui/useModalTransition';
import { TextVariants } from '../../../types/typography';
import {
  buildOperationFormIdentity,
  buildPathSetIdentity,
  buildRenameFileDraft,
} from '../../../utils/operationFormDrafts';
import { FILENAME_VARIABLES } from '../../ui/ExportImportProperties';
import UiText from '../../ui/primitives/Text';

interface RenameFileModalProps {
  filesToRename: Array<string>;
  isOpen: boolean;
  onClose: () => void;
  onSave: (template: string) => void;
}

interface RenameFileDraftProps extends Omit<RenameFileModalProps, 'isOpen'> {
  show: boolean;
}

function RenameFileDraft({ filesToRename, onClose, onSave, show }: RenameFileDraftProps) {
  const { t } = useTranslation();
  const [nameTemplate, setNameTemplate] = useState(() => buildRenameFileDraft(filesToRename));
  const nameInputRef = useRef<HTMLInputElement>(null);
  const submittedRef = useRef(false);
  const fileCount = filesToRename.length;
  const isSingleFile = fileCount === 1;

  useManagedFocus(nameInputRef, show, { selectText: true });

  const handleSave = useCallback(() => {
    if (submittedRef.current) return;
    let finalTemplate = nameTemplate.trim();
    if (!finalTemplate) {
      onClose();
      return;
    }
    if (!isSingleFile && !finalTemplate.includes('{sequence}') && !finalTemplate.includes('{original_filename}')) {
      finalTemplate = `${finalTemplate}_{sequence}`;
    }
    submittedRef.current = true;
    onSave(finalTemplate);
    onClose();
  }, [isSingleFile, nameTemplate, onClose, onSave]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        handleSave();
      } else if (event.key === 'Escape') {
        onClose();
      }
    },
    [handleSave, onClose],
  );

  const handleVariableClick = (variable: string) => {
    const input = nameInputRef.current;
    if (input === null) return;
    const start = input.selectionStart ?? 0;
    const end = input.selectionEnd ?? 0;
    setNameTemplate(`${input.value.slice(0, start)}${variable}${input.value.slice(end)}`);
    requestAnimationFrame(() => {
      if (nameInputRef.current !== input) return;
      input.focus();
      const nextCursorPosition = start + variable.length;
      input.setSelectionRange(nextCursorPosition, nextCursorPosition);
    });
  };

  return (
    <div
      aria-modal="true"
      className={`bg-surface rounded-lg shadow-xl p-6 w-full max-w-lg transform transition-all duration-300 ease-out ${show ? 'scale-100 opacity-100 translate-y-0' : 'scale-95 opacity-0 -translate-y-4'}`}
      onKeyDown={handleKeyDown}
      role="dialog"
    >
      <UiText variant={TextVariants.title} className="mb-4">
        {isSingleFile ? t('modals.renameFile.titleSingle') : t('modals.renameFile.titleMultiple', { count: fileCount })}
      </UiText>

      <div className="space-y-8 text-sm">
        <div>
          <UiText variant={TextVariants.heading} className="block mb-2">
            {isSingleFile ? t('modals.renameFile.newName') : t('modals.renameFile.fileNamingTemplate')}
          </UiText>
          <input
            className="w-full bg-bg-primary border border-surface rounded-md p-2 text-sm text-text-primary focus:ring-accent focus:border-accent"
            data-testid="rename-file-template"
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              setNameTemplate(event.target.value);
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
          data-testid="rename-file-submit"
          disabled={!nameTemplate.trim() || submittedRef.current}
          onClick={handleSave}
        >
          {t('modals.renameFile.save')}
        </button>
      </div>
    </div>
  );
}

export default function RenameFileModal({ filesToRename, isOpen, ...draftProps }: RenameFileModalProps) {
  const { isMounted, show } = useModalTransition(isOpen);
  const openEpochRef = useRef(0);
  const wasOpenRef = useRef(false);
  if (isOpen && !wasOpenRef.current) openEpochRef.current += 1;
  wasOpenRef.current = isOpen;
  const operationId = buildOperationFormIdentity(buildPathSetIdentity(filesToRename), openEpochRef.current);

  if (!isMounted) return null;

  return (
    <div
      className={`fixed inset-0 flex items-center justify-center z-50 bg-black/30 backdrop-blur-xs transition-opacity duration-300 ease-in-out ${show ? 'opacity-100' : 'opacity-0'}`}
      data-operation-id={operationId}
      onClick={(event) => {
        if (event.target === event.currentTarget) draftProps.onClose();
      }}
      role="presentation"
    >
      <RenameFileDraft {...draftProps} filesToRename={filesToRename} key={operationId} show={show} />
    </div>
  );
}
