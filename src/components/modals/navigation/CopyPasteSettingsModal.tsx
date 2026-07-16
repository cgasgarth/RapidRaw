import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  EDIT_DOCUMENT_NODE_DESCRIPTORS,
  type EditDocumentNodeTypeV2,
} from '../../../../packages/rawengine-schema/src/editDocumentV2';
import { useModalTransition } from '../../../hooks/ui/useModalTransition';
import { TextVariants } from '../../../types/typography';
import { type CopyPasteSettings, PasteMode } from '../../../utils/adjustments';
import {
  EDIT_DOCUMENT_V2_COPYABLE_NODE_TYPES,
  getEditDocumentV2CopyableNodeTypes,
} from '../../../utils/editDocumentV2';
import Button from '../../ui/primitives/Button';
import InspectorSegmentedControl from '../../ui/primitives/InspectorSegmentedControl';
import Switch from '../../ui/primitives/Switch';
import UiText from '../../ui/primitives/Text';

interface CopyPasteSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (settings: CopyPasteSettings) => void;
  settings: CopyPasteSettings;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const NODE_LABEL_KEY_PARTS: Partial<Record<EditDocumentNodeTypeV2, readonly string[]>> = {
  black_white_mixer: ['modals', 'copyPaste', 'groups', 'blackWhiteMixer'],
  camera_input: ['modals', 'copyPaste', 'groups', 'profileTone'],
  channel_mixer: ['modals', 'copyPaste', 'groups', 'channelMixer'],
  color_calibration: ['modals', 'copyPaste', 'groups', 'colorCalibration'],
  detail_denoise_dehaze: ['modals', 'copyPaste', 'groups', 'clarityDehaze'],
  display_creative: ['editor', 'adjustments', 'sections', 'effects'],
  geometry: ['modals', 'copyPaste', 'groups', 'transformRotation'],
  lens_correction: ['modals', 'copyPaste', 'groups', 'lensCorrection'],
  perceptual_grading: ['modals', 'copyPaste', 'groups', 'colorGrading'],
  point_color: ['modals', 'copyPaste', 'groups', 'colorMixer'],
  scene_curve: ['modals', 'copyPaste', 'groups', 'curves'],
  scene_global_color_tone: ['modals', 'copyPaste', 'groups', 'tone'],
  tone_equalizer: ['modals', 'copyPaste', 'groups', 'exposureToneMapper'],
};
type CopyPasteNodeDescriptor = (typeof EDIT_DOCUMENT_NODE_DESCRIPTORS)[number];
const COPY_PASTE_NODE_GROUPS = Object.entries(
  EDIT_DOCUMENT_NODE_DESCRIPTORS.filter(({ nodeType }) =>
    EDIT_DOCUMENT_V2_COPYABLE_NODE_TYPES.includes(nodeType),
  ).reduce<Record<string, CopyPasteNodeDescriptor[]>>((groups, descriptor) => {
    const section =
      descriptor.editorSection ??
      (descriptor.nodeType === 'geometry' || descriptor.nodeType === 'lens_correction' ? 'geometry' : 'other');
    (groups[section] ??= []).push(descriptor);
    return groups;
  }, {}),
);

interface PasteModeSwitchProps {
  selectedMode: PasteMode;
  onModeChange: (mode: PasteMode) => void;
}

interface CopyPasteSettingsDraftProps extends Omit<CopyPasteSettingsModalProps, 'isOpen' | 'settings'> {
  initialSettings: CopyPasteSettings;
  show: boolean;
}

const PasteModeSwitch = ({ selectedMode, onModeChange }: PasteModeSwitchProps) => {
  const { t } = useTranslation();

  const pasteModeOptions = useMemo(
    () => [
      { value: PasteMode.Merge, label: t('modals.copyPaste.modeMerge') },
      { value: PasteMode.Replace, label: t('modals.copyPaste.modeReplace') },
    ],
    [t],
  );

  return (
    <InspectorSegmentedControl
      ariaLabel={t('modals.copyPaste.pasteMode')}
      className="w-full"
      onChange={onModeChange}
      options={pasteModeOptions}
      value={selectedMode}
    />
  );
};

export default function CopyPasteSettingsModal(props: CopyPasteSettingsModalProps) {
  const { isOpen, settings } = props;
  const { isMounted, show } = useModalTransition(isOpen);
  const epochRef = useRef(isOpen ? 1 : 0);
  const wasOpenRef = useRef(isOpen);
  const sessionRef = useRef(
    isOpen
      ? {
          id: `copy-paste:${epochRef.current}`,
          settings: { ...settings, includedAdjustments: [...settings.includedAdjustments] },
        }
      : null,
  );
  if (isOpen && !wasOpenRef.current) {
    epochRef.current += 1;
    sessionRef.current = {
      id: `copy-paste:${epochRef.current}`,
      settings: { ...settings, includedAdjustments: [...settings.includedAdjustments] },
    };
  }
  wasOpenRef.current = isOpen;
  const session = sessionRef.current;
  if (!isMounted || !session) return null;

  return (
    <CopyPasteSettingsDraft
      key={session.id}
      initialSettings={session.settings}
      onClose={props.onClose}
      onSave={props.onSave}
      show={show}
    />
  );
}

export function CopyPasteSettingsDraft({ initialSettings, onClose, onSave, show }: CopyPasteSettingsDraftProps) {
  const { t } = useTranslation();
  const [localSettings, setLocalSettings] = useState<CopyPasteSettings>(() => ({
    ...initialSettings,
    includedAdjustments: [...getEditDocumentV2CopyableNodeTypes(initialSettings.includedAdjustments)],
    knownAdjustments: [...EDIT_DOCUMENT_V2_COPYABLE_NODE_TYPES],
  }));

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
    if (show) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [show, handleKeyDown]);

  const handleSelectAll = () => {
    setLocalSettings((prev) => ({
      ...prev,
      includedAdjustments: [...EDIT_DOCUMENT_V2_COPYABLE_NODE_TYPES],
    }));
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
                {COPY_PASTE_NODE_GROUPS.map(([section, descriptors]) => (
                  <div key={section}>
                    <UiText variant={TextVariants.heading} className="mb-2">
                      {t(`editor.adjustmentSnapshot.value.sections.${section}`, { defaultValue: capitalize(section) })}
                    </UiText>
                    {descriptors?.map((descriptor) => {
                      const isChecked = localSettings.includedAdjustments.includes(descriptor.nodeType);
                      const labelKey = NODE_LABEL_KEY_PARTS[descriptor.nodeType]?.join('.');

                      return (
                        <div key={descriptor.nodeType} className="mb-1.5 last:mb-0">
                          <Switch
                            label={
                              labelKey === undefined
                                ? capitalize(descriptor.nodeType.replaceAll('_', ' '))
                                : t(labelKey, { defaultValue: capitalize(descriptor.nodeType.replaceAll('_', ' ')) })
                            }
                            checked={isChecked}
                            onChange={(checked) => {
                              handleGroupToggle([descriptor.nodeType], checked);
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
