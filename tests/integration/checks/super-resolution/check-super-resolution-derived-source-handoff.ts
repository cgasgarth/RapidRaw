import { readFile } from 'node:fs/promises';

const [modal, owner, schema] = await Promise.all([
  readFile('src/components/modals/computational-merge/SuperResolutionModal.tsx', 'utf8'),
  readFile('src/components/modals/AppModals.tsx', 'utf8'),
  readFile('src/schemas/computational-merge/burstSrApplySchemas.ts', 'utf8'),
]);

if (modal.includes('/tmp/rawengine-super-resolution')) throw new Error('Burst UI fabricates a temporary output path.');
for (const token of ['sr-prepare-candidate-button', 'sr-apply-candidate-button', 'sr-open-output-button']) {
  if (!modal.includes(token)) throw new Error(`Missing UI state: ${token}`);
}
if (!owner.includes('Invokes.ApplyBurstSrCandidate') || !owner.includes('acceptedReviewHash: candidate.candidateHash'))
  throw new Error('Modal owner does not apply the native accepted candidate identity.');
if (!schema.includes("commitStatus: z.enum(['committed', 'unregistered'])"))
  throw new Error('Recoverable registration status is not represented.');

console.log('Burst SR derived-source handoff contract passed.');
