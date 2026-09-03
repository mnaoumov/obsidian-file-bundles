import type { App as AppOriginal } from 'obsidian';
import type { TFile } from 'obsidian-test-mocks/obsidian';

import { sleep } from 'obsidian-dev-utils/async';
import { castTo } from 'obsidian-dev-utils/object-utils';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type {
  BundleDeleteEvent,
  BundleRenameEvent
} from './bundle-index-component.ts';
import type { PluginSettingsComponent } from './plugin-settings-component.ts';

import { BundleIndexComponent } from './bundle-index-component.ts';
import { PluginSettings } from './plugin-settings.ts';

/**
 * The subset of `App` the folder-note resolution reads; see the declaration tests for why it has to answer.
 */
interface AppWithPlugins {
  plugins: PluginRegistryLike;
}

interface PluginRegistryLike {
  getPlugin(this: void, id: string): unknown;
}

const ALPHA_CONTENT = [
  '---',
  'file-bundles:',
  '  files:',
  '    - "[[./assets/diagram.png]]"',
  '  folders:',
  '    - ./assets',
  '---',
  '',
  'Alpha.',
  ''
].join('\n');

const ALPHA_PATH = 'Alpha/alpha.md';
const LAYOUT_READY_DELAY_IN_MS = 10;
const PLAIN_CONTENT = '# Just a note\n';

