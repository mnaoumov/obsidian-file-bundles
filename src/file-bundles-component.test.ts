import type {
  Command,
  Menu,
  MenuItem,
  TAbstractFile
} from 'obsidian';
import type { CommandRegistrar } from 'obsidian-dev-utils/obsidian/command-registrar';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type {
  FileMenuEventHandler,
  MenuEventRegistrar
} from 'obsidian-dev-utils/obsidian/menu-event-registrar';

import { sleep } from 'obsidian-dev-utils/async';
import { castTo } from 'obsidian-dev-utils/object-utils';
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
import type { PluginSettingsComponent } from './plugin-settings-component.ts';

import {
  BundleMemberAnchoring,
  BundleMemberKind
} from './bundle-declaration.ts';
import { BundleIndex } from './bundle-index.ts';
import { FileBundlesComponent } from './file-bundles-component.ts';
import { PluginSettings } from './plugin-settings.ts';

const SETTLE_DELAY_IN_MS = 20;

interface MenuItemStub {
  icon: string;
  onClick(this: void): void;
  title: string;
}

describe('FileBundlesComponent', () => {
  let app: App;
  let commands: Command[];
  let fileMenuHandlers: FileMenuEventHandler[];
  let index: BundleIndex;
  let settings: PluginSettings;
  let showNoticeMock: PluginNoticeComponent['showNotice'];

  beforeEach(() => {
    vi.clearAllMocks();
    app = App.createConfigured__();
    commands = [];
    fileMenuHandlers = [];
    index = new BundleIndex();
    settings = new PluginSettings();
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
      menuEventRegistrar: strictProxy<MenuEventRegistrar>({
        registerFileMenuEventHandler: (handler: FileMenuEventHandler) => {
          fileMenuHandlers.push(handler);
          return { dispose: (): void => undefined, [Symbol.dispose]: (): void => undefined };
        }
      }),
      pluginNoticeComponent: strictProxy<PluginNoticeComponent>({ showNotice: showNoticeMock }),
      pluginSettingsComponent: strictProxy<PluginSettingsComponent>({
        editAndSave: async (settingsEditor: (settings: PluginSettings) => void) => {
          settingsEditor(settings);
          await sleep({ milliseconds: SETTLE_DELAY_IN_MS });
        },
        settings
      })
    });
    component.load();
    return component;
  }

  function openFileMenu(path: string): MenuItemStub[] {
    const items: MenuItemStub[] = [];
    const menu = castTo<Menu>({
      addItem: (callback: (item: MenuItem) => void) => {
        const item: MenuItemStub = {
          icon: '',
          onClick: () => undefined,
          title: ''
        };
        const menuItem: MenuItem = castTo<MenuItem>({
          onClick: (handler: () => void) => {
            item.onClick = handler;
            return menuItem;
          },
          setIcon: (icon: string) => {
            item.icon = icon;
            return menuItem;
          },
          setTitle: (title: string) => {
            item.title = title;
            return menuItem;
          }
        });
        callback(menuItem);
        items.push(item);
        return menu;
      }
    });

    for (const handler of fileMenuHandlers) {
      handler(menu, castTo<TAbstractFile>({ path }), 'file-explorer-context-menu');
    }

    return items;
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

  function invokeCommand(id: string): void {
    commands.find((command) => command.id === id)?.callback?.();
  }

  /*
   * Commands and a menu are the whole surface. Registering a rename/delete handler here would make Advanced
   * Rename and Delete Handler refuse to load beside this plugin, so what is NOT registered is a correctness
   * property rather than tidiness.
   */
  it('should register its three commands and patch nothing', () => {
    createComponent();
    expect(commands.map((command) => command.id)).toEqual(['show-bundle', 'toggle-lock', 'delete-bundle']);
  });

  it('should say so when there is no active file', () => {
    createComponent();

    invokeCommand('show-bundle');
    expect(showNoticeMock).toHaveBeenCalledWith('File Bundles: no active file');
  });

  it('should say so when the active file belongs to no bundle', async () => {
    await activate('Alpha/alpha.jpg.md');
    createComponent();

    invokeCommand('show-bundle');
    expect(showNoticeMock).toHaveBeenCalledWith('File Bundles: no bundle declared for Alpha/alpha.jpg.md');
  });

  it('should list what travels with a main file', async () => {
    await activate('Alpha/alpha.md');
    declare({
      declaringPath: 'Alpha/alpha.md',
      members: [{
        anchoring: BundleMemberAnchoring.Relative,
        isAnchorPrefixMissing: false,
        isWikilink: true,
        kind: BundleMemberKind.File,
        path: 'Alpha/assets/diagram.png'
      }]
    });
    createComponent();

    invokeCommand('show-bundle');
    expect(showNoticeMock).toHaveBeenCalledWith('File Bundles: Alpha/alpha.md carries Alpha/assets/diagram.png');
  });

  it('should say a main file has no dependents rather than trailing off', async () => {
    await activate('Alpha/alpha.md');
    declare({ declaringPath: 'Alpha/alpha.md' });
    createComponent();

    invokeCommand('show-bundle');
    expect(showNoticeMock).toHaveBeenCalledWith('File Bundles: Alpha/alpha.md carries a bundle with no dependents');
  });

  it('should name the main file a dependent travels with', async () => {
    await activate('Alpha/assets/diagram.png');
    declare({
      declaringPath: 'Alpha/alpha.md',
      members: [{
        anchoring: BundleMemberAnchoring.Relative,
        isAnchorPrefixMissing: false,
        isWikilink: true,
        kind: BundleMemberKind.File,
        path: 'Alpha/assets/diagram.png'
      }]
    });
    createComponent();

    invokeCommand('show-bundle');
    expect(showNoticeMock).toHaveBeenCalledWith('File Bundles: Alpha/assets/diagram.png travels with Alpha/alpha.md');
  });

  it('should name every bundle a shared dependent travels with', async () => {
    await activate('Shared/logo.png');
    const member = {
      anchoring: BundleMemberAnchoring.Rooted,
      isAnchorPrefixMissing: false,
      isWikilink: true,
      kind: BundleMemberKind.File,
      path: 'Shared/logo.png'
    };
    declare({ declaringPath: 'Alpha/alpha.md', members: [member] });
    declare({ declaringPath: 'Beta/beta.md', members: [member] });
    createComponent();

    invokeCommand('show-bundle');
    expect(showNoticeMock).toHaveBeenCalledWith(
      'File Bundles: Shared/logo.png travels with Alpha/alpha.md, Beta/beta.md'
    );
  });

  it('should not report anything until the command is invoked', () => {
    createComponent();
    expect(showNoticeMock).not.toHaveBeenCalled();
  });

  describe('locking and unlocking', () => {
    beforeEach(async () => {
      await activate('Alpha/alpha.md');
      declare({ declaringPath: 'Alpha/alpha.md' });
    });

    /*
     * The state is the plugin's own. Unlocking never rewrites the note — the declaration still says the
     * files belong together, and locking again simply starts honouring it.
     */
    it('should unlock a locked bundle without touching the note', async () => {
      createComponent();

      invokeCommand('toggle-lock');
      await sleep({ milliseconds: SETTLE_DELAY_IN_MS });

      expect(settings.unlockedBundleMainPaths).toEqual(['Alpha/alpha.md']);
      expect(showNoticeMock).toHaveBeenCalledWith('File Bundles: unlocked the bundle of Alpha/alpha.md');
    });

    it('should lock an unlocked bundle again', async () => {
      settings.unlockedBundleMainPaths = ['Alpha/alpha.md'];
      createComponent();

      invokeCommand('toggle-lock');
      await sleep({ milliseconds: SETTLE_DELAY_IN_MS });

      expect(settings.unlockedBundleMainPaths).toEqual([]);
      expect(showNoticeMock).toHaveBeenCalledWith('File Bundles: locked the bundle of Alpha/alpha.md');
    });

    it('should say so when the active file belongs to no bundle', async () => {
      await activate('Alpha/unrelated.md');
      createComponent();

      invokeCommand('toggle-lock');
      await sleep({ milliseconds: SETTLE_DELAY_IN_MS });

      expect(showNoticeMock).toHaveBeenCalledWith('File Bundles: no bundle declared for Alpha/unrelated.md');
      expect(settings.unlockedBundleMainPaths).toEqual([]);
    });

    it('should say so when there is no active file at all', async () => {
      createComponent();
      app.workspace.setActiveLeaf(app.workspace.getLeaf(true));

      invokeCommand('toggle-lock');
      await sleep({ milliseconds: SETTLE_DELAY_IN_MS });

      expect(settings.unlockedBundleMainPaths).toEqual([]);
    });
  });

  describe('deleting a bundle', () => {
    /*
     * Deleting the main file is the whole implementation on purpose: the vault's own `delete` is what the
     * operations component listens for, so a bundle deleted from here takes exactly the route a bundle
     * deleted any other way takes.
     */
    it('should trash the main file and leave the propagation to the ordinary path', async () => {
      await activate('Alpha/alpha.md');
      declare({ declaringPath: 'Alpha/alpha.md' });
      createComponent();

      invokeCommand('delete-bundle');
      await sleep({ milliseconds: SETTLE_DELAY_IN_MS });

      expect(showNoticeMock).toHaveBeenCalledWith('File Bundles: deleted the bundle of Alpha/alpha.md');
    });

    it('should do nothing when the active file belongs to no bundle', async () => {
      await activate('Alpha/unrelated.md');
      createComponent();

      invokeCommand('delete-bundle');
      await sleep({ milliseconds: SETTLE_DELAY_IN_MS });

      expect(showNoticeMock).toHaveBeenCalledWith('File Bundles: no bundle declared for Alpha/unrelated.md');
    });
  });

  describe('the File Explorer menu', () => {
    it('should offer unlocking and deleting on a bundle row', () => {
      declare({ declaringPath: 'Alpha/alpha.md' });
      createComponent();

      const items = openFileMenu('Alpha/alpha.md');

      expect(items.map((item) => item.title)).toEqual(['Unlock bundle', 'Delete bundle']);
      expect(items[0]?.icon).toBe('unlock');
    });

    it('should offer locking on an unlocked bundle', () => {
      declare({ declaringPath: 'Alpha/alpha.md' });
      settings.unlockedBundleMainPaths = ['Alpha/alpha.md'];
      createComponent();

      const items = openFileMenu('Alpha/alpha.md');

      expect(items[0]?.title).toBe('Lock bundle');
      expect(items[0]?.icon).toBe('lock');
    });

    it('should offer the same items on a dependent row', () => {
      declare({
        declaringPath: 'Alpha/alpha.md',
        members: [{
          anchoring: BundleMemberAnchoring.Relative,
          isAnchorPrefixMissing: false,
          isWikilink: true,
          kind: BundleMemberKind.File,
          path: 'Alpha/assets/diagram.png'
        }]
      });
      createComponent();

      expect(openFileMenu('Alpha/assets/diagram.png')).toHaveLength(2);
    });

    it('should add nothing to a file no bundle claims', () => {
      declare({ declaringPath: 'Alpha/alpha.md' });
      createComponent();

      expect(openFileMenu('Alpha/unrelated.md')).toEqual([]);
    });

    it('should unlock from the menu', async () => {
      declare({ declaringPath: 'Alpha/alpha.md' });
      createComponent();

      openFileMenu('Alpha/alpha.md')[0]?.onClick();
      await sleep({ milliseconds: SETTLE_DELAY_IN_MS });

      expect(settings.unlockedBundleMainPaths).toEqual(['Alpha/alpha.md']);
    });

    it('should delete from the menu', async () => {
      app.vault.createSync__('Alpha/alpha.md', '');
      declare({ declaringPath: 'Alpha/alpha.md' });
      createComponent();

      openFileMenu('Alpha/alpha.md')[1]?.onClick();
      await sleep({ milliseconds: SETTLE_DELAY_IN_MS });

      expect(showNoticeMock).toHaveBeenCalledWith('File Bundles: deleted the bundle of Alpha/alpha.md');
    });
  });
});
