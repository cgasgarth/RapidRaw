import { invoke } from '@tauri-apps/api/core';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, CheckCircle2, GitPullRequest, Loader2, Search, Users } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Invokes } from '../../tauri/commands';
import { TextColors, TextVariants, TextWeights } from '../../types/typography';
import { type Adjustments, INITIAL_ADJUSTMENTS } from '../../utils/adjustments';
import type { ImageFile, SupportedTypes } from '../ui/AppProperties';
import Button from '../ui/primitives/Button';
import Dropdown from '../ui/primitives/Dropdown';
import Input from '../ui/primitives/Input';
import UiText from '../ui/primitives/Text';
import { createCommunityPreviewSession, revokeCommunityPreviewUrls } from './communityPreviewSession';

const DEFAULT_PREVIEW_IMAGE_URL = 'https://raw.githubusercontent.com/CyberTimon/RapidRAW-Presets/main/sample-image.jpg';

export interface CommunityPreset {
  name: string;
  creator: string;
  adjustments: Partial<Adjustments>;
  includeMasks?: boolean;
  includeCropTransform?: boolean;
  presetType?: 'tool' | 'style';
}

export const buildSaveCommunityPresetPayload = (preset: CommunityPreset) => ({
  name: preset.name,
  adjustments: preset.adjustments,
  includeMasks: preset.includeMasks,
  includeCropTransform: preset.includeCropTransform,
  presetType: preset.presetType || 'style',
});

const containerVariants = {
  hidden: { opacity: 1 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.06,
    },
  },
};

const itemVariants = {
  hidden: { y: 20, opacity: 0 },
  visible: {
    y: 0,
    opacity: 1,
  },
};

interface CommunityPageProps {
  onBackToLibrary: () => void;
  supportedTypes: SupportedTypes | null;
  imageList: ImageFile[];
  currentFolderPath: string | null;
}

interface CommunityPreviewSessionProps {
  children: (previews: Record<string, string | null>) => ReactNode;
  localPaths: string[];
  presets: CommunityPreset[];
  sessionId: string;
}

const useIdentityStableValue = <Value,>(identity: string, value: Value): Value => {
  const stable = useRef({ identity, value });
  if (stable.current.identity !== identity) stable.current = { identity, value };
  return stable.current.value;
};

export const CommunityPreviewSession = ({ children, localPaths, presets, sessionId }: CommunityPreviewSessionProps) => {
  const localPathIdentity = JSON.stringify(localPaths);
  const presetIdentity = JSON.stringify(presets);
  const stableLocalPaths = useIdentityStableValue(localPathIdentity, localPaths);
  const stablePresets = useIdentityStableValue(presetIdentity, presets);
  const [fallbackPath, setFallbackPath] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, string | null>>({});
  const ownedPreviews = useRef<Record<string, string | null>>({});
  const requestId = useRef(0);
  const imagePaths = useMemo(
    () => (stableLocalPaths.length > 0 ? stableLocalPaths : fallbackPath ? [fallbackPath] : []),
    [stableLocalPaths, fallbackPath],
  );
  const sourceIdentity = JSON.stringify(imagePaths);

  useEffect(() => {
    if (stableLocalPaths.length > 0) return;
    let isCurrent = true;
    const fetchFallback = async () => {
      try {
        const response = await fetch(DEFAULT_PREVIEW_IMAGE_URL);
        const blob = await response.blob();
        const path: string = await invoke(Invokes.SaveTempFile, {
          bytes: Array.from(new Uint8Array(await blob.arrayBuffer())),
        });
        if (isCurrent) setFallbackPath(path);
      } catch (error) {
        if (isCurrent) console.error('Failed to fetch default preview image:', error);
      }
    };
    void fetchFallback();
    return () => {
      isCurrent = false;
    };
  }, [stableLocalPaths]);

  useEffect(() => {
    if (stablePresets.length === 0 || imagePaths.length === 0) return;
    const activeRequest = ++requestId.current;
    let isCurrent = true;
    const generate = async () => {
      try {
        const previewDataMap: Record<string, number[]> = await invoke(Invokes.GenerateAllCommunityPreviews, {
          imagePaths,
          presets: stablePresets.map((preset) => ({
            ...preset,
            adjustments: { ...INITIAL_ADJUSTMENTS, ...preset.adjustments },
          })),
        });
        const generated: Record<string, string | null> = {};
        for (const [presetName, imageData] of Object.entries(previewDataMap)) {
          generated[presetName] = URL.createObjectURL(new Blob([new Uint8Array(imageData)], { type: 'image/jpeg' }));
        }
        if (!isCurrent || requestId.current !== activeRequest) {
          revokeCommunityPreviewUrls(generated);
          return;
        }
        const previous = ownedPreviews.current;
        ownedPreviews.current = generated;
        setPreviews(generated);
        revokeCommunityPreviewUrls(previous);
      } catch (error) {
        if (isCurrent) console.error('Failed to generate previews:', error);
      }
    };
    void generate();
    return () => {
      isCurrent = false;
    };
  }, [presetIdentity, stablePresets, sessionId, sourceIdentity, imagePaths]);

  useEffect(
    () => () => {
      requestId.current += 1;
      revokeCommunityPreviewUrls(ownedPreviews.current);
      ownedPreviews.current = {};
    },
    [],
  );

  return children(previews);
};

