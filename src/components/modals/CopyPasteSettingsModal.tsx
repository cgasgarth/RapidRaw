import cx from 'clsx';
import { motion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useModalTransition } from '../../hooks/useModalTransition';
import { TextVariants } from '../../types/typography';
import {
  ADJUSTMENT_GROUPS,
  COPYABLE_ADJUSTMENT_KEYS,
  type CopyPasteSettings,
  PasteMode,
} from '../../utils/adjustments';
import Button from '../ui/Button';
import Switch from '../ui/Switch';
import UiText from '../ui/Text';

interface CopyPasteSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (settings: CopyPasteSettings) => void;
  settings: CopyPasteSettings;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const labelFallback = (labelKey: string) => capitalize(labelKey.split('.').pop() ?? labelKey);

interface PasteModeSwitchProps {
  selectedMode: PasteMode;
  onModeChange: (mode: PasteMode) => void;
  isVisible: boolean;
}

const PasteModeSwitch = ({ selectedMode, onModeChange, isVisible }: PasteModeSwitchProps) => {
  const { t } = useTranslation();
  const [buttonRefs, setButtonRefs] = useState<Map<string, HTMLButtonElement>>(new Map());
  const [bubbleStyle, setBubbleStyle] = useState({});
  const containerRef = useRef<HTMLDivElement>(null);
  const isInitialAnimation = useRef(true);

  const pasteModeOptions = useMemo(
    () => [
      { id: PasteMode.Merge, label: t('modals.copyPaste.modeMerge') },
      { id: PasteMode.Replace, label: t('modals.copyPaste.modeReplace') },
    ],
    [t],
  );

  useEffect(() => {
    const selectedButton = buttonRefs.get(selectedMode);

    if (!isVisible || !selectedButton || !containerRef.current) {
      return;
    }

    const targetStyle = {
      x: selectedButton.offsetLeft,
      width: selectedButton.offsetWidth,
    };

    if (isInitialAnimation.current && containerRef.current.offsetWidth > 0) {
      let initialX;
      if (selectedMode === PasteMode.Replace) {
        initialX = containerRef.current.offsetWidth;
      } else {
        initialX = -targetStyle.width;
      }

      setBubbleStyle({
        x: [initialX, targetStyle.x],
        width: targetStyle.width,
      });
      isInitialAnimation.current = false;
    } else {
      setBubbleStyle(targetStyle);
    }
  }, [selectedMode, buttonRefs, isVisible]);

  useEffect(() => {
    if (!isVisible) {
      isInitialAnimation.current = true;
    }
  }, [isVisible]);

  return (
    <div ref={containerRef} className="relative flex w-full gap-1 bg-bg-primary p-1 rounded-md">
      <motion.div
        className="absolute top-1 bottom-1 z-0 bg-accent shadow-xs"
        style={{ borderRadius: 6 }}
        animate={bubbleStyle}
        transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
      />
      {pasteModeOptions.map((option) => (
        <button
          key={option.id}
          ref={(el) => {
            if (el) {
              const newRefs = new Map(buttonRefs);
              if (newRefs.get(option.id) !== el) {
                newRefs.set(option.id, el);
                setButtonRefs(newRefs);
              }
            }
          }}
          onClick={() => {
            onModeChange(option.id);
          }}
          className={cx(
            'relative flex-1 flex items-center justify-center gap-2 py-1.5 text-sm rounded-md transition-colors',
            {
              'text-text-primary hover:bg-surface': selectedMode !== option.id,
              'text-button-text': selectedMode === option.id,
            },
          )}
          style={{ WebkitTapHighlightColor: 'transparent' }}
        >
          <span className="relative z-10 flex items-center">{option.label}</span>
        </button>
      ))}
    </div>
  );
};

