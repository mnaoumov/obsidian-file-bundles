import type { DataHandler } from '@mnaoumov/obsidian-lib/data-handler';
import type { PluginEventSource } from '@mnaoumov/obsidian-lib/plugin/plugin-event-source';
import type { MaybeReturn } from '@mnaoumov/typescript-lib/type';

import { PluginSettingsComponentBase } from '@mnaoumov/obsidian-lib/components/plugin-settings-component';
import { pathsValidator } from '@mnaoumov/obsidian-lib/path-settings';

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
    // The same entry syntax the author's other plugins use: a plain path, or a regular expression in slashes.
    this.registerValidator('excludedPathPatterns', (value): MaybeReturn<string> => pathsValidator([...value]));
  }
}
