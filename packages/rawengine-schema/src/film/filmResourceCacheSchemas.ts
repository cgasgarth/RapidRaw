import { z } from 'zod';

export const compiledFilmProfileV1Schema = z
  .object({
    profileId: z.string().min(1),
    profileVersion: z.string().min(1),
    manifestContentSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    decodedAssetSha256: z.record(z.string(), z.string().regex(/^sha256:[a-f0-9]{64}$/u)),
    modelAbiVersion: z.string().min(1),
    compilerVersion: z.string().min(1),
    numericPolicyVersion: z.string().min(1),
    workingSpace: z.literal('acescg_linear_v1'),
    compiledContentSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  })
  .strict();

export type CompiledFilmProfileV1 = z.infer<typeof compiledFilmProfileV1Schema>;

export function compiledFilmProfileKeyV1(
  input: Pick<
    CompiledFilmProfileV1,
    'manifestContentSha256' | 'decodedAssetSha256' | 'modelAbiVersion' | 'compilerVersion' | 'numericPolicyVersion'
  >,
): string {
  const canonical = JSON.stringify({
    manifestContentSha256: input.manifestContentSha256,
    decodedAssetSha256: Object.fromEntries(
      Object.entries(input.decodedAssetSha256).sort(([left], [right]) => left.localeCompare(right)),
    ),
    modelAbiVersion: input.modelAbiVersion,
    compilerVersion: input.compilerVersion,
    numericPolicyVersion: input.numericPolicyVersion,
  });
  return `sha256:${stableDigest(canonical)}`;
}

export function gpuFilmResourceKeyV1(
  compiledKey: string,
  adapterIdentity: string,
  shaderAbiSha256: string,
  textureFormat: string,
  bufferFormat: string,
): string {
  return `sha256:${stableDigest(JSON.stringify([compiledKey, adapterIdentity, shaderAbiSha256, textureFormat, bufferFormat]))}`;
}

function stableDigest(value: string): string {
  const lanes = new Uint32Array([
    0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35, 0x27d4eb2d, 0x165667b1, 0xd3a2646c, 0xfd7046c5,
  ]);
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    for (let lane = 0; lane < lanes.length; lane += 1) {
      lanes[lane] = Math.imul(lanes[lane]! ^ (code + lane), 0x01000193) >>> 0;
      lanes[lane] = lanes[lane]! ^ (lanes[lane]! >>> 13);
    }
  }
  return Array.from(lanes, (lane) => lane.toString(16).padStart(8, '0')).join('');
}
