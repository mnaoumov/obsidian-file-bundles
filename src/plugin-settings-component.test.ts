import type { DataHandler } from 'obsidian-dev-utils/obsidian/data-handler';
import type { PluginEventSource } from 'obsidian-dev-utils/obsidian/plugin/plugin-event-source';

import { castTo } from 'obsidian-dev-utils/object-utils';
import { PluginSettingsComponentBase } from 'obsidian-dev-utils/obsidian/components/plugin-settings-component';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { PluginSettingsComponent } from './plugin-settings-component.ts';
import { PluginSettings } from './plugin-settings.ts';

type PathsValidator = (paths: string[]) => string | undefined;

interface ProtectedBase {
  registerValidator(key: string, validator: unknown): void;
  registerValidators(): void;
}

interface RegisteredValidator {
  key: string;
  validator(value: string): string | undefined;
}

const protectedBasePrototype = castTo<ProtectedBase>(PluginSettingsComponentBase.prototype);

describe('PluginSettingsComponent', () => {
  function createComponent(): PluginSettingsComponent {
    return new PluginSettingsComponent({
      dataHandler: strictProxy<DataHandler>({}),
      pluginEventSource: strictProxy<PluginEventSource>({})
    });
  }

  it('should create an instance', () => {
    const component = createComponent();
    expect(component).toBeInstanceOf(PluginSettingsComponent);
  });

  it('should create default PluginSettings as defaultSettings', () => {
    const component = createComponent();
    expect(component.defaultSettings).toBeInstanceOf(PluginSettings);
  });

  describe('registerValidators', () => {
    function getRegisteredValidators(): RegisteredValidator[] {
      const registered: RegisteredValidator[] = [];
      const registerValidatorSpy = vi.spyOn(protectedBasePrototype, 'registerValidator')
        .mockImplementation((key, validator) => {
          registered.push({
            key,
            validator: castTo<RegisteredValidator['validator']>(validator)
          });
        });
      const superSpy = vi.spyOn(protectedBasePrototype, 'registerValidators').mockImplementation(() => undefined);
      const component = createComponent();
      component['registerValidators']();
      registerValidatorSpy.mockRestore();
      superSpy.mockRestore();
      return registered;
    }

    it('should reject an empty frontmatter key', () => {
      const validator = getRegisteredValidators().find((candidate) => candidate.key === 'frontmatterKey');
      expect(validator).toBeDefined();
      expect(validator?.validator('')).toBe('The frontmatter key cannot be empty');
      expect(validator?.validator(' ')).toBe('The frontmatter key cannot be empty');
    });

    it('should accept a frontmatter key with content', () => {
      const validator = getRegisteredValidators().find((candidate) => candidate.key === 'frontmatterKey');
      expect(validator?.validator('file-bundles')).toBeUndefined();
    });

    /*
     * The exclusion list takes the fleet's usual entry syntax — a plain path, or a regular expression in
     * slashes — so it is the library's own validator that answers here rather than a second dialect.
     */
    it('should accept plain paths and well-formed regular expressions as exclusions', () => {
      const validator = getRegisteredValidators().find((candidate) => candidate.key === 'excludedPathPatterns');
      expect(validator).toBeDefined();
      expect(castTo<PathsValidator>(validator?.validator)(['Archive', String.raw`/^Inbox\//`])).toBeUndefined();
    });

    it('should reject an exclusion that is a half-typed regular expression', () => {
      const validator = getRegisteredValidators().find((candidate) => candidate.key === 'excludedPathPatterns');
      expect(castTo<PathsValidator>(validator?.validator)([String.raw`/^Inbox\/`])).toBeTruthy();
    });
  });
});
