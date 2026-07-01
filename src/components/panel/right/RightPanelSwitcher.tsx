import cx from 'clsx';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import type { Panel } from '../../ui/AppProperties';
import { RIGHT_PANEL_GROUPS } from './rightPanelRegistry';

interface RightPanelSwitcherProps {
  activePanel: Panel | null;
  onPanelSelect: (id: Panel) => void;
  isInstantTransition: boolean;
  layout?: 'horizontal' | 'vertical';
}

export default function RightPanelSwitcher({
  activePanel,
  onPanelSelect,
  isInstantTransition,
  layout = 'vertical',
}: RightPanelSwitcherProps) {
  const { t } = useTranslation();
  const isHorizontal = layout === 'horizontal';

  return (
    <div
      data-testid={`right-panel-switcher-${layout}`}
      className={cx(
        'bg-editor-matte',
        isHorizontal
          ? 'flex min-h-11 items-center gap-1 overflow-x-auto px-1.5 py-1'
          : 'flex h-full flex-col items-center gap-1 px-1 py-1.5',
      )}
    >
      {RIGHT_PANEL_GROUPS.map((group, groupIndex) => (
        <div
          key={groupIndex}
          className={isHorizontal ? 'flex items-center gap-1' : 'flex flex-col gap-1'}
          data-testid={`right-panel-switcher-group-${groupIndex}`}
        >
          {groupIndex > 0 && (
            <div
              className={
                isHorizontal
                  ? 'my-auto h-6 w-px self-center bg-editor-border'
                  : 'my-1 h-px w-6 self-center bg-editor-border'
              }
            />
          )}
          {group.map(({ fallbackLabel, icon: Icon, id, priority, tooltipKey }) => {
            const isActive = activePanel === id;
            const isPrimary = priority === 'primary';

            return (
              <button
                aria-label={t(tooltipKey, { defaultValue: fallbackLabel })}
                aria-pressed={isActive}
                className={cx(
                  'relative flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-transparent transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editor-focus-ring focus-visible:ring-offset-1 focus-visible:ring-offset-editor-matte disabled:cursor-not-allowed disabled:opacity-45',
                  isActive
                    ? isPrimary
                      ? 'text-editor-primary-active-text'
                      : 'text-editor-selected-quiet-text'
                    : isPrimary
                      ? 'text-text-primary hover:border-editor-border hover:bg-editor-selected-quiet'
                      : 'text-text-secondary hover:bg-editor-panel-raised hover:text-text-primary',
                )}
                data-panel-id={id}
                data-panel-priority={priority}
                data-testid={`right-panel-switcher-button-${id}`}
                data-tooltip={t(tooltipKey, { defaultValue: fallbackLabel })}
                key={id}
                onClick={() => {
                  onPanelSelect(id);
                }}
                type="button"
              >
                {isActive && (
                  <motion.div
                    layoutId="active-panel-indicator"
                    className={cx(
                      'absolute inset-0 rounded-md',
                      isPrimary ? 'bg-editor-primary-active' : 'bg-editor-selected-quiet',
                    )}
                    transition={isInstantTransition ? { duration: 0 } : { type: 'spring', bounce: 0.2, duration: 0.32 }}
                  />
                )}
                {isPrimary && !isActive && (
                  <span className="absolute left-1 top-1 h-1 w-1 rounded-full bg-text-tertiary" />
                )}
                <Icon size={18} className="relative z-10" />
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
