import type { App } from 'obsidian';
import type { CommandRegistrar } from 'obsidian-dev-utils/obsidian/command-registrar';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';

import { ComponentEx } from 'obsidian-dev-utils/obsidian/components/component-ex';

interface FileBundlesComponentConstructorParams {
  readonly app: App;
  readonly commandRegistrar: CommandRegistrar;
  readonly pluginNoticeComponent: PluginNoticeComponent;
}

/**
 * Owns the plugin's entry points.
 *
 * The commands are deliberately the whole interaction surface for now. This plugin never registers a
 * rename/delete handler of its own — Advanced Rename and Delete Handler is the single owner of that
 * behavior in a vault, and refuses to load beside a plugin that competes with it. File Bundles moves only
 * the dependents a bundle declares, and leaves links and attachments to that plugin.
 */
export class FileBundlesComponent extends ComponentEx {
  private readonly app: App;
  private readonly commandRegistrar: CommandRegistrar;
  private readonly pluginNoticeComponent: PluginNoticeComponent;

  public constructor(params: FileBundlesComponentConstructorParams) {
    super();
    this.app = params.app;
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

    this.pluginNoticeComponent.showNotice(`File Bundles: no bundle declared for ${activeFile.path}`);
  }
}
