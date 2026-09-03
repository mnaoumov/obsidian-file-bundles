import type {
  App,
  Menu,
  TAbstractFile
} from 'obsidian';
import type { CommandRegistrar } from 'obsidian-dev-utils/obsidian/command-registrar';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { MenuEventRegistrar } from 'obsidian-dev-utils/obsidian/menu-event-registrar';

import { invokeAsyncSafely } from 'obsidian-dev-utils/async';
import { ComponentEx } from 'obsidian-dev-utils/obsidian/components/component-ex';
import { trashSafe } from 'obsidian-dev-utils/obsidian/vault';

import type { BundleDeclaration } from './bundle-declaration.ts';
import type { BundleIndexComponent } from './bundle-index-component.ts';
import type { PluginSettingsComponent } from './plugin-settings-component.ts';

/**
 * Parameters for the {@link FileBundlesComponent} constructor.
 */
export interface FileBundlesComponentConstructorParams {
  /**
   * The Obsidian application instance.
   */
  readonly app: App;

  /**
   * The index, which answers what belongs to what.
   */
  readonly bundleIndexComponent: BundleIndexComponent;

  /**
   * The command registrar.
   */
  readonly commandRegistrar: CommandRegistrar;

  /**
   * The menu registrar, for the File Explorer's context menu.
   */
  readonly menuEventRegistrar: MenuEventRegistrar;

  /**
   * The notice component.
   */
  readonly pluginNoticeComponent: PluginNoticeComponent;

  /**
   * The live plugin settings, which hold the unlocked bundles.
   */
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

/**
 * Owns the plugin's entry points: its commands and its File Explorer menu items.
 *
 * Commands and a menu are deliberately the whole interaction surface. This plugin never registers a
 * rename/delete handler of its own — Advanced Rename and Delete Handler is the single owner of that
 * behavior in a vault and refuses to load beside a plugin that competes with it. File Bundles moves only
 * the dependents a bundle declares, and leaves links and attachments to that plugin.
 */
export class FileBundlesComponent extends ComponentEx {
  private readonly app: App;
  private readonly bundleIndexComponent: BundleIndexComponent;
  private readonly commandRegistrar: CommandRegistrar;
  private readonly menuEventRegistrar: MenuEventRegistrar;
  private readonly pluginNoticeComponent: PluginNoticeComponent;
  private readonly pluginSettingsComponent: PluginSettingsComponent;

  /**
   * Creates the component.
   *
   * @param params - The parameters.
   */
  public constructor(params: FileBundlesComponentConstructorParams) {
    super();
    this.app = params.app;
    this.bundleIndexComponent = params.bundleIndexComponent;
    this.commandRegistrar = params.commandRegistrar;
    this.menuEventRegistrar = params.menuEventRegistrar;
    this.pluginNoticeComponent = params.pluginNoticeComponent;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
  }

  /**
   * Registers the commands and the menu items.
   */
  public override onload(): void {
    super.onload();

    this.commandRegistrar.addCommand({
      callback: this.showBundleOfActiveFile.bind(this),
      id: 'show-bundle',
      name: 'Show the bundle the active file belongs to'
    });

    this.commandRegistrar.addCommand({
      callback: () => {
        invokeAsyncSafely(() => this.toggleLockOfActiveFile());
      },
      id: 'toggle-lock',
      name: 'Lock or unlock the bundle the active file belongs to'
    });

    this.commandRegistrar.addCommand({
      callback: () => {
        invokeAsyncSafely(() => this.deleteBundleOfActiveFile());
      },
      id: 'delete-bundle',
      name: 'Delete the bundle the active file belongs to'
    });

    this.registerDisposable(this.menuEventRegistrar.registerFileMenuEventHandler((menu, abstractFile) => {
      this.addMenuItems(menu, abstractFile);
    }));
  }

  private addMenuItems(menu: Menu, abstractFile: TAbstractFile): void {
    const declaration = this.findBundleOf(abstractFile.path);
    if (!declaration) {
      return;
    }

    menu.addItem((item) => {
      item
        .setIcon(this.isUnlocked(declaration) ? 'lock' : 'unlock')
        .setTitle(this.isUnlocked(declaration) ? 'Lock bundle' : 'Unlock bundle')
        .onClick(() => {
          invokeAsyncSafely(() => this.toggleLock(declaration));
        });
    });

    menu.addItem((item) => {
      item
        .setIcon('trash')
        .setTitle('Delete bundle')
        .onClick(() => {
          invokeAsyncSafely(() => this.deleteBundle(declaration));
        });
    });
  }

