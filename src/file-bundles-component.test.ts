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

import type { BundleDeclaration } from './bundle-declaration.ts';
import type { BundleIndexComponent } from './bundle-index-component.ts';

import {
  BundleMemberAnchoring,
  BundleMemberKind
} from './bundle-declaration.ts';
import { BundleIndex } from './bundle-index.ts';
import { FileBundlesComponent } from './file-bundles-component.ts';

describe('FileBundlesComponent', () => {
  let app: App;
  let commands: Command[];
  let index: BundleIndex;
  let showNoticeMock: PluginNoticeComponent['showNotice'];

  beforeEach(() => {
    vi.clearAllMocks();
    app = App.createConfigured__();
    commands = [];
    index = new BundleIndex();
    showNoticeMock = vi.fn<PluginNoticeComponent['showNotice']>();
  });

  function createComponent(): FileBundlesComponent {
    const component = new FileBundlesComponent({
      app: app.asOriginalType__(),
      bundleIndexComponent: strictProxy<BundleIndexComponent>({
        getIndex: () => index
      }),
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

  function declare(overrides: Partial<BundleDeclaration> & Pick<BundleDeclaration, 'declaringPath'>): void {
    index.setDeclaration({
      mainPath: overrides.declaringPath,
      members: [],
      ...overrides
    });
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

  it('should say so when there is no active file', () => {
    createComponent();

    commands[0]?.callback?.();
    expect(showNoticeMock).toHaveBeenCalledWith('File Bundles: no active file');
  });

  it('should say so when the active file belongs to no bundle', async () => {
    await activate('Alpha/alpha.jpg.md');
    createComponent();

    commands[0]?.callback?.();
    expect(showNoticeMock).toHaveBeenCalledWith('File Bundles: no bundle declared for Alpha/alpha.jpg.md');
  });

  it('should list what travels with a main file', async () => {
    await activate('Alpha/alpha.md');
    declare({
      declaringPath: 'Alpha/alpha.md',
      members: [{
        anchoring: BundleMemberAnchoring.Relative,
        isAnchorPrefixMissing: false,
        kind: BundleMemberKind.File,
        path: 'Alpha/assets/diagram.png'
      }]
    });
    createComponent();

    commands[0]?.callback?.();
    expect(showNoticeMock).toHaveBeenCalledWith('File Bundles: Alpha/alpha.md carries Alpha/assets/diagram.png');
  });

  it('should say a main file has no dependents rather than trailing off', async () => {
    await activate('Alpha/alpha.md');
    declare({ declaringPath: 'Alpha/alpha.md' });
    createComponent();

    commands[0]?.callback?.();
    expect(showNoticeMock).toHaveBeenCalledWith('File Bundles: Alpha/alpha.md carries a bundle with no dependents');
  });

  it('should name the main file a dependent travels with', async () => {
    await activate('Alpha/assets/diagram.png');
    declare({
      declaringPath: 'Alpha/alpha.md',
      members: [{
        anchoring: BundleMemberAnchoring.Relative,
        isAnchorPrefixMissing: false,
        kind: BundleMemberKind.File,
        path: 'Alpha/assets/diagram.png'
      }]
    });
    createComponent();

    commands[0]?.callback?.();
    expect(showNoticeMock).toHaveBeenCalledWith('File Bundles: Alpha/assets/diagram.png travels with Alpha/alpha.md');
  });

  it('should name every bundle a shared dependent travels with', async () => {
    await activate('Shared/logo.png');
    const member = {
      anchoring: BundleMemberAnchoring.Rooted,
      isAnchorPrefixMissing: false,
      kind: BundleMemberKind.File,
      path: 'Shared/logo.png'
    };
    declare({ declaringPath: 'Alpha/alpha.md', members: [member] });
    declare({ declaringPath: 'Beta/beta.md', members: [member] });
    createComponent();

    commands[0]?.callback?.();
    expect(showNoticeMock).toHaveBeenCalledWith(
      'File Bundles: Shared/logo.png travels with Alpha/alpha.md, Beta/beta.md'
    );
  });

  it('should not report anything until the command is invoked', () => {
    createComponent();
    expect(showNoticeMock).not.toHaveBeenCalled();
  });
});
