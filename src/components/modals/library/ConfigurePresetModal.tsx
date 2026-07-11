import { type KeyboardEvent, useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useManagedFocus } from '../../../hooks/ui/useManagedFocus';
import { useModalTransition } from '../../../hooks/ui/useModalTransition';
import { TextVariants } from '../../../types/typography';
import { ADJUSTMENT_GROUPS } from '../../../utils/adjustments';
import type { Preset } from '../../ui/AppProperties';
import InspectorSegmentedControl from '../../ui/primitives/InspectorSegmentedControl';
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

interface ConfigurePresetDraftProps extends Omit<ConfigurePresetModalProps, 'isOpen'> {
  show: boolean;
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
  const presetTypeOptions = useMemo(
    () => [
      {
        value: 'style' as const,
        label: t('modals.configurePreset.typeStyleLabel'),
        tooltip: t('modals.configurePreset.typeStyleDesc'),
      },
      {
        value: 'tool' as const,
        label: t('modals.configurePreset.typeToolLabel'),
        tooltip: t('modals.configurePreset.typeToolDesc'),
      },
    ],
    [t],
  );

  return (
    <InspectorSegmentedControl
      ariaLabel={t('modals.configurePreset.typeLabel')}
      className="mt-2 w-full"
      onChange={onChange}
      options={presetTypeOptions}
      value={selectedType}
    />
  );
};

export default function ConfigurePresetModal(props: ConfigurePresetModalProps) {
  const { isOpen, initialPreset } = props;
  const { isMounted, show } = useModalTransition(isOpen);
  const epochRef = useRef(isOpen ? 1 : 0);
  const wasOpenRef = useRef(isOpen);
  const sessionRef = useRef(
    isOpen ? { id: `${initialPreset?.id ?? 'new'}:${epochRef.current}`, initialPreset: initialPreset ?? null } : null,
  );
  if (isOpen) {
    const identity = initialPreset?.id ?? 'new';
    const currentIdentity = sessionRef.current?.initialPreset?.id ?? 'new';
    if (!wasOpenRef.current || identity !== currentIdentity) {
      epochRef.current += 1;
      sessionRef.current = { id: `${identity}:${epochRef.current}`, initialPreset: initialPreset ?? null };
    }
  }
  wasOpenRef.current = isOpen;
  const session = sessionRef.current;
  if (!isMounted || !session) return null;

  return (
    <ConfigurePresetDraft
      key={session.id}
      initialPreset={session.initialPreset}
      onClose={props.onClose}
      onSave={props.onSave}
      show={show}
    />
  );
}

export function ConfigurePresetDraft({ onClose, onSave, initialPreset, show }: ConfigurePresetDraftProps) {
  const { t } = useTranslation();
  const initialDraft = useMemo(() => getConfigurePresetState(initialPreset), [initialPreset]);
  const [name, setName] = useState(() => initialDraft.name);
  const [includeMasks, setIncludeMasks] = useState(() => initialDraft.includeMasks);
  const [includeCropTransform, setIncludeCropTransform] = useState(() => initialDraft.includeCropTransform);
  const [presetType, setPresetType] = useState<'tool' | 'style'>(() => initialDraft.presetType);
  const [didAttemptSave, setDidAttemptSave] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useManagedFocus(nameInputRef, show);

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