describe('BundleIndexComponent', () => {
  let app: App;
  let appOriginal: AppOriginal;
  let settings: PluginSettings;
  let settingsChangeHandlers: (() => void)[];

  beforeEach(() => {
    vi.clearAllMocks();
    app = App.createConfigured__();
    castTo<AppWithPlugins>(app).plugins = { getPlugin: (): null => null };
    appOriginal = app.asOriginalType__();
    // Fire layout-ready synchronously, so the component's initial read happens within the test.
    appOriginal.workspace.onLayoutReady = vi.fn((callback: () => void) => {
      callback();
    });
    settings = new PluginSettings();
    settingsChangeHandlers = [];
  });

  async function createComponent(): Promise<BundleIndexComponent> {
    const component = new BundleIndexComponent({
      app: appOriginal,
      pluginSettingsComponent: strictProxy<PluginSettingsComponent>({
        off: vi.fn(),
        on: castTo<PluginSettingsComponent['on']>(vi.fn((_name: unknown, handler: () => void) => {
          settingsChangeHandlers.push(handler);
        })),
        settings
      })
    });
    component.load();
    // The base component defers its layout-ready read by a turn of the event loop, so the read has to be awaited.
    await sleep({ milliseconds: LAYOUT_READY_DELAY_IN_MS });
    return component;
  }

  function changeSettings(): void {
    for (const handler of settingsChangeHandlers) {
      handler();
    }
  }

  function createNote(path: string, content: string): void {
    const slashIndex = path.lastIndexOf('/');
    if (slashIndex > 0) {
      app.vault.createFolderSync__(path.slice(0, slashIndex));
    }
    app.vault.createSync__(path, content);
  }

  function ensureFile(path: string): TFile {
    const file = app.vault.getFileByPath(path);
    if (!file) {
      throw new Error(`The test vault has no ${path}`);
    }
    return file;
  }

  async function modifyNote(path: string, content: string): Promise<void> {
    await app.vault.modify(ensureFile(path), content);
  }

  async function renameFolder(oldPath: string, newPath: string): Promise<void> {
    const folder = app.vault.getFolderByPath(oldPath);
    if (!folder) {
      throw new Error(`The test vault has no ${oldPath}`);
    }
    await app.vault.rename(folder, newPath);
  }

  describe('the initial read', () => {
    it('should index every declaration in the vault at layout-ready', async () => {
      createNote(ALPHA_PATH, ALPHA_CONTENT);
      createNote('Beta/beta.md', PLAIN_CONTENT);

      const component = await createComponent();

      expect(component.getIndex().getDeclarations().map((declaration) => declaration.declaringPath))
        .toEqual([ALPHA_PATH]);
      expect(component.getIndex().getDeclarationsOfMember('Alpha/assets/diagram.png')).toHaveLength(1);
    });

    it('should index a folder member so it covers its subtree', async () => {
      createNote(ALPHA_PATH, ALPHA_CONTENT);

      const component = await createComponent();

      expect(component.getIndex().getDeclarationsOfMember('Alpha/assets/nested/deep.png')).toHaveLength(1);
    });

    it('should index nothing in an empty vault', async () => {
      const component = await createComponent();

      expect(component.getIndex().getDeclarations()).toEqual([]);
    });

    /*
     * A note with no cache entry has not been parsed yet — which is not the same as declaring nothing. It is
     * left alone rather than read as empty, so a bundle is never dropped just because a read outran the
     * cache.
     */
    it('should leave a note alone until the cache has parsed it', async () => {
      createNote(ALPHA_PATH, ALPHA_CONTENT);
      const component = await createComponent();
      expect(component.getIndex().getDeclarations()).toHaveLength(1);

      app.metadataCache.cache__.delete(ALPHA_PATH);
      settings.frontmatterKey = 'file-bundles';
      changeSettings();

      expect(component.getIndex().getDeclarations()).toEqual([]);
    });
  });

  describe('keeping up with the vault', () => {
    it('should pick up a declaration added to an existing note', async () => {
      createNote(ALPHA_PATH, PLAIN_CONTENT);
      const component = await createComponent();
      expect(component.getIndex().getDeclarations()).toEqual([]);

      await modifyNote(ALPHA_PATH, ALPHA_CONTENT);

      expect(component.getIndex().getDeclarations()).toHaveLength(1);
    });

    it('should drop a declaration removed from a note', async () => {
      createNote(ALPHA_PATH, ALPHA_CONTENT);
      const component = await createComponent();
      expect(component.getIndex().getDeclarations()).toHaveLength(1);

      await modifyNote(ALPHA_PATH, PLAIN_CONTENT);

      expect(component.getIndex().getDeclarations()).toEqual([]);
    });

    it('should forget a declaration when its note is deleted', async () => {
      createNote(ALPHA_PATH, ALPHA_CONTENT);
      const component = await createComponent();
      app.vault.trigger('delete', ensureFile(ALPHA_PATH));

      expect(component.getIndex().getDeclarations()).toEqual([]);
    });

    /*
     * Obsidian raises one `delete` for the folder; the per-file events that may accompany it are not
     * something correctness can rest on, so the declarations inside are dropped from the folder event alone.
     */
    it('should forget the declarations inside a deleted folder, and only those', async () => {
      createNote(ALPHA_PATH, ALPHA_CONTENT);
      createNote('Beta/beta.md', ALPHA_CONTENT);
      const component = await createComponent();

      app.vault.trigger('delete', app.vault.getFolderByPath('Alpha'));

      expect(component.getIndex().getDeclarations().map((declaration) => declaration.declaringPath))
        .toEqual(['Beta/beta.md']);
    });

    it('should follow a declaring note to its new path', async () => {
      createNote(ALPHA_PATH, ALPHA_CONTENT);
      const component = await createComponent();

      app.vault.createFolderSync__('Moved');
      await app.vault.rename(ensureFile(ALPHA_PATH), 'Moved/alpha.md');

      expect(component.getIndex().getDeclaration(ALPHA_PATH)).toBeNull();
      expect(component.getIndex().getDeclarations().map((declaration) => declaration.declaringPath))
        .toEqual(['Moved/alpha.md']);
    });

    /*
     * A folder rename moves member paths without touching a single note's content, so no metadata-cache
     * event follows it. Re-reading the declarations that pointed inside the folder is the only thing that
     * keeps their members resolvable.
     */
    it('should carry the members of a renamed folder to their new paths', async () => {
      app.vault.createFolderSync__('Alpha/assets');
      createNote(ALPHA_PATH, ALPHA_CONTENT);
      const component = await createComponent();
      expect(component.getIndex().getDeclarationsOfMember('Alpha/assets/diagram.png')).toHaveLength(1);

      await renameFolder('Alpha/assets', 'Alpha/renamed-assets');

      expect(component.getIndex().getDeclaration(ALPHA_PATH)?.members.map((member) => member.path))
        .toEqual(['Alpha/renamed-assets/diagram.png', 'Alpha/renamed-assets']);
      expect(component.getIndex().getDeclarationsOfMember('Alpha/renamed-assets/nested/deep.png')).toHaveLength(1);
    });

    /*
     * Only the members inside the renamed folder move. A rooted member names a home of its own, so carrying
     * it along would silently move a file the rename never touched.
     */
    it('should leave a bundle the rename does not touch alone', async () => {
      app.vault.createFolderSync__('Alpha/assets');
      createNote(ALPHA_PATH, ALPHA_CONTENT);
      createNote('Beta/beta.md', ALPHA_CONTENT);
      const component = await createComponent();

      await renameFolder('Alpha/assets', 'Alpha/renamed-assets');

      expect(component.getIndex().getDeclaration('Beta/beta.md')?.members.map((member) => member.path))
        .toEqual(['Beta/assets/diagram.png', 'Beta/assets']);
    });

    it('should leave a member outside the renamed folder where it is', async () => {
      app.vault.createFolderSync__('Alpha/assets');
      createNote(
        ALPHA_PATH,
        [
          '---',
          'file-bundles:',
          '  files:',
          '    - "[[/Shared/logo.png]]"',
          '  folders:',
          '    - ./assets',
          '---',
          ''
        ].join('\n')
      );
      const component = await createComponent();

      await renameFolder('Alpha/assets', 'Alpha/renamed-assets');

      expect(component.getIndex().getDeclaration(ALPHA_PATH)?.members.map((member) => member.path))
        .toEqual(['Shared/logo.png', 'Alpha/renamed-assets']);
    });
  });

  describe('change handlers', () => {
    it('should notify a registered handler when the index changes', async () => {
      createNote(ALPHA_PATH, ALPHA_CONTENT);
      const component = await createComponent();
      const handler = vi.fn();
      component.registerChangeHandler(handler);

      app.vault.trigger('delete', ensureFile(ALPHA_PATH));

      expect(handler).toHaveBeenCalled();
    });

    it('should stop notifying a handler once the component unloads', async () => {
      const component = await createComponent();
      const handler = vi.fn();
      component.registerChangeHandler(handler);
      component.unload();
      handler.mockClear();

      app.vault.trigger('delete', app.vault.getRoot());

      expect(handler).not.toHaveBeenCalled();
    });
  });

  /*
   * These are reported BEFORE the index updates, which is the whole point: `vault.on('delete')` fires after
   * the fact, so nothing downstream could otherwise say what went with the file that just went.
   */
  describe('reporting a change before making it', () => {
    it('should hand the rename handler the declaration with the paths the members still have', async () => {
      app.vault.createFolderSync__('Alpha/assets');
      createNote(ALPHA_PATH, ALPHA_CONTENT);
      const component = await createComponent();
      const events: BundleRenameEvent[] = [];
      component.registerRenameHandler((event) => {
        events.push(event);
      });

      app.vault.createFolderSync__('Moved');
      await app.vault.rename(ensureFile(ALPHA_PATH), 'Moved/alpha.md');

      expect(events).toHaveLength(1);
      expect(events[0]?.oldPath).toBe(ALPHA_PATH);
      expect(events[0]?.newPath).toBe('Moved/alpha.md');
      expect(events[0]?.declarations[0]?.members.map((member) => member.path))
        .toEqual(['Alpha/assets/diagram.png', 'Alpha/assets']);
    });

    it('should say nothing about a rename that touches no bundle of its own', async () => {
      createNote(ALPHA_PATH, ALPHA_CONTENT);
      createNote('Beta/beta.md', PLAIN_CONTENT);
      const component = await createComponent();
      const events: BundleRenameEvent[] = [];
      component.registerRenameHandler((event) => {
        events.push(event);
      });

      await app.vault.rename(ensureFile('Beta/beta.md'), 'Beta/renamed.md');

      expect(events).toEqual([]);
    });

    it('should hand the delete handler the declaration and everything else that claims files', async () => {
      createNote(ALPHA_PATH, ALPHA_CONTENT);
      createNote('Beta/beta.md', ALPHA_CONTENT);
      const component = await createComponent();
      const events: BundleDeleteEvent[] = [];
      component.registerDeleteHandler((event) => {
        events.push(event);
      });

      app.vault.trigger('delete', ensureFile(ALPHA_PATH));

      expect(events).toHaveLength(1);
      expect(events[0]?.path).toBe(ALPHA_PATH);
      expect(events[0]?.declarations.map((declaration) => declaration.declaringPath)).toEqual([ALPHA_PATH]);
      expect(events[0]?.otherDeclarations.map((declaration) => declaration.declaringPath)).toEqual(['Beta/beta.md']);
    });

    it('should say nothing about a deletion that touches no bundle of its own', async () => {
      createNote(ALPHA_PATH, ALPHA_CONTENT);
      createNote('Beta/beta.md', PLAIN_CONTENT);
      const component = await createComponent();
      const events: BundleDeleteEvent[] = [];
      component.registerDeleteHandler((event) => {
        events.push(event);
      });

      app.vault.trigger('delete', ensureFile('Beta/beta.md'));

      expect(events).toEqual([]);
    });

    it('should stop reporting once the component unloads', async () => {
      createNote(ALPHA_PATH, ALPHA_CONTENT);
      const component = await createComponent();
      const deleteEvents: BundleDeleteEvent[] = [];
      const renameEvents: BundleRenameEvent[] = [];
      component.registerDeleteHandler((event) => {
        deleteEvents.push(event);
      });
      component.registerRenameHandler((event) => {
        renameEvents.push(event);
      });
      component.unload();

      app.vault.createFolderSync__('Moved');
      await app.vault.rename(ensureFile(ALPHA_PATH), 'Moved/alpha.md');
      app.vault.trigger('delete', ensureFile('Moved/alpha.md'));

      expect(deleteEvents).toEqual([]);
      expect(renameEvents).toEqual([]);
    });
  });

  describe('settings', () => {
    it('should read the declaration key the settings name', async () => {
      settings.frontmatterKey = 'bundle';
      createNote(ALPHA_PATH, ALPHA_CONTENT.replace('file-bundles:', 'bundle:'));

      const component = await createComponent();

      expect(component.getIndex().getDeclarations()).toHaveLength(1);
    });

    it('should keep an excluded note out of the index entirely', async () => {
      settings.excludedPathPatterns = ['Alpha'];
      createNote(ALPHA_PATH, ALPHA_CONTENT);

      const component = await createComponent();

      expect(component.getIndex().getDeclarations()).toEqual([]);
    });

    it('should rebuild when the settings change, so a new exclusion takes effect', async () => {
      createNote(ALPHA_PATH, ALPHA_CONTENT);
      const component = await createComponent();
      expect(component.getIndex().getDeclarations()).toHaveLength(1);

      settings.excludedPathPatterns = ['Alpha'];
      changeSettings();

      expect(component.getIndex().getDeclarations()).toEqual([]);
    });

    it('should accept a regular expression exclusion', async () => {
      settings.excludedPathPatterns = [String.raw`/^Alpha\//`];
      createNote(ALPHA_PATH, ALPHA_CONTENT);

      const component = await createComponent();

      expect(component.getIndex().getDeclarations()).toEqual([]);
    });
  });
});
