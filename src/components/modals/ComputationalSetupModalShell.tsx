import type { LucideIcon } from 'lucide-react';
import { XCircle } from 'lucide-react';
import { type MouseEvent, type ReactNode, useCallback, useRef } from 'react';
import { useModalTransition } from '../../hooks/useModalTransition';
import type { ComputationalMergeAppServerRouteFamily } from '../../schemas/computationalMergeAppServerSchemas';
import { TextColors, TextVariants } from '../../types/typography';
import ComputationalMergeAppServerBadge from '../ui/ComputationalMergeAppServerBadge';
import UiText from '../ui/Text';

interface ComputationalSetupModalShellProps {
  appServerFamily: ComputationalMergeAppServerRouteFamily;
  appServerStatusLabel: string;
  children: ReactNode;
  footer: ReactNode;
  Icon: LucideIcon;
  isOpen: boolean;
  loadingImageUrl?: string | null | undefined;
  onClose: () => void;
  sourcePreviewAlt: string;
  sourceSummary: string;
  title: string;
  titleId: string;
  workflowStatus: string;
  workflowTitle: string;
}

export function ComputationalSetupModalShell({
  appServerFamily,
  appServerStatusLabel,
  children,
  footer,
  Icon,
  isOpen,
  loadingImageUrl,
  onClose,
  sourcePreviewAlt,
  sourceSummary,
  title,
  titleId,
  workflowStatus,
  workflowTitle,
}: ComputationalSetupModalShellProps) {
  const { isMounted, show } = useModalTransition(isOpen);
  const mouseDownTarget = useRef<EventTarget | null>(null);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleBackdropMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    mouseDownTarget.current = event.target;
  };

  const handleBackdropClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && mouseDownTarget.current === event.currentTarget) {
      handleClose();
    }
    mouseDownTarget.current = null;
  };

  if (!isMounted) return null;

  return (
    <div
      className={`fixed inset-0 flex items-center justify-center z-50 bg-black/40 backdrop-blur-xs transition-opacity duration-300 ease-in-out ${
        show ? 'opacity-100' : 'opacity-0'
      }`}
      onMouseDown={handleBackdropMouseDown}
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        className={`bg-surface rounded-xl shadow-2xl p-0 w-full max-w-5xl h-[min(760px,calc(100vh-48px))] overflow-hidden transform transition-all duration-300 ease-out ${
          show ? 'scale-100 opacity-100 translate-y-0' : 'scale-95 opacity-0 -translate-y-4'
        }`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="flex h-full min-h-0">
          <div className="relative w-[46%] min-w-[320px] bg-[#0d0d0d] border-r border-surface overflow-hidden">
            {loadingImageUrl ? (
              <img src={loadingImageUrl} alt={sourcePreviewAlt} className="h-full w-full object-cover opacity-75" />
            ) : (
              <div className="h-full w-full bg-bg-primary" />
            )}
            <div className="absolute inset-0 bg-linear-to-t from-black/70 via-black/10 to-black/30" />
            <div className="absolute left-6 right-6 bottom-6">
              <UiText
                as="div"
                variant={TextVariants.title}
                className="flex items-center gap-2 mb-3 text-white"
                id={titleId}
              >
                <Icon className="w-6 h-6 text-accent" />
                <span>{title}</span>
              </UiText>
              <UiText className="text-white/80 leading-relaxed">{sourceSummary}</UiText>
            </div>
          </div>

          <div className="flex-1 min-w-0 flex flex-col">
            <div className="px-6 py-5 border-b border-surface/70">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <UiText variant={TextVariants.title}>{workflowTitle}</UiText>
                  <UiText variant={TextVariants.small} color={TextColors.secondary} className="mt-1">
                    {workflowStatus}
                  </UiText>
                </div>
                <ComputationalMergeAppServerBadge family={appServerFamily} statusLabel={appServerStatusLabel} />
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-5">{children}</div>
            <div className="px-6 py-4 border-t border-surface/70 flex items-center justify-end gap-3">{footer}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ComputationalSetupSourceWarning({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 flex gap-3">
      <XCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
      <UiText className="leading-relaxed">{children}</UiText>
    </div>
  );
}

export function ComputationalSetupOptionSection({
  children,
  className = '',
  title,
}: {
  children: ReactNode;
  className?: string;
  title: string;
}) {
  return (
    <section className={className}>
      <UiText variant={TextVariants.heading} className="mb-3">
        {title}
      </UiText>
      {children}
    </section>
  );
}

export function ComputationalSetupStatusLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <UiText as="div" variant={TextVariants.small} color={TextColors.secondary}>
        {label}
      </UiText>
      <UiText as="div" variant={TextVariants.label} className="truncate">
        {value}
      </UiText>
    </div>
  );
}
