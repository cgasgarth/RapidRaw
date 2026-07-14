import { referenceFilmCharacteristicCurveV1 } from '../../../../packages/rawengine-schema/src/film/filmCharacteristicCurveSchemas';
import {
  filmMonochromeResponseV1Schema,
  normalizeFilmMonochromeFilter,
} from '../../../../packages/rawengine-schema/src/film/filmMonochromeSchemas';

const response = filmMonochromeResponseV1Schema.parse({
  model: 'rgb_tristimulus_monochrome_v1',
  sensitivityRgb: [0.65, 1, 0.45],
  calibrationIlluminant: 'D65',
  limitationStatement: 'Engineered RGB approximation; not spectral reconstruction.',
  defaultFilter: { id: 'none', gainsRgb: [1, 1, 1], filterFactorStops: 0 },
  characteristicCurve: referenceFilmCharacteristicCurveV1,
});
const normalized = normalizeFilmMonochromeFilter({ id: 'yellow', gainsRgb: [1, 0.8, 0.2], filterFactorStops: 0 });
if (Math.abs(Math.hypot(...normalized.gainsRgb) - 1) > 1e-6) throw new Error('Filter gains must be normalized.');
if (response.sensitivityRgb.some((value) => value < 0)) throw new Error('Sensitivity must be non-negative.');
console.log('film monochrome contract ok');
