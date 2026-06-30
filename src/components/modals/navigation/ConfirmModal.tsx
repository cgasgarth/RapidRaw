import { type KeyboardEvent, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useManagedFocus } from '../../../hooks/ui/useManagedFocus';
import { useModalTransition } from '../../../hooks/ui/useModalTransition';
import { TextVariants } from '../../../types/typography';
import Button from '../../ui/Button';
import UiText from '../../ui/Text';

interface ConfirmModalProps {
  cancelText?: string;
  confirmText?: string;
  confirmVariant?: string;
  isOpen: boolean;
  message?: string;
  onClose: () => void;
  onConfirm?: () => void;
  title?: string;
}

export default function ConfirmModal({
  cancelText,
  confirmText,
  confirmVariant = 'primary',
  isOpen,
  message,
  onClose,
  onConfirm,
  title,
}: ConfirmModalProps) {
  const { t } = useTranslation();
  const { isMounted, show } = useModalTransition(isOpen);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  useManagedFocus(confirmButtonRef, show);

  const resolvedCancelText = cancelText || t('modals.confirm.cancel');
  const resolvedConfirmText = confirmText || t('modals.confirm.confirm');

  const handleConfirm = useCallback(() => {
    if (onConfirm) {
      onConfirm();
    }
    onClose();
  }, [onConfirm, onClose]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        e.nativeEvent.stopImmediatePropagation();
        handleConfirm();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        e.nativeEvent.stopImmediatePropagation();
        onClose();
      }
    },
    [handleConfirm, onClose],
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
      onKeyDown={handleKeyDown}
      role="presentation"
    >
      <div
        aria-labelledby="confirm-modal-title"
        aria-modal="true"
        className={`
          bg-surface rounded-lg shadow-xl p-6 w-full max-w-md
          transform transition-all duration-300 ease-out
          ${show ? 'scale-100 opacity-100 translate-y-0' : 'scale-95 opacity-0 -translate-y-4'}
        `}
        role="dialog"
      >
        <UiText variant={TextVariants.title} id="confirm-modal-title" className="mb-4">
          {title}
        </UiText>
        <UiText className="mb-6 whitespace-pre-wrap">{message}</UiText>
        <div className="flex justify-end gap-3 mt-5">
          <Button
            className="bg-bg-primary shadow-transparent hover:bg-bg-primary text-white shadow-none focus:outline-hidden focus:ring-0"
            onClick={onClose}
            variant="ghost"
            tabIndex={0}
          >
            {resolvedCancelText}
          </Button>
          <Button
            onClick={handleConfirm}
            variant={confirmVariant}
            ref={confirmButtonRef}
            className="focus:outline-hidden focus:ring-0 focus:ring-offset-0"
          >
            {resolvedConfirmText}
          </Button>
        </div>
      </div>
    </div>
  );
}
