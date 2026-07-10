import cx from 'clsx';
import { motion } from 'framer-motion';
import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useManagedFocus } from '../../../hooks/ui/useManagedFocus';
import { useModalTransition } from '../../../hooks/ui/useModalTransition';
import { TextVariants } from '../../../types/typography';
import { ADJUSTMENT_GROUPS } from '../../../utils/adjustments';
import type { Preset } from '../../ui/AppProperties';
import Switch from '../../ui/primitives/Switch';
import UiText from '../../ui/primitives/Text';

interface ConfigurePresetModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (name: string, includeMasks: boolean, includeCropTransform: boolean, presetType: 'tool' | 'style') => void;
  initialPreset?: Preset | null;
}

interface PresetTypeSwitchProps {
  selectedType: 'tool' | 'style';
  onChange: (type: 'tool' | 'style') => void;
}

const getConfigurePresetState = (initialPreset: Preset | null | undefined) => {
  const geometryKeys = (ADJUSTMENT_GROUPS['geometry'] ?? []).flatMap((group) => group.keys);
  const hasGeometry =
    initialPreset?.adjustments && Object.keys(initialPreset.adjustments).some((key) => geometryKeys.includes(key));

  return {
    name: initialPreset?.name || '',
    includeMasks:
      initialPreset?.includeMasks ??
      (initialPreset?.adjustments['masks'] && initialPreset.adjustments['masks'].length > 0) ??
      false,
    includeCropTransform: initialPreset?.includeCropTransform ?? hasGeometry ?? false,
    presetType: initialPreset?.presetType || 'style',
  };
};

