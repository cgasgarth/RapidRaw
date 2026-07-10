import { AlertTriangle, CheckCircle2, Ellipsis, Loader2, RadioTower, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';

import { useEditorStore } from '../../../store/useEditorStore';
import {
  type EditorChromeStatusChip,
  getEditorChromeStatusChips,
  getEditorChromeStatusStripChips,
} from '../../../utils/color/runtime/gamutWarningDisplay';
import { editorChromeTokens } from '../../ui/editorChromeTokens';

interface EditorChromeStatusStripProps {
  isFullScreen: boolean;
  isRendering?: boolean;
}

const PRIMARY_DIAGNOSTIC_LIMIT = 2;

const chipIcons: Record<EditorChromeStatusChip['id'], typeof AlertTriangle> = {
  'gamut-warning': TriangleAlert,
  'highlight-clipping': AlertTriangle,
  'preview-scopes': RadioTower,
  'shadow-clipping': AlertTriangle,
  'soft-proof': CheckCircle2,
};

export default function EditorChromeStatusStrip({ isFullScreen, isRendering = false }: EditorChromeStatusStripProps) {
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
  const statusChips = getEditorChromeStatusStripChips(chips);
  const primaryChips = statusChips.slice(0, PRIMARY_DIAGNOSTIC_LIMIT);
  const secondaryChips = statusChips.slice(PRIMARY_DIAGNOSTIC_LIMIT);

  if (isFullScreen || (!isRendering && statusChips.length === 0)) {
    return <div aria-hidden="true" data-testid="editor-chrome-status-strip" data-state="hidden" hidden />;
  }

  return (
    <div
      aria-label={t('editor.chromeStatus.accessibilityLabel')}
      aria-live={isRendering ? 'polite' : 'off'}
      className={editorChromeTokens.region.viewerStatusFooter}
      data-editor-chrome="status-footer"
      data-editor-control-placement="outside-image"
      data-layout="footer"
      data-testid="editor-chrome-status-strip"
      data-state="visible"
      role="status"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        {isRendering && (
          <span
            className="inline-flex items-center gap-1 text-[11px] font-medium leading-4 text-text-secondary"
            data-status-chip="rendering"
            data-testid="editor-chrome-status-rendering"
          >
            <Loader2 aria-hidden="true" className="animate-spin" size={12} strokeWidth={2} />
            <span>{t('editor.adjustments.status.loadingImage')}</span>
          </span>
        )}
        {primaryChips.map((chip) => {
          const Icon = chipIcons[chip.id];

          return <DiagnosticItem chip={chip} Icon={Icon} key={chip.id} placement="primary" />;
        })}
        {secondaryChips.length > 0 && (
          <details
            className="min-w-0 [&[open]]:basis-full [&[open]>div]:flex"
            data-status-overflow={secondaryChips.length}
            data-testid="editor-chrome-status-disclosure"
          >
            <summary
              aria-label={t('editor.chromeStatus.accessibilityLabel')}
              className={`${editorChromeTokens.button.base} ${editorChromeTokens.button.iconCompact} ${editorChromeTokens.button.quiet} ${editorChromeTokens.focusRing} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}
              title={t('editor.chromeStatus.accessibilityLabel')}
            >
              <Ellipsis aria-hidden="true" size={15} />
            </summary>
            <div className="hidden flex-wrap items-center gap-x-2 gap-y-1 pt-1">
              {secondaryChips.map((chip) => {
                const Icon = chipIcons[chip.id];

                return <DiagnosticItem chip={chip} Icon={Icon} key={chip.id} placement="disclosure" />;
              })}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

function DiagnosticItem({
  chip,
  Icon,
  placement,
}: {
  chip: EditorChromeStatusChip;
  Icon: typeof AlertTriangle;
  placement: 'disclosure' | 'primary';
}) {
  return (
    <span
      aria-label={`${chip.label}: ${chip.value}. ${chip.detail}`}
      className="inline-flex min-w-0 items-center gap-1 text-[11px] font-medium leading-4 text-text-secondary"
      data-active={String(chip.active)}
      data-detail={chip.detail}
      data-placement={placement}
      data-state={chip.state}
      data-status-chip={chip.id}
      data-testid={`editor-chrome-status-chip-${chip.id}`}
      data-tone={chip.tone}
      data-value={chip.value}
      title={`${chip.label}: ${chip.value} (${chip.detail})`}
    >
      <Icon aria-hidden="true" className={iconToneClassName(chip.tone)} size={12} strokeWidth={2.2} />
      <span className="whitespace-nowrap">{chip.label}</span>
      <span className="min-w-0 truncate font-mono tabular-nums">{chip.value}</span>
    </span>
  );
}

function iconToneClassName(tone: EditorChromeStatusChip['tone']): string {
  switch (tone) {
    case 'danger':
      return 'text-editor-danger';
    case 'warning':
      return 'text-editor-warning';
    case 'success':
      return 'text-editor-success';
    case 'info':
      return 'text-editor-info';
    case 'neutral':
      return 'text-text-secondary';
  }
}
