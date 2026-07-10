import { open } from '@tauri-apps/plugin-dialog';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { TextVariants } from '../../../../types/typography';
import UiText from '../../../ui/primitives/Text';

interface ImagePickerProps {
  imageName: string | null;
  onImageSelect: (path: string) => void;
  onClear: () => void;
  label: string;
}

export default function ImagePicker({ imageName, onImageSelect, onClear, label }: ImagePickerProps) {
  const { t } = useTranslation();

  const handleSelectFile = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [
          {
            name: t('ui.imagePicker.filterLabel'),
            extensions: ['png'],
          },
        ],
      });
      if (typeof selected === 'string') {
        onImageSelect(selected);
      }
    } catch (err) {
      console.error('Failed to open image file dialog:', err);
    }
  };

  return (
    <div className="mb-2">
      <div className="mb-1 flex min-w-0 items-center justify-between gap-2">
        <UiText variant={TextVariants.label} className="shrink-0 select-none">
          {label}
        </UiText>
        <div className="group flex min-w-0 items-center">
          <button
            onClick={() => {
              void handleSelectFile();
            }}
            aria-label={imageName || t('ui.imagePicker.selectImageFile')}
            className="max-w-[10rem] truncate text-right text-sm text-text-primary transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:max-w-[14rem]"
            data-tooltip={imageName || t('ui.imagePicker.selectImageFile')}
            type="button"
          >
            {imageName || t('ui.imagePicker.select')}
          </button>

          {imageName && (
            <button
              onClick={onClear}
              aria-label={t('ui.imagePicker.clearImage')}
              className="ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-bg-tertiary opacity-0 transition-opacity hover:bg-surface group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              data-tooltip={t('ui.imagePicker.clearImage')}
              type="button"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
