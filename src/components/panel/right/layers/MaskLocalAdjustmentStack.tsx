import type { MouseEvent, ReactNode } from 'react';

import CollapsibleSection from '../../../ui/CollapsibleSection';

export type MaskLocalAdjustmentSection = 'basic' | 'color' | 'details' | 'effects' | 'curves';

export interface MaskLocalAdjustmentStackProps {
  collapsibleState: Record<string, boolean>;
  displayEditNodes: Record<'basic' | 'color' | 'curves' | 'details', { enabled: boolean }>;
  isAdvancedOpen: boolean;
  isContentVisible: (section: MaskLocalAdjustmentSection) => boolean;
  isDirty: (section: MaskLocalAdjustmentSection) => boolean;
  onContextMenu: (event: MouseEvent, section: MaskLocalAdjustmentSection) => void;
  onToggleAdvanced: () => void;
  onToggleSection: (section: MaskLocalAdjustmentSection) => void;
  onToggleVisibility: (section: MaskLocalAdjustmentSection) => void;
  renderSection: (section: MaskLocalAdjustmentSection) => ReactNode;
}

const PRIMARY_SECTIONS: readonly MaskLocalAdjustmentSection[] = ['basic', 'color', 'details', 'effects'];

const sectionTitle = (section: MaskLocalAdjustmentSection): string => {
  switch (section) {
    case 'basic':
      return 'Tone & Presence';
    case 'color':
      return 'Color';
    case 'details':
      return 'Detail';
    case 'effects':
      return 'Effects';
    case 'curves':
      return 'Curves';
  }
};

/**
 * The local-adjustment grammar is intentionally separate from the mask tree.
 * It keeps the familiar Tone/Presence → Color → Detail → Effects order while
 * leaving stronger curve controls reachable behind Advanced.
 */
export function MaskLocalAdjustmentStack({
  collapsibleState,
  displayEditNodes,
  isAdvancedOpen,
  isContentVisible,
  isDirty,
  onContextMenu,
  onToggleAdvanced,
  onToggleSection,
  onToggleVisibility,
  renderSection,
}: MaskLocalAdjustmentStackProps) {
  return (
    <div
      className="flex flex-col gap-1.5"
      data-adjustment-order="tone-presence,color,detail,effects"
      data-testid="mask-local-adjustment-stack"
    >
      {PRIMARY_SECTIONS.map((section) => (
        <CollapsibleSection
          canToggleVisibility
          isContentVisible={isContentVisible(section)}
          isDirty={isDirty(section)}
          isOpen={collapsibleState[section] ?? false}
          key={section}
          onContextMenu={(event) => onContextMenu(event, section)}
          onToggle={() => onToggleSection(section)}
          onToggleVisibility={() => onToggleVisibility(section)}
          testId={`mask-adjustments-section-${section}`}
          title={sectionTitle(section)}
        >
          {renderSection(section)}
        </CollapsibleSection>
      ))}

      <CollapsibleSection
        canToggleVisibility={false}
        isContentVisible={displayEditNodes.curves.enabled}
        isOpen={isAdvancedOpen}
        onToggle={onToggleAdvanced}
        testId="mask-adjustments-advanced"
        title="Advanced"
      >
        <CollapsibleSection
          canToggleVisibility
          isContentVisible={isContentVisible('curves')}
          isDirty={isDirty('curves')}
          isOpen={collapsibleState['curves'] ?? false}
          onContextMenu={(event) => onContextMenu(event, 'curves')}
          onToggle={() => onToggleSection('curves')}
          onToggleVisibility={() => onToggleVisibility('curves')}
          testId="mask-adjustments-section-curves"
          title={sectionTitle('curves')}
        >
          {renderSection('curves')}
        </CollapsibleSection>
      </CollapsibleSection>
    </div>
  );
}
