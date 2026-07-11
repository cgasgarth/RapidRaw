import { Panel } from '../components/ui/AppProperties';

export interface MaskControlHoverOwnership {
  activeAiPatchContainerId: string | null;
  activeMaskContainerId: string | null;
  activeRightPanel: Panel | null;
}

export const ownsMaskControlHover = ({
  activeAiPatchContainerId,
  activeMaskContainerId,
  activeRightPanel,
}: MaskControlHoverOwnership): boolean =>
  (activeRightPanel === Panel.Masks && activeMaskContainerId !== null) ||
  (activeRightPanel === Panel.Ai && activeAiPatchContainerId !== null);
