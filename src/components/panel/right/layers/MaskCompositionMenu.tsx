import { Minus, Plus, SquaresIntersect } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  getMaskCompositionMode,
  MASK_COMPOSITION_MODES,
  type MaskCompositionMode,
} from '../../../../utils/mask/lightroomMaskShell';
import { professionalInspectorDensityTokens } from '../../../ui/inspectorTokens';

interface MaskCompositionMenuProps {
  activeMode?: string;
  componentId?: string;
  disabled?: boolean;
  onSelect: (mode: MaskCompositionMode) => void;
}

const icons = {
  add: Plus,
  intersect: SquaresIntersect,
  subtract: Minus,
} as const;

/** Compact, explicit Add/Subtract/Intersect grammar for the selected component. */
export function MaskCompositionMenu({
  activeMode = 'add',
  componentId,
  disabled = false,
  onSelect,
}: MaskCompositionMenuProps) {
  const { t } = useTranslation();
  const selected = getMaskCompositionMode(activeMode);
  const renderOption = (mode: MaskCompositionMode) => {
    const Icon = icons[mode];
    const label =
      mode === 'add'
        ? t('editor.masks.actions.switchToAdd')
        : mode === 'subtract'
          ? t('editor.masks.actions.switchToSubtract')
          : t('editor.masks.actions.switchToIntersect');
    return (
      <button
        aria-label={label}
        aria-pressed={selected === mode}
        className={`${professionalInspectorDensityTokens.actionButton.base} ${professionalInspectorDensityTokens.actionButton.icon} ${
          selected === mode ? professionalInspectorDensityTokens.actionButton.selectedQuiet : ''
        }`}
        data-mask-composition-option={mode}
        data-testid={componentId ? `mask-composition-${componentId}-${mode}` : `mask-composition-${mode}`}
        disabled={disabled}
        key={mode}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(mode);
        }}
        type="button"
      >
        <Icon size={14} />
      </button>
    );
  };
  return (
    <div
      className="inline-flex items-center gap-0.5 rounded border border-editor-border bg-editor-panel-well p-0.5"
      data-mask-composition-mode={selected}
      data-testid={componentId ? `mask-composition-${componentId}` : 'mask-composition-menu'}
      role="group"
    >
      {MASK_COMPOSITION_MODES.map(renderOption)}
    </div>
  );
}
