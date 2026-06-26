import { t } from 'i18next';
import {
  Brush,
  BringToFront,
  Circle,
  Cloud,
  Droplet,
  Droplets,
  Eraser,
  MoreHorizontal,
  RectangleHorizontal,
  Sparkles,
  TriangleRight,
  User,
  Sun,
} from 'lucide-react';

import type { LucideIcon } from 'lucide-react';

export type SubMaskParameters = Record<string, unknown>;

export enum Mask {
  AiDepth = 'ai-depth',
  AiForeground = 'ai-foreground',
  AiObject = 'ai-object',
  AiPerson = 'ai-person',
  AiSky = 'ai-sky',
  AiSubject = 'ai-subject',
  All = 'all',
  Brush = 'brush',
  Flow = 'flow',
  Color = 'color',
  Linear = 'linear',
  Luminance = 'luminance',
  QuickEraser = 'quick-eraser',
  Radial = 'radial',
}

export enum SubMaskMode {
  Additive = 'additive',
  Subtractive = 'subtractive',
  Intersect = 'intersect',
}

export enum ToolType {
  AiSeletor = 'ai-selector',
  Brush = 'brush',
  Eraser = 'eraser',
  GenerativeReplace = 'generative-replace',
  SelectSubject = 'select-subject',
}

export interface MaskType {
  disabled: boolean;
  icon: LucideIcon;
  id?: string;
  name: string;
  personPart?: 'face' | 'full_person';
  type: Mask;
}

export interface SubMask {
  id: string;
  invert: boolean;
  mode: SubMaskMode;
  name?: string;
  opacity: number;
  parameters?: SubMaskParameters;
  type: Mask;
  visible: boolean;
}

export function formatMaskTypeName(type: Mask) {
  switch (type) {
    case Mask.AiDepth:
      return t('masks.types.depth');
    case Mask.AiSubject:
      return t('masks.types.subject');
    case Mask.AiObject:
      return t('masks.types.object');
    case Mask.AiForeground:
      return t('masks.types.foreground');
    case Mask.AiPerson:
      return t('masks.types.person');
    case Mask.AiSky:
      return t('masks.types.sky');
    case Mask.All:
      return t('masks.types.all');
    case Mask.QuickEraser:
      return t('masks.types.quickEraser');
    case Mask.Brush:
      return t('masks.types.brush');
    case Mask.Flow:
      return t('masks.types.flow');
    case Mask.Color:
      return t('masks.types.color');
    case Mask.Linear:
      return t('masks.types.linear');
    case Mask.Luminance:
      return t('masks.types.luminance');
    case Mask.Radial:
      return t('masks.types.radial');
  }
}

export function getMaskTypeName(mask: MaskType) {
  if (mask.id === 'others') return t('masks.types.others');
  if (mask.personPart === 'face') return t('masks.types.face');
  if (mask.type === Mask.QuickEraser && mask.name === 'Quick Erase') {
    return t('masks.types.quickErase');
  }
  return formatMaskTypeName(mask.type);
}

export function getSubMaskName(subMask: Pick<SubMask, 'name' | 'type'>) {
  return subMask.name?.trim() || formatMaskTypeName(subMask.type);
}

export const MASK_ICON_MAP: Record<Mask, LucideIcon> = {
  [Mask.AiDepth]: BringToFront,
  [Mask.AiForeground]: User,
  [Mask.AiObject]: Sparkles,
  [Mask.AiPerson]: User,
  [Mask.AiSky]: Cloud,
  [Mask.AiSubject]: Sparkles,
  [Mask.All]: RectangleHorizontal,
  [Mask.Brush]: Brush,
  [Mask.Flow]: Droplets,
  [Mask.Color]: Droplet,
  [Mask.Linear]: TriangleRight,
  [Mask.Luminance]: Sparkles,
  [Mask.QuickEraser]: Eraser,
  [Mask.Radial]: Circle,
};

export const MASK_PANEL_CREATION_TYPES: Array<MaskType> = [
  {
    disabled: false,
    icon: Sparkles,
    name: 'Subject',
    type: Mask.AiSubject,
  },
  {
    disabled: false,
    icon: Cloud,
    name: 'Sky',
    type: Mask.AiSky,
  },
  {
    disabled: false,
    icon: User,
    name: 'Person',
    type: Mask.AiPerson,
  },
  {
    disabled: false,
    icon: User,
    id: 'person-face',
    name: 'Face',
    personPart: 'face',
    type: Mask.AiPerson,
  },
  {
    disabled: false,
    icon: User,
    name: 'Foreground',
    type: Mask.AiForeground,
  },
  {
    disabled: false,
    icon: TriangleRight,
    name: 'Linear',
    type: Mask.Linear,
  },
  {
    disabled: false,
    icon: Circle,
    name: 'Radial',
    type: Mask.Radial,
  },
  {
    disabled: false,
    icon: MoreHorizontal,
    id: 'others',
    name: 'Others',
    type: Mask.All,
  },
];

