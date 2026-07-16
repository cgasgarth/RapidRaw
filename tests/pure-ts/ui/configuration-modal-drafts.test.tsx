import { afterEach, expect, mock, test } from 'bun:test';
import { fireEvent, render as testingRender } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';

import ConfigurePresetModal, {
  ConfigurePresetDraft,
} from '../../../src/components/modals/library/ConfigurePresetModal';
import CopyPasteSettingsModal, {
  CopyPasteSettingsDraft,
} from '../../../src/components/modals/navigation/CopyPasteSettingsModal';
import type { Preset } from '../../../src/components/ui/AppProperties';
import { type CopyPasteSettings, PasteMode } from '../../../src/utils/adjustments';

let unmount: (() => Promise<void>) | null = null;

afterEach(async () => {
  await unmount?.();
  unmount = null;
});

test('preset draft starts from its keyed preset and saves once after accessible keyboard selection', async () => {
  const runtime = installRuntime();
  unmount = runtime.unmount;
  const close = mock(() => {});
  const save = mock(() => {});
  await runtime.render(
    createElement(ConfigurePresetDraft, {
      initialPreset: preset('a', 'Preset A', 'style'),
      onClose: close,
      onSave: save,
      show: true,
    }),
  );
  expect(runtime.input('configure-preset-name').value).toBe('Preset A');
  const selected = runtime.selectedRadio();
  expect(selected.textContent).toContain('modals.configurePreset.typeStyleLabel');
  await runtime.key(selected, 'End');
  expect(runtime.selectedRadio().textContent).toContain('modals.configurePreset.typeToolLabel');
  await runtime.click(runtime.button('modals.configurePreset.save'));
  expect(save).toHaveBeenCalledTimes(1);
  expect(save.mock.calls[0]).toEqual(['Preset A', false, false, 'tool']);
  expect(close).toHaveBeenCalledTimes(1);
});

test('cancelled preset and copy/paste edits are discarded by the next keyed draft', async () => {
  const runtime = installRuntime();
  unmount = runtime.unmount;
  const presetSave = mock(() => {});
  const close = mock(() => {});
  await runtime.render(
    createElement(ConfigurePresetDraft, {
      initialPreset: preset('a', 'Preset A', 'style'),
      key: 'a:1',
      onClose: close,
      onSave: presetSave,
      show: true,
    }),
  );
  await runtime.click(runtime.button('modals.configurePreset.cancel'));
  expect(presetSave).not.toHaveBeenCalled();
  await runtime.render(
    createElement(ConfigurePresetDraft, {
      initialPreset: preset('b', 'Preset B', 'tool'),
      key: 'b:2',
      onClose: close,
      onSave: presetSave,
      show: true,
    }),
  );
  expect(runtime.input('configure-preset-name').value).toBe('Preset B');
  expect(runtime.selectedRadio().textContent).toContain('modals.configurePreset.typeToolLabel');

  const settingsSave = mock(() => {});
  await runtime.render(
    createElement(CopyPasteSettingsDraft, {
      initialSettings: settings(PasteMode.Merge),
      key: 'copy:1',
      onClose: close,
      onSave: settingsSave,
      show: true,
    }),
  );
  await runtime.key(runtime.selectedRadio(), 'ArrowRight');
  expect(runtime.selectedRadio().textContent).toContain('modals.copyPaste.modeReplace');
  await runtime.click(runtime.button('modals.copyPaste.cancel'));
  expect(settingsSave).not.toHaveBeenCalled();
  await runtime.render(
    createElement(CopyPasteSettingsDraft, {
      initialSettings: settings(PasteMode.Merge),
      key: 'copy:2',
      onClose: close,
      onSave: settingsSave,
      show: true,
    }),
  );
  expect(runtime.selectedRadio().textContent).toContain('modals.copyPaste.modeMerge');
  await runtime.key(runtime.selectedRadio(), 'End');
  await runtime.click(runtime.button('modals.copyPaste.save'));
  expect(settingsSave).toHaveBeenCalledTimes(1);
  expect(settingsSave.mock.calls[0]?.[0]).toMatchObject({ mode: PasteMode.Replace });
  expect(settingsSave.mock.calls[0]?.[0].includedAdjustments).toEqual(['scene_global_color_tone']);
  expect(settingsSave.mock.calls[0]?.[0].knownAdjustments).not.toContain('layers');
});

test('same-source close and reopen replaces each shell draft before it becomes visible', async () => {
  const runtime = installRuntime();
  unmount = runtime.unmount;
  const close = mock(() => {});
  const presetSave = mock(() => {});
  await runtime.renderModal(
    createElement(ConfigurePresetModal, {
      initialPreset: preset('same', 'Persisted', 'style'),
      isOpen: true,
      onClose: close,
      onSave: presetSave,
    }),
  );
  await runtime.renderModal(
    createElement(ConfigurePresetModal, {
      initialPreset: preset('same', 'Persisted', 'style'),
      isOpen: false,
      onClose: close,
      onSave: presetSave,
    }),
    false,
  );
  await runtime.renderModal(
    createElement(ConfigurePresetModal, {
      initialPreset: preset('same', 'Current', 'style'),
      isOpen: true,
      onClose: close,
      onSave: presetSave,
    }),
  );
  expect(runtime.input('configure-preset-name').value).toBe('Current');

  const copySave = mock(() => {});
  await runtime.renderModal(
    createElement(CopyPasteSettingsModal, {
      isOpen: true,
      onClose: close,
      onSave: copySave,
      settings: settings(PasteMode.Replace),
    }),
  );
  expect(runtime.selectedRadio().textContent).toContain('modals.copyPaste.modeReplace');
});

function preset(id: string, name: string, presetType: 'style' | 'tool'): Preset {
  return { adjustments: {}, id, name, presetType };
}

function settings(mode: PasteMode): CopyPasteSettings {
  return { includedAdjustments: ['exposure'], knownAdjustments: ['exposure'], mode };
}

function installRuntime() {
  const rendered = testingRender(createElement('div'));
  const user = userEvent.setup();
  let mounted = true;
  return {
    button: (text: string) => {
      const button = [...rendered.container.querySelectorAll('button')].find((candidate) =>
        candidate.textContent?.includes(text),
      );
      if (!button) throw new Error(`Missing button ${text}`);
      return button;
    },
    click: (element: Element) => user.click(element),
    input: (id: string) => {
      const input = rendered.container.querySelector<HTMLInputElement>(`#${id}`);
      if (!input) throw new Error(`Missing input ${id}`);
      return input;
    },
    key: async (element: HTMLElement, key: string) => fireEvent.keyDown(element, { key }),
    render: async (element: ReturnType<typeof createElement>) => rendered.rerender(element),
    renderModal: async (element: ReturnType<typeof createElement>, settle = true) => {
      rendered.rerender(element);
      if (settle) await Promise.resolve();
    },
    selectedRadio: () => {
      const radio = rendered.container.querySelector<HTMLButtonElement>('[role="radio"][aria-checked="true"]');
      if (!radio) throw new Error('Missing selected radio');
      return radio;
    },
    unmount: async () => {
      if (!mounted) return;
      mounted = false;
      rendered.unmount();
    },
  };
}
