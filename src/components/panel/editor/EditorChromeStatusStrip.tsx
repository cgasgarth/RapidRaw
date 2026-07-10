import { Check, Circle, Loader2, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { PreviewQualityStatus } from '../../../utils/adaptivePreviewQuality';
import { editorChromeTokens } from '../../ui/editorChromeTokens';

interface EditorChromeStatusStripProps {
  isFullScreen: boolean;
  isRendering?: boolean;
  qualityStatus?: PreviewQualityStatus | null;
}

export default function EditorChromeStatusStrip({
  isFullScreen,
  isRendering = false,
  qualityStatus = null,
}: EditorChromeStatusStripProps) {
  const { t } = useTranslation();
  const isRefining = qualityStatus?.phase === 'refining_current_view';
  const isLimited = qualityStatus?.phase === 'degraded_limited';
  const isInteraction =
    qualityStatus?.phase === 'displaying_interaction' || qualityStatus?.phase === 'rendering_interaction';
  const label = qualityStatus ? t(`editor.chromeStatus.previewQuality.${qualityStatus.phase}`) : null;

  if (isFullScreen || (!isRendering && qualityStatus === null)) {
    return <div aria-hidden="true" data-testid="editor-chrome-status-strip" data-state="hidden" hidden />;
  }

  return (
    <div
      aria-label={t('editor.chromeStatus.accessibilityLabel')}
      aria-live="polite"
      className={editorChromeTokens.region.viewerStatusFooter}
      data-editor-chrome="status-footer"
      data-editor-control-placement="outside-image"
      data-layout="footer"
      data-testid="editor-chrome-status-strip"
      data-state="visible"
      role="status"
    >
      <span
        className="inline-flex items-center gap-1 text-[11px] font-medium leading-4 text-text-secondary"
        data-status-chip={qualityStatus?.phase ?? 'rendering'}
        data-testid="editor-chrome-status-rendering"
      >
        {isRefining || (isRendering && qualityStatus === null) ? (
          <Loader2 aria-hidden="true" className="animate-spin" size={12} strokeWidth={2} />
        ) : isLimited ? (
          <TriangleAlert aria-hidden="true" size={12} strokeWidth={2} />
        ) : isInteraction ? (
          <Circle aria-hidden="true" fill="currentColor" size={7} strokeWidth={0} />
        ) : (
          <Check aria-hidden="true" size={12} strokeWidth={2} />
        )}
        <span>{label ?? t('editor.adjustments.status.loadingImage')}</span>
      </span>
    </div>
  );
}
