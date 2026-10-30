import { OpenBugReportCommandHandler } from '@mnaoumov/obsidian-lib/command-handlers/open-bug-report-command-handler';
import { OpenDemoVaultCommandHandler } from '@mnaoumov/obsidian-lib/command-handlers/open-demo-vault-command-handler';
import { PluginCommandRegistrar } from '@mnaoumov/obsidian-lib/command-registrar';
import { MenuEventRegistrarComponent } from '@mnaoumov/obsidian-lib/components/menu-event-registrar-component';
import { PluginSettingsTabComponent } from '@mnaoumov/obsidian-lib/components/plugin-settings-tab-component';
import { PluginDataHandler } from '@mnaoumov/obsidian-lib/data-handler';
import { PluginBase } from '@mnaoumov/obsidian-lib/plugin/plugin';
import { PluginEventSourceImpl } from '@mnaoumov/obsidian-lib/plugin/plugin-event-source';

import { BundleExplorerComponent } from './bundles/bundle-explorer-component.ts';
import { BundleIndexComponent } from './bundles/bundle-index-component.ts';
import { BundleOperationsComponent } from './bundles/bundle-operations-component.ts';
import { FileBundlesComponent } from './bundles/file-bundles-component.ts';
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
        menuEventRegistrar: this.addChild(new MenuEventRegistrarComponent(this.app)),
        pluginNoticeComponent: this.pluginNoticeComponent,
        pluginSettingsComponent
      })
    );

    await this.commandHandlerComponent.registerCommandHandlers(() => [
      new OpenBugReportCommandHandler({
        app: this.app,
        gitHubRepo: 'mnaoumov/obsidian-file-bundles',
        pluginId: this.manifest.id
      }),
      new OpenDemoVaultCommandHandler({
        app: this.app,
        pluginId: this.manifest.id,
        pluginNoticeComponent: this.pluginNoticeComponent,
        pluginVersion: this.manifest.version
      })
    ]);
  }
}
