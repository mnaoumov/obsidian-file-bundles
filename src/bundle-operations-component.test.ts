import { sleep } from 'obsidian-dev-utils/async';
import { noopAsync } from 'obsidian-dev-utils/function';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { BundleDeclaration } from './bundle-declaration.ts';
import type {
  BundleDeleteEvent,
  BundleIndexComponent,
  BundleRenameEvent
} from './bundle-index-component.ts';
import type { PluginSettingsComponent } from './plugin-settings-component.ts';

import {
  BundleMemberAnchoring,
  BundleMemberKind
} from './bundle-declaration.ts';
import { BundleOperationsComponent } from './bundle-operations-component.ts';
import { PluginSettings } from './plugin-settings.ts';

interface DeclarationOverrides {
  readonly declaringPath?: string;
  readonly mainPath?: string;
  readonly relativePaths?: readonly string[];
  readonly rootedPaths?: readonly string[];
}

const ALPHA_PATH = 'Alpha/alpha.md';
const SETTLE_DELAY_IN_MS = 20;

function createDeclaration(overrides: DeclarationOverrides = {}): BundleDeclaration {
  const declaringPath = overrides.declaringPath ?? ALPHA_PATH;

  return {
    declaringPath,
    mainPath: overrides.mainPath ?? declaringPath,
    members: [
      ...(overrides.relativePaths ?? []).map((path) => ({
        anchoring: BundleMemberAnchoring.Relative,
        isAnchorPrefixMissing: false,
        isWikilink: true,
        kind: BundleMemberKind.File,
        path
      })),
      ...(overrides.rootedPaths ?? []).map((path) => ({
        anchoring: BundleMemberAnchoring.Rooted,
        isAnchorPrefixMissing: false,
        isWikilink: true,
        kind: BundleMemberKind.File,
        path
      }))
    ]
  };
}

