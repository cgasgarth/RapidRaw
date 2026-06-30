import type { Adjustments } from '../../../utils/adjustments';
import type { AppSettings } from '../../ui/AppProperties';

export type AdjustmentUpdate = Partial<Adjustments> | ((prev: Adjustments) => Adjustments);

export interface ColorPanelGroupProps {
  adjustments: Adjustments;
  setAdjustments: (adjustments: AdjustmentUpdate) => void;
  appSettings: AppSettings | null;
  onDragStateChange?: ((isDragging: boolean) => void) | undefined;
}
