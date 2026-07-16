import { strict as assert } from 'node:assert';
import { getRightPanelEntry } from '../../../../src/components/panel/right/rightPanelRegistry.ts';
import { Panel } from '../../../../src/components/ui/AppProperties.tsx';
import { REFERENCE_FILM_PROFILE_MANIFEST } from '../../../../src/utils/film-look/filmProfileRegistry.ts';

const filmPanel = getRightPanelEntry(Panel.Film);
assert.equal(filmPanel.fallbackLabel, 'Film');
assert.equal(filmPanel.host.compact, 'workspace');
assert.equal(filmPanel.host.scroll.mode, 'workspace');
assert(filmPanel.keywords.includes('emulation'));
assert.equal(REFERENCE_FILM_PROFILE_MANIFEST.profile.lifecycle, 'active');
assert.equal(REFERENCE_FILM_PROFILE_MANIFEST.model.nodeType, 'film_emulation');
assert.equal(
  REFERENCE_FILM_PROFILE_MANIFEST.model.profileRef.contentSha256,
  REFERENCE_FILM_PROFILE_MANIFEST.profile.contentSha256,
);

console.log('film workspace states and current profile contract ok');