describe('BundleOperationsComponent', () => {
  let app: App;
  let deleteHandlers: ((event: BundleDeleteEvent) => void)[];
  let renameHandlers: ((event: BundleRenameEvent) => void)[];
  let settings: PluginSettings;

  beforeEach(() => {
    vi.clearAllMocks();
    app = App.createConfigured__();
    deleteHandlers = [];
    renameHandlers = [];
    settings = new PluginSettings();
  });

  function createComponent(): BundleOperationsComponent {
    const component = new BundleOperationsComponent({
      app: app.asOriginalType__(),
      bundleIndexComponent: strictProxy<BundleIndexComponent>({
        registerDeleteHandler: (handler: (event: BundleDeleteEvent) => void) => {
          deleteHandlers.push(handler);
        },
        registerRenameHandler: (handler: (event: BundleRenameEvent) => void) => {
          renameHandlers.push(handler);
        }
      }),
      pluginSettingsComponent: strictProxy<PluginSettingsComponent>({
        editAndSave: async (settingsEditor: (settings: PluginSettings) => void) => {
          settingsEditor(settings);
          await noopAsync();
        },
        settings
      })
    });
    component.load();
    return component;
  }

  function createFile(path: string, content = ''): void {
    const slashIndex = path.lastIndexOf('/');
    if (slashIndex > 0) {
      app.vault.createFolderSync__(path.slice(0, slashIndex));
    }
    app.vault.createSync__(path, content);
  }

  function readFile(path: string): string {
    const file = app.vault.getFileByPath(path);
    if (!file) {
      throw new Error(`The test vault has no ${path}`);
    }
    return app.vault.readSync__(file);
  }

  async function fireRename(event: BundleRenameEvent): Promise<void> {
    for (const handler of renameHandlers) {
      handler(event);
    }
    await sleep({ milliseconds: SETTLE_DELAY_IN_MS });
  }

  async function fireDelete(event: BundleDeleteEvent): Promise<void> {
    for (const handler of deleteHandlers) {
      handler(event);
    }
    await sleep({ milliseconds: SETTLE_DELAY_IN_MS });
  }

  describe('a main file that moved', () => {
    beforeEach(() => {
      createFile('Beta/alpha.md', '---\nfile-bundles:\n  files:\n    - "[[diagram.png]]"\n---\n');
      createFile('Alpha/assets/diagram.png');
      createFile('Shared/logo.png');
    });

    it('should carry a relative member into the new folder', async () => {
      createComponent();

      await fireRename({
        declarations: [createDeclaration({ relativePaths: ['Alpha/assets/diagram.png'] })],
        newPath: 'Beta/alpha.md',
        oldPath: ALPHA_PATH
      });

      expect(app.vault.getFileByPath('Beta/assets/diagram.png')).not.toBeNull();
      expect(app.vault.getFileByPath('Alpha/assets/diagram.png')).toBeNull();
    });

    it('should leave a rooted member where it is', async () => {
      createComponent();

      await fireRename({
        declarations: [createDeclaration({ rootedPaths: ['Shared/logo.png'] })],
        newPath: 'Beta/alpha.md',
        oldPath: ALPHA_PATH
      });

      expect(app.vault.getFileByPath('Shared/logo.png')).not.toBeNull();
    });

    /*
     * The declaration is rewritten even when nothing moved, because Obsidian has just re-pointed its links
     * in shortest-path style and stripped the prefixes the format requires.
     */
    it('should put the anchoring back into the declaration', async () => {
      createComponent();

      await fireRename({
        declarations: [createDeclaration({ relativePaths: ['Alpha/assets/diagram.png'] })],
        newPath: 'Beta/alpha.md',
        oldPath: ALPHA_PATH
      });

      expect(readFile('Beta/alpha.md')).toContain('[[./assets/diagram.png]]');
    });

    it('should move nothing for an unlocked bundle', async () => {
      settings.unlockedBundleMainPaths = [ALPHA_PATH];
      createComponent();

      await fireRename({
        declarations: [createDeclaration({ relativePaths: ['Alpha/assets/diagram.png'] })],
        newPath: 'Beta/alpha.md',
        oldPath: ALPHA_PATH
      });

      expect(app.vault.getFileByPath('Alpha/assets/diagram.png')).not.toBeNull();
    });

    /*
     * Unlocking says "do not move my files", not "let the declaration rot". Obsidian has just stripped the
     * anchoring off every entry, and leaving it that way would mean a bundle that no longer parses by the
     * time it is locked again.
     */
    it('should still put the anchoring back for an unlocked bundle', async () => {
      settings.unlockedBundleMainPaths = [ALPHA_PATH];
      createComponent();

      await fireRename({
        declarations: [createDeclaration({ rootedPaths: ['Shared/logo.png'] })],
        newPath: 'Beta/alpha.md',
        oldPath: ALPHA_PATH
      });

      expect(readFile('Beta/alpha.md')).toContain('/Shared/logo.png');
    });

    /*
     * The unlocked list is keyed by main path, so without this a moved bundle would silently lock itself
     * again — the list would be naming a file that no longer exists.
     */
    it('should keep the unlocked list pointing at the bundle it unlocked', async () => {
      settings.unlockedBundleMainPaths = [ALPHA_PATH];
      createComponent();

      await fireRename({
        declarations: [createDeclaration({ relativePaths: ['Alpha/assets/diagram.png'] })],
        newPath: 'Beta/alpha.md',
        oldPath: ALPHA_PATH
      });

      expect(settings.unlockedBundleMainPaths).toEqual(['Beta/alpha.md']);
    });

    it('should keep every other unlocked bundle in the list untouched', async () => {
      settings.unlockedBundleMainPaths = ['Gamma/gamma.md', ALPHA_PATH];
      createComponent();

      await fireRename({
        declarations: [createDeclaration({ relativePaths: ['Alpha/assets/diagram.png'] })],
        newPath: 'Beta/alpha.md',
        oldPath: ALPHA_PATH
      });

      expect(settings.unlockedBundleMainPaths).toEqual(['Gamma/gamma.md', 'Beta/alpha.md']);
    });

    /*
     * Renaming a sidecar note does not move the main file it names, so there is no main path to follow.
     */
    it('should leave the unlocked list alone when the main file did not move', async () => {
      createFile('Alpha/notes.md', '---\nfile-bundles: {}\n---\n');
      createFile('Alpha/report.html');
      settings.unlockedBundleMainPaths = ['Alpha/report.html'];
      createComponent();

      await fireRename({
        declarations: [createDeclaration({
          declaringPath: 'Alpha/report.html.md',
          mainPath: 'Alpha/report.html'
        })],
        newPath: 'Alpha/notes.md',
        oldPath: 'Alpha/report.html.md'
      });

      expect(settings.unlockedBundleMainPaths).toEqual(['Alpha/report.html']);
    });

    it('should leave the unlocked list alone for a bundle that was never unlocked', async () => {
      settings.unlockedBundleMainPaths = ['Gamma/gamma.md'];
      createComponent();

      await fireRename({
        declarations: [createDeclaration({ relativePaths: ['Alpha/assets/diagram.png'] })],
        newPath: 'Beta/alpha.md',
        oldPath: ALPHA_PATH
      });

      expect(settings.unlockedBundleMainPaths).toEqual(['Gamma/gamma.md']);
    });
  });

  describe('a main file that was renamed', () => {
    beforeEach(() => {
      createFile('Alpha/renamed.md', '---\nfile-bundles: {}\n---\n');
      createFile('Alpha/alpha.png');
    });

    it('should leave dependents alone by default', async () => {
      createComponent();

      await fireRename({
        declarations: [createDeclaration({ relativePaths: ['Alpha/alpha.png'] })],
        newPath: 'Alpha/renamed.md',
        oldPath: ALPHA_PATH
      });

      expect(app.vault.getFileByPath('Alpha/alpha.png')).not.toBeNull();
    });

    it('should rename them when the setting says so', async () => {
      settings.shouldRenameDependents = true;
      createComponent();

      await fireRename({
        declarations: [createDeclaration({ relativePaths: ['Alpha/alpha.png'] })],
        newPath: 'Alpha/renamed.md',
        oldPath: ALPHA_PATH
      });

      expect(app.vault.getFileByPath('Alpha/renamed.png')).not.toBeNull();
    });

    it('should let the bundle overrule the setting', async () => {
      settings.shouldRenameDependents = true;
      createComponent();

      await fireRename({
        declarations: [{
          ...createDeclaration({ relativePaths: ['Alpha/alpha.png'] }),
          renameDependents: false
        }],
        newPath: 'Alpha/renamed.md',
        oldPath: ALPHA_PATH
      });

      expect(app.vault.getFileByPath('Alpha/alpha.png')).not.toBeNull();
    });
  });

  describe('a main file that was deleted', () => {
    beforeEach(() => {
      createFile('Alpha/assets/diagram.png');
      createFile('Shared/logo.png');
    });

    it('should trash the dependents that went with it', async () => {
      createComponent();

      await fireDelete({
        declarations: [createDeclaration({ relativePaths: ['Alpha/assets/diagram.png'] })],
        otherDeclarations: [],
        path: ALPHA_PATH
      });

      expect(await app.vault.adapter.exists('Alpha/assets/diagram.png')).toBe(false);
    });

    it('should spare a dependent another bundle also declares', async () => {
      createComponent();

      await fireDelete({
        declarations: [createDeclaration({ rootedPaths: ['Shared/logo.png'] })],
        otherDeclarations: [createDeclaration({
          declaringPath: 'Beta/beta.md',
          rootedPaths: ['Shared/logo.png']
        })],
        path: ALPHA_PATH
      });

      expect(await app.vault.adapter.exists('Shared/logo.png')).toBe(true);
    });

    it('should leave everything when deletions do not propagate', async () => {
      settings.shouldPropagateDeletions = false;
      createComponent();

      await fireDelete({
        declarations: [createDeclaration({ relativePaths: ['Alpha/assets/diagram.png'] })],
        otherDeclarations: [],
        path: ALPHA_PATH
      });

      expect(await app.vault.adapter.exists('Alpha/assets/diagram.png')).toBe(true);
    });

    it('should leave an unlocked bundle alone', async () => {
      settings.unlockedBundleMainPaths = [ALPHA_PATH];
      createComponent();

      await fireDelete({
        declarations: [createDeclaration({ relativePaths: ['Alpha/assets/diagram.png'] })],
        otherDeclarations: [],
        path: ALPHA_PATH
      });

      expect(await app.vault.adapter.exists('Alpha/assets/diagram.png')).toBe(true);
    });
  });
});
