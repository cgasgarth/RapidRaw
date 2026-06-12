import { useCallback, useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import Text from '../ui/Text';
import { TextVariants } from '../../types/typography';
import { useManagedFocus } from '../../hooks/useManagedFocus';

interface RenameFolderModalProps {
  currentName: string;
  isOpen: boolean;
  onClose(): void;
  onSave(name: string): void;
  title?: string;
  placeholder?: string;
  buttonText?: string;
}

export default function RenameFolderModal({
  currentName,
  isOpen,
  onClose,
  onSave,
  title,
  placeholder,
  buttonText,
}: RenameFolderModalProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [isMounted, setIsMounted] = useState(false);
  const [show, setShow] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useManagedFocus(nameInputRef, show, { selectText: true });

  useEffect(() => {
    if (isOpen) {
      setName(currentName || '');
      setIsMounted(true);
      const timer = setTimeout(() => {
        setShow(true);
      }, 10);
      return () => {
        clearTimeout(timer);
      };
    } else {
      setShow(false);
      const timer = setTimeout(() => {
        setIsMounted(false);
        setName('');
      }, 300);
      return () => {
        clearTimeout(timer);
      };
    }
  }, [isOpen, currentName]);

  const handleSave = useCallback(() => {
    if (name.trim() && name.trim() !== currentName) {
      onSave(name.trim());
    } else {
      onClose();
    }
  }, [name, currentName, onSave, onClose]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        handleSave();
      } else if (e.key === 'Escape') {
        onClose();
      }
    },
    [handleSave, onClose],
  );

  if (!isMounted) {
    return null;
  }

  return (
    <div
      className={`
        fixed inset-0 flex items-center justify-center z-50
        bg-black/30 backdrop-blur-xs
        transition-opacity duration-300 ease-in-out
        ${show ? 'opacity-100' : 'opacity-0'}
      `}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        aria-modal="true"
        className={`
          bg-surface rounded-lg shadow-xl p-6 w-full max-w-sm
          transform transition-all duration-300 ease-out
          ${show ? 'scale-100 opacity-100 translate-y-0' : 'scale-95 opacity-0 -translate-y-4'}
        `}
        role="dialog"
      >
        <Text variant={TextVariants.title} className="mb-4">
          {title || t('modals.renameFolder.title')}
        </Text>
        <input
          className="w-full bg-bg-primary text-text-primary border border-border rounded-md px-3 py-2 focus:outline-hidden focus:ring-2 focus:ring-accent"
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            setName(e.target.value);
          }}
          onKeyDown={handleKeyDown}
          onFocus={(e) => {
            e.target.select();
          }}
          placeholder={placeholder || t('modals.renameFolder.placeholder')}
          ref={nameInputRef}
          type="text"
          value={name}
        />
        <div className="flex justify-end gap-3 mt-5">
          <button
            className="px-4 py-2 rounded-md text-text-secondary hover:bg-surface transition-colors"
            onClick={onClose}
          >
            {t('modals.renameFolder.cancel')}
          </button>
          <button
            className="px-4 py-2 rounded-md bg-accent text-button-text font-semibold hover:bg-accent-hover disabled:bg-gray-500 disabled:text-white disabled:cursor-not-allowed transition-colors"
            disabled={!name.trim() || name.trim() === currentName}
            onClick={handleSave}
          >
            {buttonText || t('modals.renameFolder.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