export const AI_PANEL_CREATION_TYPES: Array<MaskType> = [
  {
    disabled: false,
    icon: Eraser,
    name: 'Quick Erase',
    type: Mask.QuickEraser,
  },
  {
    disabled: false,
    icon: Sparkles,
    name: 'Subject',
    type: Mask.AiSubject,
  },
  {
    disabled: false,
    icon: User,
    name: 'Person',
    type: Mask.AiPerson,
  },
  {
    disabled: false,
    icon: User,
    id: 'person-face',
    name: 'Face',
    personPart: 'face',
    type: Mask.AiPerson,
  },
  {
    disabled: false,
    icon: User,
    name: 'Foreground',
    type: Mask.AiForeground,
  },
  {
    disabled: false,
    icon: Brush,
    name: 'Brush',
    type: Mask.Brush,
  },
  {
    disabled: false,
    icon: TriangleRight,
    name: 'Linear',
    type: Mask.Linear,
  },
  {
    disabled: false,
    icon: Circle,
    name: 'Radial',
    type: Mask.Radial,
  },
];

export const SUB_MASK_COMPONENT_TYPES: Array<MaskType> = [
  {
    disabled: false,
    icon: Sparkles,
    name: 'Subject',
    type: Mask.AiSubject,
  },
  {
    disabled: false,
    icon: Cloud,
    name: 'Sky',
    type: Mask.AiSky,
  },
  {
    disabled: false,
    icon: User,
    name: 'Person',
    type: Mask.AiPerson,
  },
  {
    disabled: false,
    icon: User,
    id: 'person-face',
    name: 'Face',
    personPart: 'face',
    type: Mask.AiPerson,
  },
  {
    disabled: false,
    icon: User,
    name: 'Foreground',
    type: Mask.AiForeground,
  },
  {
    disabled: false,
    icon: TriangleRight,
    name: 'Linear',
    type: Mask.Linear,
  },
  {
    disabled: false,
    icon: Circle,
    name: 'Radial',
    type: Mask.Radial,
  },
  {
    disabled: false,
    icon: MoreHorizontal,
    id: 'others',
    name: 'Others',
    type: Mask.All,
  },
];

export const OTHERS_MASK_TYPES: Array<MaskType> = [
  {
    disabled: false,
    icon: BringToFront,
    name: 'Depth',
    type: Mask.AiDepth,
  },
  {
    disabled: false,
    icon: Droplet,
    name: 'Color',
    type: Mask.Color,
  },
  {
    disabled: false,
    icon: Sun,
    name: 'Luminance',
    type: Mask.Luminance,
  },
  {
    disabled: false,
    icon: Brush,
    name: 'Brush',
    type: Mask.Brush,
  },
  {
    disabled: false,
    icon: Droplets,
    name: 'Flow',
    type: Mask.Flow,
  },
  {
    disabled: false,
    icon: RectangleHorizontal,
    name: 'Whole Image',
    type: Mask.All,
  },
];

export const AI_SUB_MASK_COMPONENT_TYPES: Array<MaskType> = [
  {
    disabled: false,
    icon: Sparkles,
    name: 'Subject',
    type: Mask.AiSubject,
  },
  {
    disabled: false,
    icon: User,
    name: 'Person',
    type: Mask.AiPerson,
  },
  {
    disabled: false,
    icon: User,
    id: 'person-face',
    name: 'Face',
    personPart: 'face',
    type: Mask.AiPerson,
  },
  {
    disabled: false,
    icon: User,
    name: 'Foreground',
    type: Mask.AiForeground,
  },
  {
    disabled: false,
    icon: Brush,
    name: 'Brush',
    type: Mask.Brush,
  },
  {
    disabled: false,
    icon: TriangleRight,
    name: 'Linear',
    type: Mask.Linear,
  },
  {
    disabled: false,
    icon: Circle,
    name: 'Radial',
    type: Mask.Radial,
  },
];
