import type { DataHandler } from 'obsidian-dev-utils/obsidian/data-handler';
import type { PluginEventSource } from 'obsidian-dev-utils/obsidian/plugin/plugin-event-source';
import type { MaybeReturn } from 'obsidian-dev-utils/type';

import { PluginSettingsComponentBase } from 'obsidian-dev-utils/obsidian/components/plugin-settings-component';
import { pathsValidator } from 'obsidian-dev-utils/obsidian/path-settings';

import { PluginSettings } from './plugin-settings.ts';

interface PluginSettingsComponentConstructorParams {
  readonly dataHandler: DataHandler;
  readonly pluginEventSource: PluginEventSource;
}

export class PluginSettingsComponent extends PluginSettingsComponentBase<PluginSettings> {
  public constructor(params: PluginSettingsComponentConstructorParams) {
    super({
      ...params,
      pluginSettingsClass: PluginSettings
    });
  }

  protected override registerValidators(): void {
    super.registerValidators();
    this.registerValidator('frontmatterKey', (value): MaybeReturn<string> => {
      if (!value.trim()) {
        return 'The frontmatter key cannot be empty';
      }
    });
    // The same entry syntax the rest of the fleet uses: a plain path, or a regular expression in slashes.
    this.registerValidator('excludedPathPatterns', (value): MaybeReturn<string> => pathsValidator([...value]));
  }
}