  /**
   * Deletes the bundle by trashing its MAIN file and letting the ordinary deletion path carry the rest.
   *
   * Deliberately not a second implementation of the propagation: the vault's `delete` is what the
   * operations component already listens for, so a bundle deleted from this command and one deleted by any
   * other means take exactly the same route.
   */
  private async deleteBundle(declaration: BundleDeclaration): Promise<void> {
    await trashSafe(this.app, declaration.mainPath);
    this.pluginNoticeComponent.showNotice(`File Bundles: deleted the bundle of ${declaration.mainPath}`);
  }

  private async deleteBundleOfActiveFile(): Promise<void> {
    const declaration = this.findBundleOfActiveFile();
    if (!declaration) {
      return;
    }

    await this.deleteBundle(declaration);
  }

  private findBundleOf(path: string): BundleDeclaration | null {
    const index = this.bundleIndexComponent.getIndex();
    return index.getDeclarationsOfMain(path)[0] ?? index.getDeclarationsOfMember(path)[0] ?? null;
  }

  private findBundleOfActiveFile(): BundleDeclaration | null {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      this.pluginNoticeComponent.showNotice('File Bundles: no active file');
      return null;
    }

    const declaration = this.findBundleOf(activeFile.path);
    if (!declaration) {
      this.pluginNoticeComponent.showNotice(`File Bundles: no bundle declared for ${activeFile.path}`);
      return null;
    }

    return declaration;
  }

  private isUnlocked(declaration: BundleDeclaration): boolean {
    return this.pluginSettingsComponent.settings.unlockedBundleMainPaths.includes(declaration.mainPath);
  }

  private showBundleOfActiveFile(): void {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      this.pluginNoticeComponent.showNotice('File Bundles: no active file');
      return;
    }

    const index = this.bundleIndexComponent.getIndex();

    const ownDeclarations = index.getDeclarationsOfMain(activeFile.path);
    if (ownDeclarations.length > 0) {
      const memberPaths = [
        ...new Set(ownDeclarations.flatMap((declaration) => declaration.members.map((member) => member.path)))
      ];
      const description = memberPaths.length === 0 ? 'a bundle with no dependents' : memberPaths.join(', ');
      this.pluginNoticeComponent.showNotice(`File Bundles: ${activeFile.path} carries ${description}`);
      return;
    }

    const claimingDeclarations = index.getDeclarationsOfMember(activeFile.path);
    if (claimingDeclarations.length > 0) {
      const mainPaths = claimingDeclarations.map((declaration) => declaration.mainPath).join(', ');
      this.pluginNoticeComponent.showNotice(`File Bundles: ${activeFile.path} travels with ${mainPaths}`);
      return;
    }

    this.pluginNoticeComponent.showNotice(`File Bundles: no bundle declared for ${activeFile.path}`);
  }

  /**
   * Flips a bundle between locked and unlocked.
   *
   * The state is the plugin's own, never a change to the note: unlocking reveals the dependents and stops
   * operations propagating, and locking again restores both, with the declaration untouched throughout.
   */
  private async toggleLock(declaration: BundleDeclaration): Promise<void> {
    const wasUnlocked = this.isUnlocked(declaration);

    await this.pluginSettingsComponent.editAndSave((settings) => {
      settings.unlockedBundleMainPaths = wasUnlocked
        ? settings.unlockedBundleMainPaths.filter((path) => path !== declaration.mainPath)
        : [...settings.unlockedBundleMainPaths, declaration.mainPath];
    });

    this.pluginNoticeComponent.showNotice(
      `File Bundles: ${wasUnlocked ? 'locked' : 'unlocked'} the bundle of ${declaration.mainPath}`
    );
  }

  private async toggleLockOfActiveFile(): Promise<void> {
    const declaration = this.findBundleOfActiveFile();
    if (!declaration) {
      return;
    }

    await this.toggleLock(declaration);
  }
}
