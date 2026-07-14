import cx from 'clsx';
import { useTranslation } from 'react-i18next';

import {
  type NegativeLabWorkspacePanelId,
  negativeLabWorkspacePanelIdSchema,
} from '../../../schemas/negative-lab/negativeLabWorkspaceLayout';
import { useUIStore } from '../../../store/useUIStore';

interface NegativeLabCompactControlPanelsProps {
  onNavigate: (panelId: NegativeLabWorkspacePanelId) => void;
}

const PANELS: ReadonlyArray<{ id: NegativeLabWorkspacePanelId; labelKey: string; targetId: string }> = [
  { id: 'process-profile', labelKey: 'workflowSetup', targetId: 'negative-lab-source-context' },
  { id: 'base-bounds', labelKey: 'baseSamplingStudio', targetId: 'negative-lab-source-context' },
  { id: 'print-color', labelKey: 'colorTiming', targetId: 'negative-lab-correction-controls' },
  { id: 'auto-sampling', labelKey: 'baseSamplingCtaTitle', targetId: 'negative-lab-correction-controls' },
  { id: 'roll-qc', labelKey: 'frameHealth', targetId: 'negative-lab-qc' },
  { id: 'export-output', labelKey: 'exportOptions', targetId: 'negative-lab-export-output' },
];

export function NegativeLabCompactControlPanels({ onNavigate }: NegativeLabCompactControlPanelsProps) {
  const { t } = useTranslation();
  const panelLabel = (labelKey: string): string => {
    switch (labelKey) {
      case 'workflowSetup':
        return t('modals.negativeConversion.workflowSetup');
      case 'baseSamplingStudio':
        return t('modals.negativeConversion.baseSamplingStudio');
      case 'colorTiming':
        return t('modals.negativeConversion.colorTiming');
      case 'baseSamplingCtaTitle':
        return t('modals.negativeConversion.baseSamplingCtaTitle');
      case 'frameHealth':
        return t('modals.negativeConversion.frameHealth');
      default:
        return t('modals.negativeConversion.exportOptions');
    }
  };
  const layout = useUIStore((state) => state.negativeLabWorkspaceLayout);
  const togglePanel = useUIStore((state) => state.toggleNegativeLabWorkspacePanel);
  const setLayout = useUIStore((state) => state.setNegativeLabWorkspaceLayout);

  return (
    <div
      aria-label={t('modals.negativeConversion.title')}
      className="grid grid-cols-2 gap-1 border-b border-surface bg-bg-secondary p-2 sm:grid-cols-3"
      data-collapsed-panels={layout.collapsedPanelIds.join(',')}
      data-pinned-panel={layout.pinnedPanelId ?? ''}
      data-testid="negative-lab-compact-control-panels"
      role="toolbar"
    >
      {PANELS.map((panel) => {
        const collapsed = layout.collapsedPanelIds.includes(panel.id);
        const pinned = layout.pinnedPanelId === panel.id;
        return (
          <div className="flex min-w-0 items-center gap-1" key={panel.id}>
            <button
              aria-controls={panel.targetId}
              aria-expanded={!collapsed}
              aria-pressed={pinned}
              className={cx(
                'min-w-0 flex-1 truncate rounded border px-2 py-1 text-left text-[11px] transition-colors',
                collapsed
                  ? 'border-surface bg-bg-primary text-text-tertiary'
                  : 'border-accent/50 bg-accent/10 text-text-primary',
              )}
              data-panel-id={panel.id}
              data-panel-state={collapsed ? 'collapsed' : 'expanded'}
              data-testid={`negative-lab-panel-${panel.id}`}
              onClick={() => {
                togglePanel(panel.id);
                onNavigate(panel.id);
              }}
              type="button"
            >
              {panelLabel(panel.labelKey)}
            </button>
            <button
              aria-label={t('modals.negativeConversion.title')}
              className="rounded border border-surface px-1.5 py-1 text-[10px] text-text-tertiary hover:bg-surface"
              data-testid={`negative-lab-panel-pin-${panel.id}`}
              onClick={() => {
                setLayout({ ...layout, pinnedPanelId: pinned ? null : panel.id });
              }}
              type="button"
            >
              {pinned ? '●' : '○'}
            </button>
          </div>
        );
      })}
    </div>
  );
}

export const negativeLabCompactPanelIds = PANELS.map((panel) => panel.id).filter(
  (panelId) => negativeLabWorkspacePanelIdSchema.safeParse(panelId).success,
);
