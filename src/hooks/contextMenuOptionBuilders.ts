import type { TFunction } from 'i18next';
import { Check, Palette, Star, Tag, X } from 'lucide-react';
import type { AppSettings, Option } from '../components/ui/AppProperties';
import TaggingSubMenu from '../context/TaggingSubMenu';
import { COLOR_LABELS, type Color } from '../utils/adjustments';

export interface CommonTag {
  isUser: boolean;
  tag: string;
}

type Translate = TFunction;

interface DestructiveConfirmAction {
  label: string;
  onClick: () => Promise<void> | void;
}

const colorLabelFallback = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

export function buildRatingMenu({ onRate, t }: { onRate: (rating: number) => void; t: Translate }): Option {
  return {
    icon: Star,
    label: t('contextMenus.editor.rating'),
    submenu: [0, 1, 2, 3, 4, 5].map((rating: number) => ({
      label: rating === 0 ? t('contextMenus.editor.noRating') : t('contextMenus.editor.ratingLabel', { count: rating }),
      onClick: () => {
        onRate(rating);
      },
    })),
  };
}

export function buildColorLabelMenu({
  onSetColorLabel,
  t,
}: {
  onSetColorLabel: (color: string | null) => Promise<void> | void;
  t: Translate;
}): Option {
  return {
    icon: Palette,
    label: t('contextMenus.editor.colorLabel'),
    submenu: [
      {
        label: t('contextMenus.editor.noLabel'),
        onClick: () => {
          void onSetColorLabel(null);
        },
      },
      ...COLOR_LABELS.map((label: Color) => ({
        color: label.color,
        label: t(`contextMenus.colors.${label.name}`, { defaultValue: colorLabelFallback(label.name) }),
        onClick: () => {
          void onSetColorLabel(label.name);
        },
      })),
    ],
  };
}

export function buildTaggingMenu({
  appSettings,
  commonTags,
  onTagsChanged,
  paths,
  t,
}: {
  appSettings: AppSettings | null;
  commonTags: CommonTag[];
  onTagsChanged: (changedPaths: string[], newTags: CommonTag[]) => void;
  paths: string[];
  t: Translate;
}): Option {
  return {
    icon: Tag,
    label: t('contextMenus.editor.tagging'),
    submenu: [
      {
        customComponent: TaggingSubMenu,
        customProps: {
          appSettings,
          initialTags: commonTags,
          onTagsChanged,
          paths,
        },
      },
    ],
  };
}

export function buildDestructiveConfirmSubmenu({
  actions,
  cancelLabel,
}: {
  actions: DestructiveConfirmAction[];
  cancelLabel: string;
}): Option[] {
  return [
    { label: cancelLabel, icon: X, onClick: () => {} },
    ...actions.map((action) => ({
      icon: Check,
      isDestructive: true,
      label: action.label,
      onClick: () => {
        void action.onClick();
      },
    })),
  ];
}
