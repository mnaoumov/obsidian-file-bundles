import {
  describe,
  expect,
  it
} from 'vitest';

import { PluginSettings } from './plugin-settings.ts';

describe('PluginSettings', () => {
  /*
   * A bundle is locked by default — that is the behavior the plugin exists to provide, so its default is
   * asserted here rather than left to the settings tab.
   */
  it('should hide dependents by default', () => {
    const settings = new PluginSettings();
    expect(settings.shouldHideDependentsInFileExplorer).toBe(true);
  });

  it('should delete the whole bundle by default', () => {
    const settings = new PluginSettings();
    expect(settings.shouldPropagateDeletions).toBe(true);
  });

  /*
   * The opposite default to the one above, deliberately: renaming a dependent renames it out from under
   * anything else that links to it, which deleting a bundle member never does.
   */
  it('should leave dependents named as they are by default', () => {
    const settings = new PluginSettings();
    expect(settings.shouldRenameDependents).toBe(false);
  });

  it('should declare bundles under the plugin\'s own frontmatter key by default', () => {
    const settings = new PluginSettings();
    expect(settings.frontmatterKey).toBe('file-bundles');
  });

  it('should start with no exclusions', () => {
    const settings = new PluginSettings();
    expect(settings.excludedPathPatterns).toEqual([]);
  });
});
