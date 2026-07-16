import type { EditDocumentNodeParamsV2 } from '../../../../packages/rawengine-schema/src/editDocumentV2';
import type { AppSettings } from '../../ui/AppProperties';

export type ColorPanelAdjustmentView = EditDocumentNodeParamsV2<'black_white_mixer'> &
  EditDocumentNodeParamsV2<'camera_input'> &
  EditDocumentNodeParamsV2<'channel_mixer'> &
  EditDocumentNodeParamsV2<'color_balance_rgb'> &
  EditDocumentNodeParamsV2<'color_calibration'> &
  EditDocumentNodeParamsV2<'color_presence'> &
  EditDocumentNodeParamsV2<'luma_levels'> &
  EditDocumentNodeParamsV2<'perceptual_grading'> &
  EditDocumentNodeParamsV2<'point_color'> &
  EditDocumentNodeParamsV2<'scene_curve'> &
  EditDocumentNodeParamsV2<'selective_color_mixer'> &
  EditDocumentNodeParamsV2<'skin_tone_uniformity'> & { temperature?: number; tint?: number };
export type AdjustmentUpdate =
  | Partial<ColorPanelAdjustmentView>
  | ((prev: ColorPanelAdjustmentView) => ColorPanelAdjustmentView);

export interface ColorPanelGroupProps {
  adjustments: ColorPanelAdjustmentView;
  setAdjustments: (adjustments: AdjustmentUpdate) => void;
  appSettings: AppSettings | null;
  onDragStateChange?: ((isDragging: boolean) => void) | undefined;
}
