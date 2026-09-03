import type { App } from 'obsidian';
import type { CommandRegistrar } from 'obsidian-dev-utils/obsidian/command-registrar';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';

import { ComponentEx } from 'obsidian-dev-utils/obsidian/components/component-ex';

import type { BundleIndexComponent } from './bundle-index-component.ts';

interface FileBundlesComponentConstructorParams {
  readonly app: App;
  readonly bundleIndexComponent: BundleIndexComponent;
  readonly commandRegistrar: CommandRegistrar;
  readonly pluginNoticeComponent: PluginNoticeComponent;
}

/**
 * Owns the plugin's entry points.
 *
 * The commands are deliberately the whole interaction surface. This plugin never registers a rename/delete
 * handler of its own — Advanced Rename and Delete Handler is the single owner of that behavior in a vault,
 * and refuses to load beside a plugin that competes with it. File Bundles moves only the dependents a
 * bundle declares, and leaves links and attachments to that plugin.
 */
export class FileBundlesComponent extends ComponentEx {
  private readonly app: App;
  private readonly bundleIndexComponent: BundleIndexComponent;
  private readonly commandRegistrar: CommandRegistrar;
  private readonly pluginNoticeComponent: PluginNoticeComponent;

  public constructor(params: FileBundlesComponentConstructorParams) {
    super();
    this.app = params.app;
    this.bundleIndexComponent = params.bundleIndexComponent;
    this.commandRegistrar = params.commandRegistrar;
    this.pluginNoticeComponent = params.pluginNoticeComponent;
  }

  public override onload(): void {
    super.onload();

    this.commandRegistrar.addCommand({
      callback: this.showBundleOfActiveFile.bind(this),
      id: 'show-bundle',
      name: 'Show the bundle the active file belongs to'
    });
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
}
