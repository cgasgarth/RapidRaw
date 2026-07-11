import { readFile } from 'node:fs/promises';

const [apply, artifact, candidate, commands, registrations] = await Promise.all([
  readFile('src-tauri/src/merge/super_resolution/apply.rs', 'utf8'),
  readFile('src-tauri/src/merge/super_resolution/artifact.rs', 'utf8'),
  readFile('src-tauri/src/merge/super_resolution/candidate.rs', 'utf8'),
  readFile('src/tauri/commands.ts', 'utf8'),
  readFile('src-tauri/src/lib.rs', 'utf8'),
]);

for (const contract of [
  'AtomicDerivedOutputTransaction::begin',
  'validate_sources(accepted)?',
  'CONSUMED.json',
  'burst_super_resolution_x2',
  'already_super_resolved_x2',
  'payload.tiff.rrdata',
  'maps/measured/',
]) {
  if (!apply.includes(contract) && !artifact.includes(contract))
    throw new Error(`Missing durable apply contract: ${contract}`);
}
if (!candidate.includes('value["inventoryHash"] != stable_hash(&value["inventory"])'))
  throw new Error('Candidate inventory identity is not revalidated at Apply.');
if (!commands.includes("ApplyBurstSrCandidate = 'apply_burst_sr_candidate'")) throw new Error('UI invoke is missing.');
if (!registrations.includes('super_resolution::apply::apply_burst_sr_candidate'))
  throw new Error('Native Apply command is not registered.');

console.log('Burst SR atomic apply contract passed.');
