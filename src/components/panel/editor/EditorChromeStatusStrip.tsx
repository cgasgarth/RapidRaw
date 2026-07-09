import cx from 'clsx';
import { AlertTriangle, CheckCircle2, RadioTower, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';

import { useEditorStore } from '../../../store/useEditorStore';
import {
  type EditorChromeStatusChip,
  getEditorChromeStatusChips,
} from '../../../utils/color/runtime/gamutWarningDisplay';
import { editorChromeStatusChipClassName } from '../../ui/editorChromeTokens';

interface EditorChromeStatusStripProps {
  isFullScreen: boolean;
}

const chipIcons: Record<EditorChromeStatusChip['id'], typeof AlertTriangle> = {
  'gamut-warning': TriangleAlert,
  'highlight-clipping': AlertTriangle,
  'preview-scopes': RadioTower,
  'shadow-clipping': AlertTriangle,
  'soft-proof': CheckCircle2,
};

export default function EditorChromeStatusStrip({ isFullScreen }: EditorChromeStatusStripProps) {
  const { t } = useTranslation();
  const {
    adjustments,
    exportSoftProofRecipeId,
    exportSoftProofTransform,
    gamutWarningOverlay,
    isExportSoftProofEnabled,
    previewScopeStatus,
    selectedImagePath,
  } = useEditorStore(
    useShallow((state) => ({
      adjustments: state.adjustments,
      exportSoftProofRecipeId: state.exportSoftProofRecipeId,
      exportSoftProofTransform: state.exportSoftProofTransform,
      gamutWarningOverlay: state.gamutWarningOverlay,
      isExportSoftProofEnabled: state.isExportSoftProofEnabled,
      previewScopeStatus: state.previewScopeStatus,
      selectedImagePath: state.selectedImage?.path ?? null,
    })),
  );

  const chips = getEditorChromeStatusChips({
    adjustments,
    gamutWarningOverlay,
    previewScopeStatus,
    proofContext: {
      exportSoftProofRecipeId,
      exportSoftProofTransform,
      isExportSoftProofEnabled,
      selectedImagePath,
    },
  });
  const actionableChips = chips.filter((chip) => chip.active && (chip.tone === 'warning' || chip.tone === 'danger'));

  if (isFullScreen || actionableChips.length === 0) {
    return <div aria-hidden="true" data-testid="editor-chrome-status-strip" data-state="hidden" hidden />;
  }

  return (
    <div
      aria-label={t('editor.chromeStatus.accessibilityLabel')}
      className="pointer-events-none absolute inset-x-2 top-2 z-30 flex max-w-full flex-wrap items-center gap-1.5"
      data-testid="editor-chrome-status-strip"
      data-state="visible"
      role="status"
    >
      {actionableChips.map((chip) => {
        const Icon = chipIcons[chip.id];

        return (
          <span
            aria-label={`${chip.label}: ${chip.value}. ${chip.detail}`}
            className={cx(
              editorChromeStatusChipClassName(chip.tone),
              'pointer-events-auto max-w-full border border-editor-border/70 bg-editor-panel/95 normal-case shadow-sm backdrop-blur',
            )}
            data-active={String(chip.active)}
            data-detail={chip.detail}
            data-state={chip.state}
            data-status-chip={chip.id}
            data-testid={`editor-chrome-status-chip-${chip.id}`}
            data-tone={chip.tone}
            data-value={chip.value}
            key={chip.id}
            title={`${chip.label}: ${chip.value} (${chip.detail})`}
          >
            <Icon aria-hidden="true" size={12} strokeWidth={2.2} />
            <span className="whitespace-nowrap">{chip.label}</span>
            <span className="min-w-0 truncate font-mono normal-case tabular-nums">{chip.value}</span>
          </span>
        );
      })}
    </div>
  );
}