const CommunityPage = ({ onBackToLibrary, imageList, currentFolderPath }: CommunityPageProps) => {
  const { t } = useTranslation();
  const [presets, setPresets] = useState<CommunityPreset[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('name');
  const [downloadStatus, setDownloadStatus] = useState<Record<string, 'idle' | 'downloading' | 'success'>>({});

  const sortMethods = useMemo(() => [{ value: 'name', label: t('library.community.sortMethods.name') }], [t]);

  const previewSession = useMemo(
    () => createCommunityPreviewSession(currentFolderPath, imageList),
    [currentFolderPath, imageList],
  );

  useEffect(() => {
    const fetchPresets = async () => {
      setIsLoading(true);
      try {
        const communityPresets: CommunityPreset[] = await invoke(Invokes.FetchCommunityPresets);
        setPresets(communityPresets);
      } catch (error) {
        console.error('Failed to fetch community presets:', error);
      } finally {
        setIsLoading(false);
      }
    };

    void fetchPresets();
  }, []);

  const handleDownloadPreset = async (preset: CommunityPreset) => {
    setDownloadStatus((prev) => ({ ...prev, [preset.name]: 'downloading' }));
    try {
      await invoke(Invokes.SaveCommunityPreset, {
        ...buildSaveCommunityPresetPayload(preset),
      });
      setDownloadStatus((prev) => ({ ...prev, [preset.name]: 'success' }));
    } catch (error) {
      console.error(`Failed to download preset ${preset.name}:`, error);
      setDownloadStatus((prev) => ({ ...prev, [preset.name]: 'idle' }));
    }
  };

  const filteredAndSortedPresets = useMemo(() => {
    return presets
      .filter((p) => p.name.toLowerCase().includes(searchTerm.toLowerCase()))
      .sort((a, b) => {
        if (sortBy === 'name') {
          return a.name.localeCompare(b.name);
        }
        return 0;
      });
  }, [presets, searchTerm, sortBy]);

  const renderPreviewSession = (previews: Record<string, string | null>) => (
    <div className="flex-1 flex flex-col h-full min-w-0 bg-bg-secondary rounded-lg overflow-hidden p-4">
      <header className="shrink-0 flex items-center justify-between mb-4 flex-wrap gap-4">
        <div className="flex items-center">
          <Button
            className="mr-4 hover:bg-surface text-text-primary rounded-full"
            onClick={onBackToLibrary}
            size="icon"
            variant="ghost"
          >
            <ArrowLeft />
          </Button>
          <div>
            <UiText variant={TextVariants.headline} className="flex items-center gap-2">
              <Users /> {t('library.community.headerTitle')}
            </UiText>
            <UiText>{t('library.community.headerDesc')}</UiText>
          </div>
        </div>
      </header>

      <div className="flex justify-between items-center mb-4 flex-wrap gap-4">
        <div className="relative">
          <Input
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
            }}
            placeholder={t('library.community.searchPlaceholder')}
            className="pl-10 w-64"
          />
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-secondary" />
        </div>
        <div className="flex items-center gap-2 text-sm">
          <UiText variant={TextVariants.label}>{t('library.community.sortBy')}</UiText>
          <Dropdown
            options={sortMethods}
            value={sortBy}
            onChange={(value) => {
              setSortBy(value);
            }}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 -mr-2">
        {isLoading ? (
          <UiText
            variant={TextVariants.heading}
            color={TextColors.secondary}
            weight={TextWeights.normal}
            className="flex items-center justify-center h-full "
          >
            <Loader2 className="h-8 w-8 animate-spin mr-2" />
            {t('library.community.fetchingPresets')}
          </UiText>
        ) : (
          <motion.div
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
            variants={containerVariants}
            initial="hidden"
            animate="visible"
          >
            <AnimatePresence>
              {filteredAndSortedPresets.map((preset) => {
                const previewUrl = previews[preset.name];
                const status = downloadStatus[preset.name] || 'idle';

                return (
                  <motion.div
                    key={preset.name}
                    layout
                    variants={itemVariants}
                    exit={{ opacity: 0, scale: 0.9 }}
                    className="bg-surface rounded-lg overflow-hidden group border border-border-color flex flex-col"
                  >
                    <div className="relative w-full aspect-square bg-bg-primary flex items-center justify-center">
                      {previewUrl ? (
                        <img
                          src={previewUrl}
                          alt={preset.name}
                          className="w-full h-full object-cover transition-all duration-300 group-hover:blur-xs group-hover:brightness-75"
                        />
                      ) : (
                        <Loader2 className="h-8 w-8 animate-spin text-text-secondary" />
                      )}

                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            void handleDownloadPreset(preset);
                          }}
                          disabled={status !== 'idle'}
                          className="shadow-lg"
                        >
                          {status === 'idle' && <>{t('library.community.actionSave')}</>}
                          {status === 'downloading' && (
                            <>
                              <Loader2 size={14} className="mr-2 animate-spin" /> {t('library.community.actionSaving')}
                            </>
                          )}
                          {status === 'success' && (
                            <>
                              <CheckCircle2 size={14} className="mr-2" /> {t('library.community.actionSaved')}
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                    <div className="p-4 text-center">
                      <UiText variant={TextVariants.heading} className="truncate mb-1">
                        {preset.name}
                      </UiText>
                      <UiText variant={TextVariants.small} className="font-['cursive'] italic">
                        {t('library.community.presetBy', { creator: preset.creator })}
                      </UiText>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </motion.div>
        )}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="text-center mt-8 py-4"
        >
          <UiText>
            {t('library.community.footerHeading')}
            <br />
            <a
              href="https://github.com/CyberTimon/RapidRAW-Presets/issues/new?assignees=&labels=preset-submission&template=preset_submission.md&title=Preset+Submission%3A+%5BYour+Preset+Name%5D"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline inline-flex items-center gap-2"
            >
              <GitPullRequest aria-hidden="true" size={14} />
              {t('library.community.footerLinkText')}
            </a>
          </UiText>
        </motion.div>
      </div>
    </div>
  );

  return (
    <CommunityPreviewSession
      key={previewSession.id}
      localPaths={previewSession.localPaths}
      presets={presets}
      sessionId={previewSession.id}
    >
      {renderPreviewSession}
    </CommunityPreviewSession>
  );
};

export default CommunityPage;
