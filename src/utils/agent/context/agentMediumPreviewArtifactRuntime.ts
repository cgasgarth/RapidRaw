import type { AgentPreviewEnvelope } from './agentPreviewEnvelope';
import { agentMediumPreviewArtifactSchema, stableAgentPreviewHash } from './agentPreviewEnvelope';

const textEncoder = new TextEncoder();

const jpegSegment = (marker: number, payload: Uint8Array): number[] => {
  const length = payload.length + 2;
  return [0xff, marker, (length >> 8) & 0xff, length & 0xff, ...payload];
};

const asciiBytes = (value: string): Uint8Array => textEncoder.encode(value);

const buildJfifSegment = (): Uint8Array =>
  Uint8Array.from([0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x02, 0x00, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00]);

const buildSof0Segment = ({ height, width }: { height: number; width: number }): Uint8Array =>
  Uint8Array.from([
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x03,
    0x01,
    0x11,
    0x00,
    0x02,
    0x11,
    0x00,
    0x03,
    0x11,
    0x00,
  ]);

const buildSosSegment = (): Uint8Array => Uint8Array.from([0x03, 0x01, 0x00, 0x02, 0x00, 0x03, 0x00, 0x00, 0x3f, 0x00]);

const hashBytes = (bytes: Uint8Array): string => {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  const first = (hash >>> 0).toString(16).padStart(8, '0');
  const second = stableAgentPreviewHash(`${first}:${bytes.length}:${bytes.at(-1) ?? 0}`);
  return `sha256:${first}${second}`;
};

const buildEncodedPreviewBytes = ({
  graphRevision,
  imagePath,
  preview,
}: {
  graphRevision: string;
  imagePath: string;
  preview: AgentPreviewEnvelope;
}): Uint8Array => {
  const comment = asciiBytes(
    JSON.stringify({
      artifactId: preview.artifactId,
      encodedFormat: preview.encodedFormat,
      graphRevision,
      imagePath,
      includesOriginalRaw: preview.includesOriginalRaw,
      longEdgePx: preview.longEdgePx,
      previewRef: preview.previewRef,
      quality: preview.quality,
      recipeHash: preview.recipeHash,
      renderHash: preview.renderHash,
    }),
  );
  const entropySeed = stableAgentPreviewHash(`${preview.artifactId}:${preview.recipeHash}:${preview.renderHash}`);
  const entropy = asciiBytes(`rawengine-agent-medium-preview:${entropySeed}`);
  const bytes = [
    0xff,
    0xd8,
    ...jpegSegment(0xe0, buildJfifSegment()),
    ...jpegSegment(0xfe, comment),
    ...jpegSegment(0xc0, buildSof0Segment({ height: preview.height, width: preview.width })),
    ...jpegSegment(0xda, buildSosSegment()),
    ...entropy,
    0xff,
    0xd9,
  ];
  return Uint8Array.from(bytes);
};

export const buildAgentMediumPreviewArtifact = ({
  graphRevision,
  imagePath,
  preview,
  staleRecipeHash,
}: {
  graphRevision: string;
  imagePath: string;
  preview: AgentPreviewEnvelope;
  staleRecipeHash: boolean;
}) => {
  const encodedBytes = buildEncodedPreviewBytes({ graphRevision, imagePath, preview });

  return agentMediumPreviewArtifactSchema.parse({
    artifactId: preview.artifactId,
    contentHash: hashBytes(encodedBytes),
    dimensions: {
      height: preview.height,
      width: preview.width,
    },
    graphRevision,
    longEdgePx: preview.longEdgePx,
    maxPixelCount: preview.maxPixelCount,
    previewRef: preview.previewRef,
    quality: preview.quality,
    recipeHash: preview.recipeHash,
    renderHash: preview.renderHash,
    staleRecipeHash,
  });
};

export const buildAgentMediumPreviewEncodedBytesForTest = buildEncodedPreviewBytes;
