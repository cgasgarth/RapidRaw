import cx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import type { ReactNode } from 'react';

import { useModalTransition } from '../../../hooks/ui/useModalTransition';

interface NegativeLabWorkspaceShellProps {
  children: ReactNode;
  footer: ReactNode;
  isOpen: boolean;
  onClose: () => void;
  titleId: string;
}

export function NegativeLabWorkspaceShell({
  children,
  footer,
  isOpen,
  onClose,
  titleId,
}: NegativeLabWorkspaceShellProps) {
  const { isMounted, show } = useModalTransition(isOpen);

  const handleBackdropMouseDown = () => {
    onClose();
  };

  if (!isMounted) return null;

  return (
    <div
      className={cx(
        'fixed inset-0 z-100 flex items-center justify-center bg-black/50 backdrop-blur-xs transition-opacity duration-300',
        show ? 'opacity-100' : 'opacity-0',
      )}
      role="presentation"
      onMouseDown={handleBackdropMouseDown}
    >
      <AnimatePresence>
        {show && (
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="bg-surface rounded-lg shadow-xl w-full max-w-6xl h-[90vh] flex flex-col overflow-hidden"
            data-testid="negative-lab-workspace"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onMouseDown={(event) => {
              event.stopPropagation();
            }}
          >
            <div className="grow min-h-0 overflow-hidden">{children}</div>

            <div className="shrink-0 p-4 flex items-center justify-end gap-3 border-t border-surface bg-bg-secondary z-20">
              {footer}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
