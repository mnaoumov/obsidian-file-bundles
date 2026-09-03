import { OpenDemoVaultCommandHandler } from 'obsidian-dev-utils/obsidian/command-handlers/open-demo-vault-command-handler';
import { PluginCommandRegistrar } from 'obsidian-dev-utils/obsidian/command-registrar';
import { PluginSettingsTabComponent } from 'obsidian-dev-utils/obsidian/components/plugin-settings-tab-component';
import { PluginDataHandler } from 'obsidian-dev-utils/obsidian/data-handler';
import { PluginBase } from 'obsidian-dev-utils/obsidian/plugin/plugin';
import { PluginEventSourceImpl } from 'obsidian-dev-utils/obsidian/plugin/plugin-event-source';

import { BundleExplorerComponent } from './bundle-explorer-component.ts';
import { BundleIndexComponent } from './bundle-index-component.ts';
import { BundleOperationsComponent } from './bundle-operations-component.ts';
import { FileBundlesComponent } from './file-bundles-component.ts';
import { PluginSettingsComponent } from './plugin-settings-component.ts';
import { PluginSettingsTab } from './plugin-settings-tab.ts';

export class Plugin extends PluginBase {
  protected override async onloadImpl(): Promise<void> {
    const pluginSettingsComponent = this.addChild(
      new PluginSettingsComponent({
        dataHandler: new PluginDataHandler(this),
        pluginEventSource: new PluginEventSourceImpl(this)
      })
    );
    this.pluginSettingsComponent = pluginSettingsComponent;
    this.addChild(
      new PluginSettingsTabComponent({
        plugin: this,
        pluginSettingsTab: new PluginSettingsTab({
          plugin: this,
          pluginSettingsComponent
        })
      })
    );

    const bundleIndexComponent = this.addChild(
      new BundleIndexComponent({
        app: this.app,
        pluginSettingsComponent
      })
    );

    this.addChild(
      new BundleExplorerComponent({
        app: this.app,
        bundleIndexComponent,
        pluginSettingsComponent
      })
    );

    this.addChild(
      new BundleOperationsComponent({
        app: this.app,
        bundleIndexComponent,
        pluginSettingsComponent
      })
    );

    this.addChild(
      new FileBundlesComponent({
        app: this.app,
        bundleIndexComponent,
        commandRegistrar: new PluginCommandRegistrar(this),
        pluginNoticeComponent: this.pluginNoticeComponent
      })
    );

    await this.commandHandlerComponent.registerCommandHandlers(() => [
      new OpenDemoVaultCommandHandler({
        app: this.app,
        pluginId: this.manifest.id,
        pluginNoticeComponent: this.pluginNoticeComponent,
        pluginVersion: this.manifest.version
      })
    ]);
  }
}
