import type { Adjustments, MaskAdjustments } from '../../../utils/adjustments';
import type { AppSettings } from '../../ui/AppProperties';

export type AdjustmentUpdate = Partial<Adjustments> | ((prev: Adjustments) => Adjustments);
export type ColorPanelAdjustmentView = Adjustments & Partial<Pick<MaskAdjustments, 'temperature' | 'tint'>>;

export interface ColorPanelGroupProps {
  adjustments: ColorPanelAdjustmentView;
  setAdjustments: (adjustments: AdjustmentUpdate) => void;
  appSettings: AppSettings | null;
  onDragStateChange?: ((isDragging: boolean) => void) | undefined;
}