const PresetTypeSwitch = ({ selectedType, onChange }: PresetTypeSwitchProps) => {
  const { t } = useTranslation();
  const [bubbleStyle, setBubbleStyle] = useState({});
  const isInitialAnimation = useRef(true);

  const presetTypeOptions = useMemo(
    () => [
      {
        id: 'style' as const,
        label: t('modals.configurePreset.typeStyleLabel'),
        title: t('modals.configurePreset.typeStyleDesc'),
      },
      {
        id: 'tool' as const,
        label: t('modals.configurePreset.typeToolLabel'),
        title: t('modals.configurePreset.typeToolDesc'),
      },
    ],
    [t],
  );

  useEffect(() => {
    const selectedIndex = presetTypeOptions.findIndex((m) => m.id === selectedType);
    const safeIndex = selectedIndex >= 0 ? selectedIndex : 0;

    const widthPercent = 100 / presetTypeOptions.length;
    const targetX = `${safeIndex * 100}%`;
    const targetWidth = `${widthPercent}%`;

    if (isInitialAnimation.current) {
      const initialX = selectedType === 'style' ? '-25%' : '100%';

      setBubbleStyle({
        x: [initialX, targetX],
        width: targetWidth,
      });
      isInitialAnimation.current = false;
    } else {
      setBubbleStyle({
        x: targetX,
        width: targetWidth,
      });
    }
  }, [selectedType, presetTypeOptions]);

  return (
    <div
      aria-label={t('modals.configurePreset.typeLabel')}
      className="mt-2 w-full rounded-md bg-card-active p-1.5"
      role="radiogroup"
    >
      <div className="relative flex w-full">
        <motion.div
          className="absolute top-0 bottom-0 z-0 bg-accent"
          style={{ borderRadius: 4 }}
          animate={bubbleStyle}
          transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
        />
        {presetTypeOptions.map((option) => (
          <button
            key={option.id}
            aria-checked={selectedType === option.id}
            data-tooltip={option.title}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
              event.preventDefault();
              onChange(option.id === 'style' ? 'tool' : 'style');
            }}
            onClick={(e) => {
              e.preventDefault();
              onChange(option.id);
            }}
            className={cx(
              'relative flex-1 flex items-center justify-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
              {
                'text-text-primary hover:bg-surface': selectedType !== option.id,
                'text-button-text': selectedType === option.id,
              },
            )}
            role="radio"
            style={{ WebkitTapHighlightColor: 'transparent' }}
            type="button"
          >
            <span className="relative z-10 flex items-center">{option.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

export default function ConfigurePresetModal({ isOpen, onClose, onSave, initialPreset }: ConfigurePresetModalProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [includeMasks, setIncludeMasks] = useState(false);
  const [includeCropTransform, setIncludeCropTransform] = useState(false);
  const [presetType, setPresetType] = useState<'tool' | 'style'>('style');
  const [didAttemptSave, setDidAttemptSave] = useState(false);
  const { isMounted, show } = useModalTransition(isOpen);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useManagedFocus(nameInputRef, show);

  useEffect(() => {
    if (isOpen) {
      const timer = window.setTimeout(() => {
        const presetState = getConfigurePresetState(initialPreset);
        setName(presetState.name);
        setIncludeMasks(presetState.includeMasks);
        setIncludeCropTransform(presetState.includeCropTransform);
        setPresetType(presetState.presetType);
        setDidAttemptSave(false);
      }, 0);
      return () => {
        window.clearTimeout(timer);
      };
    }

    const timer = window.setTimeout(() => {
      setName('');
      setIncludeMasks(false);
      setIncludeCropTransform(false);
      setPresetType('style');
      setDidAttemptSave(false);
    }, 300);
    return () => {
      window.clearTimeout(timer);
    };
  }, [isOpen, initialPreset]);

  const handleSave = useCallback(() => {
    if (!name.trim()) {
      setDidAttemptSave(true);
      return;
    }
    onSave(name.trim(), includeMasks, includeCropTransform, presetType);
    onClose();
  }, [name, includeMasks, includeCropTransform, presetType, onSave, onClose]);

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
      role="presentation"
    >
      <div
        aria-modal="true"
        aria-describedby="configure-preset-scope"
        aria-labelledby="configure-preset-title"
        className={`
          bg-surface rounded-lg shadow-xl p-6 w-full max-w-sm
          transform transition-all duration-300 ease-out
          ${show ? 'scale-100 opacity-100 translate-y-0' : 'scale-95 opacity-0 -translate-y-4'}
        `}
        role="dialog"
      >
        <UiText as="h2" id="configure-preset-title" variant={TextVariants.title} className="mb-1">
          {initialPreset ? t('modals.configurePreset.titleConfigure') : t('modals.configurePreset.titleSave')}
        </UiText>
        <UiText as="p" id="configure-preset-scope" className="mb-4 text-text-secondary" variant={TextVariants.small}>
          {initialPreset ? t('modals.configurePreset.updateScope') : t('modals.configurePreset.saveScope')}
        </UiText>
        <label className="sr-only" htmlFor="configure-preset-name">
          {t('modals.configurePreset.nameLabel')}
        </label>
        <input
          aria-describedby={didAttemptSave && !name.trim() ? 'configure-preset-name-error' : undefined}
          aria-invalid={didAttemptSave && !name.trim()}
          aria-required="true"
          className="w-full bg-bg-primary text-text-primary border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
          id="configure-preset-name"
          onChange={(e) => {
            setName(e.target.value);
            if (didAttemptSave) setDidAttemptSave(false);
          }}
          onKeyDown={handleKeyDown}
          placeholder={t('modals.configurePreset.placeholder')}
          ref={nameInputRef}
          type="text"
          value={name}
        />
        {didAttemptSave && !name.trim() ? (
          <UiText
            as="p"
            className="mt-1 text-danger"
            id="configure-preset-name-error"
            role="alert"
            variant={TextVariants.small}
          >
            {t('modals.configurePreset.nameRequired')}
          </UiText>
        ) : null}

        <div className="mt-5 mb-4 p-1 space-y-4">
          <Switch label={t('modals.configurePreset.includeMasks')} checked={includeMasks} onChange={setIncludeMasks} />
          <Switch
            label={t('modals.configurePreset.includeCropTransform')}
            checked={includeCropTransform}
            onChange={setIncludeCropTransform}
          />
        </div>

        <PresetTypeSwitch selectedType={presetType} onChange={setPresetType} />

        <div className="flex justify-end gap-3 mt-6">
          <button
            className="px-4 py-2 rounded-md text-text-secondary hover:bg-surface transition-colors"
            onClick={onClose}
          >
            {t('modals.configurePreset.cancel')}
          </button>
          <button
            className="px-4 py-2 rounded-md bg-accent text-button-text font-semibold hover:bg-accent-hover disabled:bg-gray-500 disabled:text-white disabled:cursor-not-allowed transition-colors"
            disabled={!name.trim()}
            onClick={handleSave}
          >
            {t('modals.configurePreset.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
