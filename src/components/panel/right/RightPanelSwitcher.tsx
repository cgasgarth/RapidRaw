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
      className={
        isHorizontal ? 'flex items-center gap-0.5 overflow-x-auto p-0.5' : 'flex h-full flex-col gap-0.5 p-0.5'
      }
    >
      {RIGHT_PANEL_GROUPS.map((group, groupIndex) => (
        <div
          key={groupIndex}
          className={isHorizontal ? 'flex items-center gap-0.5' : 'flex flex-col gap-0.5'}
          data-testid={`right-panel-switcher-group-${groupIndex}`}
        >
          {groupIndex > 0 && (
            <div
              className={isHorizontal ? 'my-auto h-5 w-px self-stretch bg-surface' : 'h-px w-5 self-center bg-surface'}
            />
          )}
          {group.map(({ fallbackLabel, icon: Icon, id, tooltipKey }) => (
            <button
              aria-label={t(tooltipKey, { defaultValue: fallbackLabel })}
              aria-pressed={activePanel === id}
              className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition-colors duration-150 ${
                activePanel === id
                  ? 'text-text-primary'
                  : 'text-text-secondary hover:bg-surface hover:text-text-primary'
              }`}
              key={id}
              onClick={() => {
                onPanelSelect(id);
              }}
              type="button"
              data-panel-id={id}
              data-testid={`right-panel-switcher-button-${id}`}
              data-tooltip={t(tooltipKey, { defaultValue: fallbackLabel })}
            >
              {activePanel === id && (
                <motion.div
                  layoutId="active-panel-indicator"
                  className="absolute inset-0 bg-surface rounded-md"
                  transition={isInstantTransition ? { duration: 0 } : { type: 'spring', bounce: 0.2, duration: 0.4 }}
                />
              )}
              <Icon size={18} className="relative z-10" />
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
