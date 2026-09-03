import type { SettingDefinitionItem } from 'obsidian';

import { PluginSettingsTabBase } from 'obsidian-dev-utils/obsidian/plugin/plugin-settings-tab';

import type { PluginSettings } from './plugin-settings.ts';

export class PluginSettingsTab extends PluginSettingsTabBase<PluginSettings> {
  protected override getSettingDefinitionItems(): SettingDefinitionItem[] {
    return [
      this.settingEx({
        desc: 'The frontmatter key a markdown file uses to declare a bundle. The key is what marks a declaration, never the file name.',
        name: 'Frontmatter key',
        render: (setting) => {
          setting.addText((text) => {
            this.bind({ propertyName: 'frontmatterKey', valueComponent: text });
          });
        }
      }),
      this.settingEx({
        desc: 'Show only a bundle\'s main file in the File Explorer. This is display only: the dependents stay in the vault index and stay resolvable as link targets.',
        name: 'Hide dependents in the File Explorer',
        render: (setting) => {
          setting.addToggle((toggle) => {
            this.bind({ propertyName: 'shouldHideDependentsInFileExplorer', valueComponent: toggle });
          });
        }
      }),
      this.settingEx({
        desc: 'Delete a bundle\'s dependents along with its main file. A dependent that another bundle also declares is never deleted with one of them.',
        name: 'Delete the whole bundle',
        render: (setting) => {
          setting.addToggle((toggle) => {
            this.bind({ propertyName: 'shouldPropagateDeletions', valueComponent: toggle });
          });
        }
      }),
      this.settingEx({
        desc: 'Rename a bundle\'s dependents to follow the main file\'s new base name. Off by default, because a dependent is not necessarily named after its main. A bundle can override this in its own declaration.',
        name: 'Rename dependents with the main file',
        render: (setting) => {
          setting.addToggle((toggle) => {
            this.bind({ propertyName: 'shouldRenameDependents', valueComponent: toggle });
          });
        }
      }),
      this.settingEx({
        desc: 'Paths matching any of these are never treated as part of a bundle, whether they declare one or are declared by one. Each entry is a plain path, matching it and everything under it, or a regular expression between slashes.',
        name: 'Excluded paths',
        render: (setting) => {
          setting.addMultipleText((multipleText) => {
            this.bind({ propertyName: 'excludedPathPatterns', valueComponent: multipleText });
          });
        }
      })
    ];
  }
}
