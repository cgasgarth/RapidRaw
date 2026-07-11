import { type ChangeEvent, type KeyboardEvent, useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useManagedFocus } from '../../../hooks/ui/useManagedFocus';
import { useModalTransition } from '../../../hooks/ui/useModalTransition';
import { TextVariants } from '../../../types/typography';
import { buildCreateFolderDraft, buildOperationFormIdentity } from '../../../utils/operationFormDrafts';
import UiText from '../../ui/primitives/Text';

interface FolderModalProps {
  buttonText?: string;
  isOpen: boolean;
  onClose: () => void;
  onSave: (name: string) => void;
  operationScope?: string;
  placeholder?: string;
  title?: string;
}

interface CreateFolderDraftProps extends Omit<FolderModalProps, 'isOpen' | 'operationScope'> {
  show: boolean;
}

function CreateFolderDraft({ buttonText, onClose, onSave, placeholder, show, title }: CreateFolderDraftProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(buildCreateFolderDraft);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const submittedRef = useRef(false);

  useManagedFocus(nameInputRef, show);

  const handleSave = useCallback(() => {
    if (submittedRef.current) return;
    const normalizedName = name.trim();
    if (normalizedName) {
      submittedRef.current = true;
      onSave(normalizedName);
    }
    onClose();
  }, [name, onClose, onSave]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        handleSave();
      } else if (event.key === 'Escape') {
        onClose();
      }
    },
    [handleSave, onClose],
  );

  return (
    <div
      aria-modal="true"
      className={`
        bg-surface rounded-lg shadow-xl p-6 w-full max-w-sm
        transform transition-all duration-300 ease-out
        ${show ? 'scale-100 opacity-100 translate-y-0' : 'scale-95 opacity-0 -translate-y-4'}
      `}
      role="dialog"
    >
      <UiText variant={TextVariants.title} className="mb-4">
        {title || t('modals.createFolder.title')}
      </UiText>
      <input
        className="w-full bg-bg-primary text-text-primary border border-border rounded-md px-3 py-2 focus:outline-hidden focus:ring-2 focus:ring-accent"
        data-testid="create-folder-name"
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          setName(event.target.value);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder || t('modals.createFolder.placeholder')}
        ref={nameInputRef}
        type="text"
        value={name}
      />
      <div className="flex justify-end gap-3 mt-5">
        <button
          className="px-4 py-2 rounded-md text-text-secondary hover:bg-surface transition-colors"
          onClick={onClose}
        >
          {t('modals.createFolder.cancel')}
        </button>
        <button
          className="px-4 py-2 rounded-md bg-accent text-button-text font-semibold hover:bg-accent-hover disabled:bg-gray-500 disabled:text-white disabled:cursor-not-allowed transition-colors"
          data-testid="create-folder-submit"
          disabled={!name.trim() || submittedRef.current}
          onClick={handleSave}
        >
          {buttonText || t('modals.createFolder.create')}
        </button>
      </div>
    </div>
  );
}

export default function CreateFolderModal({ isOpen, operationScope = '', ...draftProps }: FolderModalProps) {
  const { isMounted, show } = useModalTransition(isOpen);
  const openEpochRef = useRef(0);
  const wasOpenRef = useRef(false);
  if (isOpen && !wasOpenRef.current) openEpochRef.current += 1;
  wasOpenRef.current = isOpen;
  const operationId = buildOperationFormIdentity(operationScope, openEpochRef.current);

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
      <CreateFolderDraft {...draftProps} key={operationId} show={show} />
    </div>
  );
}
