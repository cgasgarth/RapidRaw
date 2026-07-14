import { strict as assert } from 'node:assert';
import { getRightPanelEntry } from '../../../../src/components/panel/right/rightPanelRegistry.ts';
import { Panel } from '../../../../src/components/ui/AppProperties.tsx';
import { buildFilmLookAppliedAdjustmentPatch } from '../../../../src/utils/film-look/filmLookBrowser.ts';
import { getFilmLookBrowserGroups } from '../../../../src/utils/film-look/filmLookRegistry.ts';

const filmPanel = getRightPanelEntry(Panel.Film);
assert.equal(filmPanel.fallbackLabel, 'Film');
assert.equal(filmPanel.host.compact, 'workspace');
assert.equal(filmPanel.host.scroll.mode, 'workspace');
assert(filmPanel.keywords.includes('emulation'));

const looks = getFilmLookBrowserGroups().flatMap((group) => group.looks);
assert(looks.length >= 5, 'workspace must consume the governed registry');
const measured = looks.find((look) => look.id === 'film_look.measured.monochrome_d65.v1');
assert(measured, 'measured profile must be discoverable through the shared registry');
assert.equal(measured.provenance.claimLevel, 'generic_engineered');
assert.equal(buildFilmLookAppliedAdjustmentPatch(measured, 0).saturation, 0);
assert.equal(buildFilmLookAppliedAdjustmentPatch(measured, 100).saturation, -100);

console.log('film workspace states and registry contract ok');
