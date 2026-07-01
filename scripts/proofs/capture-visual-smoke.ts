import { runVisualSmokeCapture } from '../lib/proofs/visual-smoke/capture-runner.ts';
import {
  getSelectedVisualSmokeScenarios,
  printScenarioList,
  printUsage,
  readRequestedScenario,
} from '../lib/proofs/visual-smoke/scenarios.ts';

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  printUsage();
  process.exit(0);
}

if (process.argv.includes('--list-scenarios')) {
  printScenarioList();
  process.exit(0);
}

const requestedScenario = readRequestedScenario(process.argv);
const selectedScenarios = getSelectedVisualSmokeScenarios(requestedScenario);

await runVisualSmokeCapture({ requestedScenario, selectedScenarios });
