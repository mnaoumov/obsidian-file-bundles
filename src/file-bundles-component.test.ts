import type { Command } from 'obsidian';
import type { CommandRegistrar } from 'obsidian-dev-utils/obsidian/command-registrar';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';

import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { FileBundlesComponent } from './file-bundles-component.ts';

describe('FileBundlesComponent', () => {
  let app: App;
  let commands: Command[];
  let showNoticeMock: PluginNoticeComponent['showNotice'];

  beforeEach(() => {
    vi.clearAllMocks();
    app = App.createConfigured__();
    commands = [];
    showNoticeMock = vi.fn<PluginNoticeComponent['showNotice']>();
  });

  function createComponent(): FileBundlesComponent {
    const component = new FileBundlesComponent({
      app: app.asOriginalType__(),
      commandRegistrar: strictProxy<CommandRegistrar>({
        addCommand: (command: Command) => {
          commands.push(command);
        }
      }),
      pluginNoticeComponent: strictProxy<PluginNoticeComponent>({ showNotice: showNoticeMock })
    });
    component.load();
    return component;
  }

  async function activate(path: string): Promise<void> {
    // `createSync__` rather than `TFile.create__`: the latter builds a `TFile` without registering it
    // In the vault's index, so the workspace could not open it.
    app.vault.createSync__(path, '');
    const file = app.vault.getFileByPath(path);
    const leaf = app.workspace.getLeaf(true);
    if (file) {
      await leaf.openFile(file);
    }
    app.workspace.setActiveLeaf(leaf);
  }

  /*
   * Registering a rename/delete handler here would make Advanced Rename and Delete Handler refuse to load
   * beside this plugin, so the command surface staying this small is a correctness property, not tidiness.
   */
  it('should register exactly one command and patch nothing', () => {
    createComponent();
    expect(commands).toHaveLength(1);
    expect(commands[0]?.id).toBe('show-bundle');
    expect(commands[0]?.name).toBe('Show the bundle the active file belongs to');
  });

  it('should name the active file when invoked', async () => {
    await activate('Alpha/alpha.jpg.md');
    createComponent();

    commands[0]?.callback?.();
    expect(showNoticeMock).toHaveBeenCalledWith('File Bundles: no bundle declared for Alpha/alpha.jpg.md');
  });

  it('should say so when there is no active file', () => {
    createComponent();

    commands[0]?.callback?.();
    expect(showNoticeMock).toHaveBeenCalledWith('File Bundles: no active file');
  });

  it('should not report anything until the command is invoked', () => {
    createComponent();
    expect(showNoticeMock).not.toHaveBeenCalled();
  });
});
