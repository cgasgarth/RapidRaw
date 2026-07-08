import {
  type NegativeBaseFogDensitometerReadout,
  type NegativeBaseFogEstimate,
  negativeBaseFogDensitometerReadoutSchema,
} from '../../schemas/negative-lab/negativeLabPresetCatalogSchemas';

export const buildNegativeBaseFogDensitometerReadout = (
  estimate: NegativeBaseFogEstimate,
): NegativeBaseFogDensitometerReadout => {
  const [redDensity, greenDensity, blueDensity] = estimate.baseDensity;
  const lumaDensity = 0.2126 * redDensity + 0.7152 * greenDensity + 0.0722 * blueDensity;
  const colorDensity = (redDensity + greenDensity) / 2 - blueDensity;
  const channelDensities = [
    { channel: 'red', density: redDensity },
    { channel: 'green', density: greenDensity },
    { channel: 'blue', density: blueDensity },
  ] satisfies Array<{ channel: NegativeBaseFogDensitometerReadout['dominantChannel']; density: number }>;
  const densityValues = channelDensities.map(({ density }) => density);
  const densityRange = Math.max(...densityValues) - Math.min(...densityValues);
  const effectiveRange = Math.max(densityRange, Math.abs(colorDensity));
  const dominantChannel = channelDensities.reduce((maxChannel, channel) =>
    channel.density > maxChannel.density ? channel : maxChannel,
  ).channel;

  return negativeBaseFogDensitometerReadoutSchema.parse({
    densityRange,
    colorDensity,
    dominantChannel,
    lumaDensity,
    status: effectiveRange <= 0.08 ? 'balanced' : effectiveRange <= 0.18 ? 'minor_cast' : 'strong_cast',
  });
};
