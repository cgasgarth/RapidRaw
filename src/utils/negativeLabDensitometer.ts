import {
  type NegativeBaseFogDensitometerReadout,
  type NegativeBaseFogEstimate,
  negativeBaseFogDensitometerReadoutSchema,
} from '../schemas/negative-lab/negativeLabPresetCatalogSchemas';

export const buildNegativeBaseFogDensitometerReadout = (
  estimate: NegativeBaseFogEstimate,
): NegativeBaseFogDensitometerReadout => {
  const [redDensity, greenDensity, blueDensity] = estimate.baseDensity;
  const channelDensities = [
    { channel: 'red', density: redDensity },
    { channel: 'green', density: greenDensity },
    { channel: 'blue', density: blueDensity },
  ] satisfies Array<{ channel: NegativeBaseFogDensitometerReadout['dominantChannel']; density: number }>;
  const densityValues = channelDensities.map(({ density }) => density);
  const densityRange = Math.max(...densityValues) - Math.min(...densityValues);
  const dominantChannel = channelDensities.reduce((maxChannel, channel) =>
    channel.density > maxChannel.density ? channel : maxChannel,
  ).channel;

  return negativeBaseFogDensitometerReadoutSchema.parse({
    densityRange,
    dominantChannel,
    status: densityRange <= 0.08 ? 'balanced' : densityRange <= 0.18 ? 'minor_cast' : 'strong_cast',
  });
};
