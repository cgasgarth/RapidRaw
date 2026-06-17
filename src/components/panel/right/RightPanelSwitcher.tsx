import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';

import { RIGHT_PANEL_GROUPS } from './rightPanelRegistry';
import { Panel } from '../../ui/AppProperties';

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
    <div className={isHorizontal ? 'flex items-center overflow-x-auto p-1 gap-1' : 'flex flex-col p-1 gap-1 h-full'}>
      {RIGHT_PANEL_GROUPS.map((group, groupIndex) => (
        <div key={groupIndex} className={isHorizontal ? 'flex items-center gap-1' : 'flex flex-col gap-1'}>
          {groupIndex > 0 && (
            <div
              className={isHorizontal ? 'w-px h-6 bg-surface self-stretch my-auto' : 'w-6 h-px bg-surface self-center'}
            />
          )}
          {group.map(({ fallbackLabel, icon: Icon, id, tooltipKey }) => (
            <button
              className={`relative rounded-md transition-colors duration-200 ${isHorizontal ? 'p-2 shrink-0' : 'p-2'} ${
                activePanel === id
                  ? 'text-text-primary'
                  : 'text-text-secondary hover:bg-surface hover:text-text-primary'
              }`}
              key={id}
              onClick={() => {
                onPanelSelect(id);
              }}
              data-tooltip={t(tooltipKey, { defaultValue: fallbackLabel })}
            >
              {activePanel === id && (
                <motion.div
                  layoutId="active-panel-indicator"
                  className="absolute inset-0 bg-surface rounded-md"
                  transition={isInstantTransition ? { duration: 0 } : { type: 'spring', bounce: 0.2, duration: 0.4 }}
                />
              )}
              <Icon size={20} className="relative z-10" />
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
