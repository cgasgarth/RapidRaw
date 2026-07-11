import { readFileSync } from 'node:fs';

const reconstruction = readFileSync('src-tauri/src/merge/super_resolution/reconstruction.rs', 'utf8');
const runtime = readFileSync('src-tauri/src/merge/super_resolution/runtime.rs', 'utf8');
const schema = readFileSync('src/schemas/computational-merge/superResolutionNativeRegistrationSchemas.ts', 'utf8');
const modal = readFileSync('src/components/modals/computational-merge/SuperResolutionModal.tsx', 'utf8');

const requiredEvidence = [
  [reconstruction, 'for _pass in 0..2'],
  [reconstruction, 'observation.class != class'],
  [reconstruction, 'KERNEL_SIGMA_MIN'],
  [runtime, 'native_burst_cfa_preview'],
  [runtime, 'quality_gate_pending'],
  [schema, 'registrationPlanHash !== plan.acceptedDryRunPlanHash'],
  [modal, 'sr-native-cfa-reconstruction'],
  [modal, 'plane.support.dataUrl'],
] as const;

for (const [source, evidence] of requiredEvidence) {
  if (!source.includes(evidence)) throw new Error(`Missing native CFA reconstruction evidence: ${evidence}`);
}

console.log('super-resolution native CFA reconstruction contract: ok');
