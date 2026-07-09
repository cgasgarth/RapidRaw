import cx from 'clsx';
import { CircleAlert, ImageOff, LoaderCircle, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { TextVariants } from '../../../../types/typography';
import type { EditorChromeStatus } from '../../../ui/editorChromeTokens';
import { professionalInspectorDensityTokens } from '../../../ui/inspectorTokens';
import UiText from '../../../ui/primitives/Text';

export interface InspectorPanelStatus {
  label: string;
  tone: EditorChromeStatus;
}

export interface InspectorPanelNotice {
  kind: 'empty' | 'error' | 'loading';
  label: string;
}

interface InspectorPanelFrameProps {
  actions?: ReactNode;
  children: ReactNode;
  icon: LucideIcon;
  label: string;
  notice?: InspectorPanelNotice | undefined;
  status?: InspectorPanelStatus | undefined;
  testId: string;
}

const noticePresentation: Record<InspectorPanelNotice['kind'], { icon: LucideIcon; toneClassName: string }> = {
  empty: { icon: ImageOff, toneClassName: 'text-text-secondary' },
  error: { icon: CircleAlert, toneClassName: 'text-editor-danger' },
  loading: { icon: LoaderCircle, toneClassName: 'text-editor-info' },
};

const statusDotClassName: Record<EditorChromeStatus, string> = {
  danger: 'bg-editor-danger',
  info: 'bg-editor-info',
  neutral: 'bg-text-tertiary',
  success: 'bg-editor-success',
  warning: 'bg-editor-warning',
};

export default function InspectorPanelFrame({
  actions,
  children,
  icon: Icon,
  label,
  notice,
  status,
  testId,
}: InspectorPanelFrameProps) {
  const density = professionalInspectorDensityTokens;

  return (
    <section
      aria-label={label}
      className="flex h-full min-w-0 flex-col overflow-hidden bg-editor-panel text-text-primary"
      data-inspector-density="compact"
      data-testid={testId}
    >
      <header className={density.frame.header} data-testid={`${testId}-header`}>
        <div className="flex min-w-0 items-center gap-2">
          <span aria-hidden="true" className={density.frame.iconSlot}>
            <Icon size={14} strokeWidth={1.8} />
          </span>
          <UiText as="h2" variant={TextVariants.heading} className={density.frame.title}>
            {label}
          </UiText>
          {status ? (
            <span
              aria-label={status.label}
              className={cx('h-1.5 w-1.5 shrink-0 rounded-full', statusDotClassName[status.tone])}
              data-testid={`${testId}-status`}
              role="status"
              title={status.label}
            />
          ) : null}
        </div>
        {actions ? <div className={density.frame.actions}>{actions}</div> : null}
      </header>

      {notice ? <InspectorPanelNoticeRow notice={notice} testId={`${testId}-notice`} /> : null}

      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </section>
  );
}

function InspectorPanelNoticeRow({ notice, testId }: { notice: InspectorPanelNotice; testId: string }) {
  const presentation = noticePresentation[notice.kind];
  const NoticeIcon = presentation.icon;

  return (
    <div
      aria-busy={notice.kind === 'loading'}
      aria-live="polite"
      className={cx(professionalInspectorDensityTokens.frame.notice, presentation.toneClassName)}
      data-notice-kind={notice.kind}
      data-testid={testId}
      role="status"
    >
      <NoticeIcon
        aria-hidden="true"
        className={cx('shrink-0', notice.kind === 'loading' && 'animate-spin')}
        size={13}
      />
      <span className="min-w-0 truncate" title={notice.label}>
        {notice.label}
      </span>
    </div>
  );
}
