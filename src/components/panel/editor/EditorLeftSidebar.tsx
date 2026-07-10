import cx from 'clsx';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { type PointerEventHandler, type ReactNode, useEffect, useRef } from 'react';
import { Orientation } from '../../ui/AppProperties';
import CollapsibleSection from '../../ui/CollapsibleSection';
import { editorChromeTokens } from '../../ui/editorChromeTokens';
import { professionalInspectorDensityTokens } from '../../ui/inspectorTokens';
import Resizer from '../../ui/Resizer';

export const EDITOR_LEFT_SECTION_IDS = ['navigator', 'presets', 'snapshots', 'history'] as const;
export type EditorLeftSectionId = (typeof EDITOR_LEFT_SECTION_IDS)[number];
export type EditorLeftSidebarSlots = Partial<Record<EditorLeftSectionId, ReactNode>>;
const EDITOR_LEFT_RESIZER_WIDTH = 8;

interface EditorLeftSidebarProps {
  expandedSections: readonly string[];
  isFullScreen: boolean;
  isResizing: boolean;
  isVisible: boolean;
  onResizeStart: PointerEventHandler<HTMLDivElement>;
  onSectionExpandedChange: (sectionId: EditorLeftSectionId, expanded: boolean) => void;
  onVisibleChange: (visible: boolean) => void;
  slots?: EditorLeftSidebarSlots;
  width: number;
}

export default function EditorLeftSidebar({
  expandedSections,
  isFullScreen,
  isResizing,
  isVisible,
  onResizeStart,
  onSectionExpandedChange,
  onVisibleChange,
  slots = {},
  width,
}: EditorLeftSidebarProps) {
  const sidebarRef = useRef<HTMLElement | null>(null);
  const expandButtonRef = useRef<HTMLButtonElement | null>(null);
  const shouldRestoreFocusRef = useRef(false);
  const labels: Record<EditorLeftSectionId, string> = {
    history: 'History',
    navigator: 'Navigator',
    presets: 'Presets',
    snapshots: 'Snapshots',
  };

  useEffect(() => {
    if (!isVisible && shouldRestoreFocusRef.current) {
      shouldRestoreFocusRef.current = false;
      expandButtonRef.current?.focus();
    }
  }, [isVisible]);

  const handleCollapse = () => {
    shouldRestoreFocusRef.current = sidebarRef.current?.contains(document.activeElement) ?? false;
    onVisibleChange(false);
  };

  return (
    <div
      className={cx(
        'editor-shell-left flex h-full min-h-0 shrink-0 overflow-hidden',
        !isResizing && 'transition-[width,opacity] duration-300 ease-in-out',
      )}
      data-editor-region="left"
      data-editor-surrounding-chrome="true"
      data-testid="editor-left-region"
      style={{
        opacity: isFullScreen ? 0 : 1,
        width: isFullScreen ? '0px' : `${isVisible ? width + EDITOR_LEFT_RESIZER_WIDTH : 32}px`,
      }}
    >
      {/* i18next-instrument-ignore */}
      <aside
        aria-label="Develop workflow"
        className="flex h-full min-h-0 shrink-0 flex-col overflow-hidden bg-editor-panel"
        data-editor-left-state={isVisible ? 'expanded' : 'collapsed'}
        ref={sidebarRef}
        style={{ width: `${isVisible ? width : 32}px` }}
      >
        {isVisible ? (
          <>
            <header className={professionalInspectorDensityTokens.frame.header}>
              {/* i18next-instrument-ignore */}
              <h2 className={professionalInspectorDensityTokens.frame.title}>Develop</h2>
              {/* i18next-instrument-ignore */}
              <button
                aria-label="Collapse Develop workflow"
                className={cx(
                  editorChromeTokens.button.base,
                  editorChromeTokens.button.iconCompact,
                  editorChromeTokens.button.quiet,
                )}
                data-testid="editor-left-collapse"
                data-tooltip="Collapse Develop workflow"
                onClick={handleCollapse}
                type="button"
              >
                <PanelLeftClose aria-hidden="true" size={16} />
              </button>
            </header>
            {/* i18next-instrument-ignore */}
            <div
              aria-label="Develop workflow sections"
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
              data-testid="editor-left-scroll-root"
              role="group"
            >
              {EDITOR_LEFT_SECTION_IDS.map((sectionId) => {
                const isOpen = expandedSections.includes(sectionId);
                return (
                  <CollapsibleSection
                    isContentVisible
                    isOpen={isOpen}
                    key={sectionId}
                    onToggle={() => {
                      onSectionExpandedChange(sectionId, !isOpen);
                    }}
                    testId={`editor-left-${sectionId}`}
                    title={labels[sectionId]}
                  >
                    <div
                      aria-label={`${labels[sectionId]} slot`}
                      className={cx('w-full bg-editor-panel-well', sectionId === 'navigator' ? 'min-h-28' : 'min-h-10')}
                      data-editor-left-slot={sectionId}
                      role="group"
                    >
                      {isOpen ? slots[sectionId] : null}
                    </div>
                  </CollapsibleSection>
                );
              })}
            </div>
          </>
        ) : (
          /* i18next-instrument-ignore */
          <button
            aria-label="Expand Develop workflow"
            className={cx(
              editorChromeTokens.button.base,
              editorChromeTokens.button.quiet,
              'h-full w-8 rounded-none border-0',
            )}
            data-testid="editor-left-expand"
            data-tooltip="Expand Develop workflow"
            onClick={() => {
              onVisibleChange(true);
            }}
            ref={expandButtonRef}
            type="button"
          >
            <PanelLeftOpen aria-hidden="true" size={16} />
          </button>
        )}
      </aside>
      {isVisible && !isFullScreen ? (
        <Resizer
          ariaLabel="Resize Develop workflow"
          className="editor-shell-resizer editor-shell-resizer-vertical"
          direction={Orientation.Vertical}
          onMouseDown={onResizeStart}
          testId="editor-left-resizer"
        />
      ) : null}
    </div>
  );
}
