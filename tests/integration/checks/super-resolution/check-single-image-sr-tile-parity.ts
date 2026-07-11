#!/usr/bin/env bun

const reflect = (value: number, length: number): number => {
  if (length <= 1) return 0;
  const period = (length - 1) * 2;
  const folded = ((value % period) + period) % period;
  return Math.min(folded, period - folded);
};
for (const length of [1, 3, 8, 257]) {
  for (let value = -128; value < length + 128; value += 1) {
    const resolved = reflect(value, length);
    if (resolved < 0 || resolved >= length) throw new Error(`Reflect index escaped ${length}: ${resolved}`);
  }
}
console.log('single-image SR tile boundary fixture ok; native parity runs in Rust');
