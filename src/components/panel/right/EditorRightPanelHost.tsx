import { motion, useReducedMotion } from 'framer-motion';
import { Component, type ReactNode, Suspense, useCallback, useLayoutEffect, useRef } from 'react';
import { useUIStore } from '../../../store/useUIStore';
import type { AppSettings, Panel, SelectedImage } from '../../ui/AppProperties';
import type { ExportState } from '../../ui/ExportImportProperties';
import { getRightPanelHostDescriptor, RIGHT_PANEL_ENTRIES, type RightPanelHostDescriptor } from './rightPanelRegistry';
import { getRightPanelRenderer } from './rightPanelRenderers';

export interface EditorRightPanelHostProps {
  activeRightPanel: Panel | null;
  appSettings: AppSettings | null;
  exportState: ExportState;
  handleSettingsChange: (settings: AppSettings) => Promise<void> | void;
  multiSelectedPaths: Array<string>;
  onLinkedVariantImported: (path: string) => Promise<void> | void;
  onNavigateToCommunity: () => void;
  onOpenTetherCapture: (path: string) => Promise<void> | void;
  renderedRightPanel: Panel | null;
  rootPaths: Array<string>;
  selectedImage: SelectedImage | null;
  setExportState: (updater: Partial<ExportState> | ((state: ExportState) => Partial<ExportState>)) => void;
  slideDirection: number;
}

interface PanelErrorBoundaryProps {
  children: ReactNode;
  descriptor: RightPanelHostDescriptor;
}

interface PanelErrorBoundaryState {
  hasError: boolean;
}

function EditorRightPanelSkeleton() {
  return (
    <div
      aria-busy="true"
      className="flex h-full w-full flex-col bg-editor-panel"
      data-testid="editor-right-panel-skeleton"
    >
      <div className="flex min-h-11 shrink-0 items-center border-b border-editor-border px-3">
        <div className="h-3 w-28 rounded bg-editor-panel-raised" />
      </div>
      <div className="space-y-3 p-3">
        <div className="h-20 rounded-md border border-editor-border bg-editor-panel-well" />
        <div className="h-7 rounded bg-editor-panel-raised" />
        <div className="h-7 rounded bg-editor-panel-raised" />
        <div className="h-32 rounded-md border border-editor-border bg-editor-panel-well" />
      </div>
    </div>
  );
}

class PanelErrorBoundary extends Component<PanelErrorBoundaryProps, PanelErrorBoundaryState> {
  override state: PanelErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): PanelErrorBoundaryState {
    return { hasError: true };
  }

  override componentDidUpdate(previousProps: PanelErrorBoundaryProps) {
    if (previousProps.descriptor !== this.props.descriptor && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  override render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div
        aria-live="polite"
        className="grid h-full place-items-center px-5 text-center text-[12px] leading-5 text-text-secondary"
        data-testid="editor-right-panel-error"
        role="status"
      >
        {this.props.descriptor.error.fallbackLabel}
      </div>
    );
  }
}

export function EditorRightPanelHost(props: EditorRightPanelHostProps) {
  const { activeRightPanel, renderedRightPanel } = props;
  const prefersReducedMotion = useReducedMotion();
  const hostRef = useRef<HTMLElement | null>(null);
  const scrollPositionsRef = useRef(new Map<Panel, number>());
  const mountedKeepAlivePanels = useUIStore((state) => state.mountedKeepAlivePanels);
  const activeDescriptor = activeRightPanel === null ? null : getRightPanelHostDescriptor(activeRightPanel);

  const restoreScrollPosition = useCallback((panel: Panel) => {
    const descriptor = getRightPanelHostDescriptor(panel);
    const scrollTop = scrollPositionsRef.current.get(panel);
    if (descriptor.scroll.mode !== 'panel' || descriptor.scroll.rootSelector === undefined || scrollTop === undefined)
      return;
    const rootSelector = descriptor.scroll.rootSelector;

    window.requestAnimationFrame(() => {
      const scrollRoot = hostRef.current?.querySelector<HTMLElement>(rootSelector);
      if (scrollRoot === undefined || scrollRoot === null) return;
      scrollRoot.scrollTop = Math.min(scrollTop, Math.max(0, scrollRoot.scrollHeight - scrollRoot.clientHeight));
    });
  }, []);

  useLayoutEffect(() => {
    if (activeRightPanel !== null) restoreScrollPosition(activeRightPanel);
  }, [activeRightPanel, restoreScrollPosition]);

  const renderPanel = (panel: Panel) => {
    const descriptor = getRightPanelHostDescriptor(panel);
    return <PanelErrorBoundary descriptor={descriptor}>{getRightPanelRenderer(panel)(props)}</PanelErrorBoundary>;
  };

  const predecessorPanel = renderedRightPanel;
  const renderLoadingFallback = () => {
    if (predecessorPanel === null || predecessorPanel === activeRightPanel) return <EditorRightPanelSkeleton />;
    return <Suspense fallback={<EditorRightPanelSkeleton />}>{renderPanel(predecessorPanel)}</Suspense>;
  };

  const onScrollCapture = (event: React.UIEvent<HTMLElement>) => {
    if (activeRightPanel === null || activeDescriptor?.scroll.mode !== 'panel') return;
    const scrollRoot = event.target;
    if (!(scrollRoot instanceof HTMLElement) || !scrollRoot.matches(activeDescriptor.scroll.rootSelector ?? '')) return;
    scrollPositionsRef.current.set(activeRightPanel, scrollRoot.scrollTop);
  };

  return (
    <section
      aria-label={activeDescriptor?.header.fallbackLabel ?? 'Inspector'}
      className="h-full min-h-0 w-full overflow-hidden bg-editor-panel text-text-primary"
      data-active-panel={activeRightPanel ?? undefined}
      data-compact-behavior={activeDescriptor?.compact ?? 'preserve'}
      data-testid="editor-right-panel-host"
      onScrollCapture={onScrollCapture}
      ref={hostRef}
    >
      <div className="h-full min-h-0 w-full" data-right-panel-focus-entry="true" tabIndex={-1}>
        {RIGHT_PANEL_ENTRIES.filter((entry) => entry.host.keepAlive === 'session').map(({ id }) => {
          const isActive = activeRightPanel === id;
          const hasMounted = mountedKeepAlivePanels.has(id);
          if (!isActive && !hasMounted) return null;

          return (
            <Suspense fallback={isActive ? renderLoadingFallback() : null} key={id}>
              <div
                aria-hidden={!isActive}
                className="h-full w-full overflow-hidden"
                data-testid={`editor-right-panel-keep-alive-${id}`}
                hidden={!isActive}
                inert={isActive ? undefined : true}
              >
                {renderPanel(id)}
              </div>
            </Suspense>
          );
        })}

        {activeRightPanel !== null && activeDescriptor !== null && activeDescriptor.keepAlive !== 'session' ? (
          <Suspense
            fallback={
              activeDescriptor.loading.retainPredecessor ? renderLoadingFallback() : <EditorRightPanelSkeleton />
            }
          >
            <motion.div
              animate={{ opacity: 1 }}
              className="h-full w-full overflow-hidden"
              initial={prefersReducedMotion ? false : { opacity: 0.96 }}
              key={activeRightPanel}
              transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.12, ease: 'easeOut' }}
            >
              {renderPanel(activeRightPanel)}
            </motion.div>
          </Suspense>
        ) : null}
      </div>
    </section>
  );
}
