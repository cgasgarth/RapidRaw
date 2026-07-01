import cx from 'clsx';
import { ChevronDown, Eye, EyeOff, type LucideIcon, MoreHorizontal } from 'lucide-react';
import { type KeyboardEvent, type MouseEvent, type MouseEventHandler, type ReactNode, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { TextVariants, TextWeights } from '../../types/typography';
import { inspectorSectionTokens } from './inspectorTokens';
import UiText from './primitives/Text';

export interface CollapsibleSectionHeaderAction {
  className?: string;
  disabled?: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  pressed?: boolean;
  testId?: string;
}

interface CollapsibleSectionProps {
  actionsMenuLabel?: string;
  actionsMenuTestId?: string;
  canToggleVisibility?: boolean;
  children: ReactNode;
  headerActions?: CollapsibleSectionHeaderAction[];
  isContentVisible: boolean;
  isDirty?: boolean;
  isOpen: boolean;
  onContextMenu?: MouseEventHandler<HTMLDivElement>;
  onOpenActionsMenu?: (x: number, y: number) => void;
  onToggle: () => void;
  onToggleVisibility?: () => void;
  title: string;
}

export default function CollapsibleSection({
  actionsMenuLabel,
  actionsMenuTestId,
  canToggleVisibility = true,
  children,
  headerActions = [],
  isContentVisible,
  isDirty = false,
  isOpen,
  onContextMenu,
  onOpenActionsMenu,
  onToggle,
  onToggleVisibility = () => {},
  title,
}: CollapsibleSectionProps) {
  const { t } = useTranslation();
  const contentRef = useRef<HTMLDivElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const content = contentRef.current;
    if (!wrapper || !content) {
      return;
    }

    const updateMaxHeight = () => {
      if (isOpen) {
        const contentHeight = content.scrollHeight;
        wrapper.style.maxHeight = `${String(contentHeight)}px`;
      } else {
        wrapper.style.maxHeight = '0px';
      }
    };

    updateMaxHeight();

    const resizeObserver = new ResizeObserver(updateMaxHeight);
    resizeObserver.observe(content);

    return () => {
      resizeObserver.disconnect();
    };
  }, [isOpen]);

  const handleVisibilityClick = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    onToggleVisibility();
  };

  const handleActionClick = (event: MouseEvent<HTMLButtonElement>, action: CollapsibleSectionHeaderAction) => {
    event.stopPropagation();
    if (action.disabled) {
      return;
    }
    action.onClick();
  };

  const handleMenuClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    onOpenActionsMenu?.(rect.left, rect.bottom + 4);
  };

  const handleActionKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    event.stopPropagation();
  };

  const handleHeaderKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.shiftKey && event.key === 'F10' && onOpenActionsMenu) {
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      onOpenActionsMenu(rect.left, rect.bottom + 4);
      return;
    }

    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }
    event.preventDefault();
    onToggle();
  };

  return (
    <div className={inspectorSectionTokens.shell} onContextMenu={onContextMenu}>
      <div
        className={cx(inspectorSectionTokens.header, !isContentVisible && 'bg-bg-primary')}
        aria-expanded={isOpen}
        onClick={onToggle}
        onKeyDown={handleHeaderKeyDown}
        role="button"
        tabIndex={0}
      >
        <div className={inspectorSectionTokens.titleRow}>
          <ChevronDown className={cx(inspectorSectionTokens.chevron, { 'rotate-180': isOpen })} size={14} />
          <UiText
            variant={TextVariants.label}
            weight={TextWeights.medium}
            className={cx(inspectorSectionTokens.title, !isContentVisible && 'text-text-secondary')}
          >
            {title}
          </UiText>
          {!isContentVisible && (
            <span className={cx(inspectorSectionTokens.badge, inspectorSectionTokens.hiddenBadge)}>
              {t('ui.collapsibleSection.disabledBadge', { defaultValue: 'Off' })}
            </span>
          )}
          {isDirty && (
            <span className={cx(inspectorSectionTokens.badge, inspectorSectionTokens.dirtyBadge)}>
              {t('ui.collapsibleSection.dirtyBadge', { defaultValue: 'Edited' })}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {headerActions.length > 0 && (
            <div className={inspectorSectionTokens.headerActions}>
              {headerActions.map((action) => {
                const Icon = action.icon;
                return (
                  <button
                    aria-label={action.label}
                    aria-pressed={action.pressed}
                    className={cx(
                      inspectorSectionTokens.headerActionButton,
                      action.disabled && 'cursor-not-allowed opacity-50',
                      action.className,
                    )}
                    data-tooltip={action.label}
                    data-testid={action.testId}
                    disabled={action.disabled ?? false}
                    key={action.label}
                    onClick={(event) => {
                      handleActionClick(event, action);
                    }}
                    onKeyDown={handleActionKeyDown}
                    type="button"
                  >
                    <Icon size={14} />
                  </button>
                );
              })}
            </div>
          )}
          {canToggleVisibility && (
            <div className={inspectorSectionTokens.visibilitySlot}>
              <button
                aria-label={
                  isContentVisible
                    ? t('ui.collapsibleSection.disableSection')
                    : t('ui.collapsibleSection.enableSection')
                }
                aria-pressed={!isContentVisible}
                className={cx(inspectorSectionTokens.visibilityButton, !isContentVisible && 'text-accent')}
                onKeyDown={handleActionKeyDown}
                onClick={handleVisibilityClick}
                data-tooltip={
                  isContentVisible
                    ? t('ui.collapsibleSection.disableSection')
                    : t('ui.collapsibleSection.enableSection')
                }
              >
                {isContentVisible ? <Eye size={16} /> : <EyeOff size={16} />}
              </button>
            </div>
          )}
          {onOpenActionsMenu && (
            <div className={inspectorSectionTokens.actionsMenuSlot}>
              <button
                aria-label={actionsMenuLabel ?? title}
                className={inspectorSectionTokens.headerActionButton}
                data-tooltip={actionsMenuLabel ?? title}
                data-testid={actionsMenuTestId}
                onClick={handleMenuClick}
                onKeyDown={handleActionKeyDown}
                type="button"
              >
                <MoreHorizontal size={14} />
              </button>
            </div>
          )}
        </div>
      </div>
      <div ref={wrapperRef} className="overflow-hidden transition-all duration-200 ease-in-out">
        <div
          className={cx(inspectorSectionTokens.body, !isContentVisible && 'opacity-30 pointer-events-none')}
          ref={contentRef}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
