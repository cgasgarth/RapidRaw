import cx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import type { ReactNode } from 'react';

import { useModalTransition } from '../../../hooks/ui/useModalTransition';

interface NegativeLabWorkspaceShellProps {
  children: ReactNode;
  compareActive: boolean;
  footer: ReactNode;
  header: ReactNode;
  isOpen: boolean;
  onClose: () => void;
  operationId: string;
  runtimeChannelBasis: string;
  runtimeProcessFamily: string;
  titleId: string;
}

export function NegativeLabWorkspaceShell({
  children,
  compareActive,
  footer,
  header,
  isOpen,
  onClose,
  operationId,
  runtimeChannelBasis,
  runtimeProcessFamily,
  titleId,
}: NegativeLabWorkspaceShellProps) {
  const { isMounted, show } = useModalTransition(isOpen);

  const handleBackdropMouseDown = () => {
    onClose();
  };

  if (!isMounted) return null;

  return (
    <div
      data-compare-active={String(compareActive)}
      data-operation-id={operationId}
      data-runtime-channel-basis={runtimeChannelBasis}
      data-runtime-process-family={runtimeProcessFamily}
      data-testid="negative-lab-keyed-session"
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
            className="flex h-[min(92vh,61rem)] min-h-[34rem] w-[calc(100vw-1rem)] max-w-[100rem] flex-col overflow-hidden rounded-lg bg-surface shadow-2xl sm:w-[calc(100vw-2rem)]"
            data-testid="negative-lab-workspace"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onMouseDown={(event) => {
              event.stopPropagation();
            }}
          >
            <div
              className="shrink-0 border-b border-surface bg-bg-secondary px-3 py-2 sm:px-4"
              data-testid="negative-lab-workspace-header"
            >
              {header}
            </div>

            <div className="min-h-0 grow overflow-hidden">{children}</div>

            <div
              className="z-20 flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-surface bg-bg-secondary px-3 py-2 shadow-[0_-8px_20px_rgba(0,0,0,0.12)] sm:px-4"
              data-testid="negative-lab-workspace-footer"
            >
              {footer}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
