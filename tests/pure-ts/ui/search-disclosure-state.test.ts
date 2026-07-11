import { describe, expect, test } from 'bun:test';
import {
  deriveEffectiveDisclosureState,
  deriveEffectiveFolderTreeSections,
} from '../../../src/utils/searchDisclosureState.ts';

describe('folder search disclosure', () => {
  test('overlays every matching top-level ancestor without changing the persisted preference', () => {
    const persisted = ['current'] as const;
    const effective = deriveEffectiveFolderTreeSections(persisted, true, {
      albums: true,
      current: false,
      pinned: true,
    });

    expect([...effective]).toEqual(['current', 'pinned', 'albums']);
    expect(persisted).toEqual(['current']);
  });

  test('clearing search restores exactly the latest explicit preference', () => {
    const beforeSearch = ['albums'];
    expect([
      ...deriveEffectiveFolderTreeSections(beforeSearch, true, { albums: true, current: true, pinned: true }),
    ]).toEqual(['albums', 'pinned', 'current']);

    const toggledDuringSearch = ['albums', 'current'];
    expect([
      ...deriveEffectiveFolderTreeSections(toggledDuringSearch, false, { albums: true, current: true, pinned: true }),
    ]).toEqual(toggledDuringSearch);
  });
});

describe('Develop search disclosure', () => {
  type Section = 'basic' | 'curves' | 'details' | 'effects';
  const persisted: Record<Section, boolean> = {
    basic: true,
    curves: false,
    details: false,
    effects: true,
  };

  test('opens one or several matches only in derived presentation state', () => {
    const effective = deriveEffectiveDisclosureState(persisted, true, new Set<Section>(['curves', 'details']));

    expect(effective).toEqual({ basic: true, curves: true, details: true, effects: true });
    expect(persisted).toEqual({ basic: true, curves: false, details: false, effects: true });
  });

  test('clearing search restores canonical user and Focus Mode state', () => {
    const focusModeState: Record<Section, boolean> = {
      basic: false,
      curves: false,
      details: true,
      effects: false,
    };

    expect(deriveEffectiveDisclosureState(focusModeState, true, new Set<Section>(['basic', 'curves']))).toEqual({
      basic: true,
      curves: true,
      details: true,
      effects: false,
    });
    expect(deriveEffectiveDisclosureState(focusModeState, false, new Set<Section>(['basic', 'curves']))).toEqual(
      focusModeState,
    );
  });

  test('equivalent reallocated match sets produce the same result without callbacks or writes', () => {
    const first = deriveEffectiveDisclosureState(persisted, true, new Set<Section>(['details']));
    const second = deriveEffectiveDisclosureState(persisted, true, new Set<Section>(['details']));
    expect(second).toEqual(first);
  });
});