export default function CopyPasteSettingsModal({ isOpen, onClose, onSave, settings }: CopyPasteSettingsModalProps) {
  const { t } = useTranslation();
  const { isMounted, show } = useModalTransition(isOpen);
  const [localSettings, setLocalSettings] = useState<CopyPasteSettings>(settings);

  useEffect(() => {
    if (isOpen) {
      const timer = window.setTimeout(() => {
        setLocalSettings(settings);
      }, 0);
      return () => {
        window.clearTimeout(timer);
      };
    }
    return undefined;
  }, [isOpen, settings]);

  const handleSave = useCallback(() => {
    onSave(localSettings);
    onClose();
  }, [localSettings, onSave, onClose]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, handleKeyDown]);

  const handleSelectAll = () => {
    setLocalSettings((prev) => ({ ...prev, includedAdjustments: [...COPYABLE_ADJUSTMENT_KEYS] }));
  };

  const handleSelectNone = () => {
    setLocalSettings((prev) => ({ ...prev, includedAdjustments: [] }));
  };

  const handleGroupToggle = (keys: string[], checked: boolean) => {
    setLocalSettings((prev) => {
      const newSet = new Set(prev.includedAdjustments);
      keys.forEach((key) => {
        if (checked) newSet.add(key);
        else newSet.delete(key);
      });
      return { ...prev, includedAdjustments: Array.from(newSet) };
    });
  };

  if (!isMounted) return null;

  return (
    <div
      className={`fixed inset-0 flex items-center justify-center z-50 bg-black/30 backdrop-blur-xs transition-opacity duration-300 ease-in-out ${
        show ? 'opacity-100' : 'opacity-0'
      }`}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      role="presentation"
    >
      <div
        aria-modal="true"
        aria-labelledby="copy-paste-settings-title"
        className={`bg-surface rounded-lg shadow-xl w-[calc(100vw-2rem)] max-w-2xl max-h-[calc(100vh-2rem)] flex flex-col transform transition-all duration-300 ease-out ${
          show ? 'scale-100 opacity-100 translate-y-0' : 'scale-95 opacity-0 -translate-y-4'
        }`}
        role="dialog"
      >
        <UiText id="copy-paste-settings-title" variant={TextVariants.title} className="px-6 pt-6 pb-4 shrink-0">
          {t('modals.copyPaste.title')}
        </UiText>
        <div className="min-h-0 grow overflow-y-auto px-6 space-y-6">
          <div>
            <UiText variant={TextVariants.heading} className="block mb-2">
              {t('modals.copyPaste.pasteMode')}
            </UiText>
            <PasteModeSwitch
              selectedMode={localSettings.mode}
              onModeChange={(mode) => {
                setLocalSettings((p) => ({ ...p, mode }));
              }}
              isVisible={show}
            />
            <UiText variant={TextVariants.small} className="mt-2">
              <b>{t('modals.copyPaste.modeMerge')}:</b> {t('modals.copyPaste.descMerge')}
              <br />
              <b>{t('modals.copyPaste.modeReplace')}:</b> {t('modals.copyPaste.descReplace')}
            </UiText>
          </div>

          <div>
            <div className="flex justify-between items-center mb-2">
              <UiText variant={TextVariants.heading}>{t('modals.copyPaste.includedAdjustments')}</UiText>
              <div className="flex gap-2">
                <Button
                  className="px-4 py-2 rounded-md text-text-secondary hover:bg-surface transition-colors"
                  size="sm"
                  onClick={handleSelectAll}
                >
                  {t('modals.copyPaste.selectAll')}
                </Button>
                <Button
                  className="px-4 py-2 rounded-md text-text-secondary hover:bg-surface transition-colors"
                  size="sm"
                  onClick={handleSelectNone}
                >
                  {t('modals.copyPaste.selectNone')}
                </Button>
              </div>
            </div>
            <div className="bg-bg-primary p-4 rounded-md max-h-64 overflow-y-auto">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-6">
                {Object.entries(ADJUSTMENT_GROUPS).map(([section, groups]) => (
                  <div key={section}>
                    <UiText variant={TextVariants.heading} className="mb-2">
                      {t(`editor.adjustments.sections.${section}`, { defaultValue: capitalize(section) })}
                    </UiText>
                    {groups.map((group) => {
                      const isFullyChecked = group.keys.every((key) => localSettings.includedAdjustments.includes(key));

                      return (
                        <div key={group.label} className="mb-1.5 last:mb-0">
                          <Switch
                            label={t(group.label, { defaultValue: labelFallback(group.label) })}
                            checked={isFullyChecked}
                            onChange={(checked) => {
                              handleGroupToggle(group.keys, checked);
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-bg-primary shrink-0">
          <Button
            className="px-4 py-2 rounded-md text-text-secondary bg-surface hover:bg-surface transition-colors"
            onClick={onClose}
          >
            {t('modals.copyPaste.cancel')}
          </Button>
          <Button onClick={handleSave}>{t('modals.copyPaste.save')}</Button>
        </div>
      </div>
    </div>
  );
}
