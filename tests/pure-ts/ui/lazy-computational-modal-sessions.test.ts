import { afterEach, describe, expect, test } from 'bun:test';

import {
  createDefaultFocusStackModalState,
  createDefaultHdrModalState,
  createDefaultPanoramaModalState,
  createDefaultSuperResolutionModalState,
  type LazyComputationalModalId,
  useUIStore,
} from '../../../src/store/useUIStore';

const resetModalSessions = () => {
  useUIStore.setState({
    focusStackModalState: createDefaultFocusStackModalState(),
    hdrModalState: createDefaultHdrModalState(),
    mountedLazyModalIds: new Set(),
    negativeModalState: { isOpen: false, operationEpoch: 0, session: null, targetPaths: [] },
    panoramaModalState: createDefaultPanoramaModalState(),
    superResolutionModalState: createDefaultSuperResolutionModalState(),
  });
};

afterEach(resetModalSessions);

describe('lazy computational modal sessions', () => {
  test('starts without claiming or importing any computational modal slot', () => {
    resetModalSessions();
    expect([...useUIStore.getState().mountedLazyModalIds]).toEqual([]);
  });

  test.each([
    ['panorama', 'panoramaModalState', createDefaultPanoramaModalState],
    ['hdr', 'hdrModalState', createDefaultHdrModalState],
    ['superResolution', 'superResolutionModalState', createDefaultSuperResolutionModalState],
    ['focusStack', 'focusStackModalState', createDefaultFocusStackModalState],
  ] as const)('claims %s mounting in the same open transition and retains it through close/reopen', (id, key, createState) => {
    resetModalSessions();

    useUIStore.getState().setUI({ [key]: { ...createState(), isOpen: true } });
    expect(useUIStore.getState()[key].isOpen).toBe(true);
    expect(useUIStore.getState().mountedLazyModalIds.has(id)).toBe(true);

    const claimedSet = useUIStore.getState().mountedLazyModalIds;
    useUIStore.getState().setUI({ [key]: createState() });
    expect(useUIStore.getState()[key].isOpen).toBe(false);
    expect(useUIStore.getState().mountedLazyModalIds).toBe(claimedSet);

    useUIStore.getState().setUI({ [key]: { ...createState(), isOpen: true } });
    expect(useUIStore.getState()[key].isOpen).toBe(true);
    expect(useUIStore.getState().mountedLazyModalIds).toBe(claimedSet);
  });

  test('keeps rapid open/close/open ownership isolated by modal id', () => {
    resetModalSessions();
    const open = (id: LazyComputationalModalId) => {
      if (id === 'panorama')
        useUIStore.getState().setUI({ panoramaModalState: { ...createDefaultPanoramaModalState(), isOpen: true } });
      if (id === 'hdr')
        useUIStore.getState().setUI({ hdrModalState: { ...createDefaultHdrModalState(), isOpen: true } });
    };

    open('panorama');
    useUIStore.getState().setUI({ panoramaModalState: createDefaultPanoramaModalState() });
    open('hdr');
    open('panorama');

    expect([...useUIStore.getState().mountedLazyModalIds].sort()).toEqual(['hdr', 'panorama']);
    expect(useUIStore.getState().panoramaModalState.isOpen).toBe(true);
    expect(useUIStore.getState().hdrModalState.isOpen).toBe(true);
  });

  test('retains the Negative Lab shell slot while its keyed operation disposes after close', () => {
    resetModalSessions();
    useUIStore.getState().setUI({
      negativeModalState: {
        isOpen: true,
        operationEpoch: 1,
        session: null,
        targetPaths: ['/fixture/negative.raw'],
      },
    });

    expect(useUIStore.getState().mountedLazyModalIds.has('negativeLab')).toBe(true);
    const claimedSet = useUIStore.getState().mountedLazyModalIds;
    useUIStore.getState().setUI((state) => ({
      negativeModalState: { ...state.negativeModalState, isOpen: false },
    }));
    expect(useUIStore.getState().mountedLazyModalIds).toBe(claimedSet);
  });

  test('supports functional open commands without a follow-up store update', () => {
    resetModalSessions();
    let notifications = 0;
    const unsubscribe = useUIStore.subscribe(() => {
      notifications += 1;
    });

    useUIStore.getState().setUI((state) => ({
      focusStackModalState: { ...state.focusStackModalState, isOpen: true, sourcePaths: ['/fixture/a.raw'] },
    }));
    unsubscribe();

    expect(notifications).toBe(1);
    expect(useUIStore.getState().focusStackModalState.sourcePaths).toEqual(['/fixture/a.raw']);
    expect(useUIStore.getState().mountedLazyModalIds.has('focusStack')).toBe(true);
  });
});
