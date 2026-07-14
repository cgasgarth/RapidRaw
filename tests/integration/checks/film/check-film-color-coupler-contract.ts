import {
  evaluateFilmColorCouplerV1,
  filmColorCouplerV1Schema,
  referenceFilmColorCouplerV1,
} from '../../../../packages/rawengine-schema/src/index.ts';

const curve = filmColorCouplerV1Schema.parse(referenceFilmColorCouplerV1);
let previous = evaluateFilmColorCouplerV1(curve, [0.18, 0.18, 0.18], -12);
for (let index = 0; index <= 240; index += 1) {
  const exposure = -12 + index / 12;
  const neutral = evaluateFilmColorCouplerV1(curve, [0.18, 0.18, 0.18], exposure);
  if (Math.max(...neutral.map((value, _channel) => Math.abs(value - 0.18))) > 1e-6)
    throw new Error(`neutral-axis drift at ${exposure} EV`);
  const sample = evaluateFilmColorCouplerV1(curve, [0.08, 0.34, 1.2], exposure);
  if (!sample.every(Number.isFinite)) throw new Error(`non-finite coupler output at ${exposure} EV`);
  previous = sample;
}
if (Math.max(...previous.map((value, channel) => Math.abs(value - ([0.08, 0.34, 1.2][channel] ?? value)))) < 1e-5)
  throw new Error('reference coupler did not change a chromatic sample');

const malformed = structuredClone(referenceFilmColorCouplerV1);
malformed.hueWarp.knotAnglesDeg[1] = 61;
if (filmColorCouplerV1Schema.safeParse(malformed).success) throw new Error('non-uniform periodic knots accepted');

console.log('film color coupler contract ok');
