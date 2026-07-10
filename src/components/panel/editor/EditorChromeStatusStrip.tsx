import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { editorChromeTokens } from '../../ui/editorChromeTokens';

interface EditorChromeStatusStripProps {
  isFullScreen: boolean;
  isRendering?: boolean;
}

export default function EditorChromeStatusStrip({ isFullScreen, isRendering = false }: EditorChromeStatusStripProps) {
  const { t } = useTranslation();

  if (isFullScreen || !isRendering) {
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
        data-status-chip="rendering"
        data-testid="editor-chrome-status-rendering"
      >
        <Loader2 aria-hidden="true" className="animate-spin" size={12} strokeWidth={2} />
        <span>{t('editor.adjustments.status.loadingImage')}</span>
      </span>
    </div>
  );
}
