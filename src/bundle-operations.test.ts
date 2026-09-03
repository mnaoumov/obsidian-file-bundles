import { castTo } from 'obsidian-dev-utils/object-utils';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  beforeEach,
  describe,
  expect,
  it
} from 'vitest';

import type { BundleDeclaration } from './bundle-declaration.ts';

import {
  BundleMemberAnchoring,
  BundleMemberKind
} from './bundle-declaration.ts';
import {
  applyBundleMoves,
  planBundleDeletion,
  planBundleMove,
  planBundleRename,
  rewriteBundleDeclaration,
  trashBundlePaths
} from './bundle-operations.ts';

interface AppWithPlugins {
  plugins: PluginRegistryLike;
}

interface DeclarationOverrides {
  readonly declaringPath?: string;
  readonly folderPaths?: readonly string[];
  readonly mainPath?: string;
  readonly relativePaths?: readonly string[];
  readonly renameDependents?: boolean;
  readonly rootedPaths?: readonly string[];
}

interface PluginRegistryLike {
  getPlugin(this: void, id: string): unknown;
}

const ALPHA_PATH = 'Alpha/alpha.md';
const FRONTMATTER_KEY = 'file-bundles';

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
      })),
      ...(overrides.folderPaths ?? []).map((path) => ({
        anchoring: BundleMemberAnchoring.Relative,
        isAnchorPrefixMissing: false,
        isWikilink: false,
        kind: BundleMemberKind.Folder,
        path
      }))
    ],
    ...overrides.renameDependents !== undefined && { renameDependents: overrides.renameDependents }
  };
}

describe('planBundleMove', () => {
  it('should move a relative member into the new folder', () => {
    const moves = planBundleMove({
      declaration: createDeclaration({ relativePaths: ['Alpha/assets/diagram.png'] }),
      newPath: 'Beta/alpha.md',
      oldPath: ALPHA_PATH
    });

    expect(moves).toEqual([{ newPath: 'Beta/assets/diagram.png', oldPath: 'Alpha/assets/diagram.png' }]);
  });

  /*
   * This is what makes the two prefixes mean something operationally rather than only parse differently.
   */
  it('should leave a rooted member where it is', () => {
    const moves = planBundleMove({
      declaration: createDeclaration({ rootedPaths: ['Shared/logo.png'] }),
      newPath: 'Beta/alpha.md',
      oldPath: ALPHA_PATH
    });

    expect(moves).toEqual([]);
  });

  it('should move a folder member whole', () => {
    const moves = planBundleMove({
      declaration: createDeclaration({ folderPaths: ['Alpha/assets'] }),
      newPath: 'Beta/alpha.md',
      oldPath: ALPHA_PATH
    });

    expect(moves).toEqual([{ newPath: 'Beta/assets', oldPath: 'Alpha/assets' }]);
  });

  /*
   * Moving the folder already carries the file inside it. Moving it again would move it out of a folder
   * that is no longer there.
   */
  it('should not move a file that a moving folder member already carries', () => {
    const moves = planBundleMove({
      declaration: createDeclaration({
        folderPaths: ['Alpha/assets'],
        relativePaths: ['Alpha/assets/diagram.png']
      }),
      newPath: 'Beta/alpha.md',
      oldPath: ALPHA_PATH
    });

    expect(moves).toEqual([{ newPath: 'Beta/assets', oldPath: 'Alpha/assets' }]);
  });

  it('should do nothing when only the name changed', () => {
    const moves = planBundleMove({
      declaration: createDeclaration({ relativePaths: ['Alpha/assets/diagram.png'] }),
      newPath: 'Alpha/renamed.md',
      oldPath: ALPHA_PATH
    });

    expect(moves).toEqual([]);
  });

  it('should leave a relative member that never sat under the main file', () => {
    const moves = planBundleMove({
      declaration: createDeclaration({ relativePaths: ['Elsewhere/diagram.png'] }),
      newPath: 'Beta/alpha.md',
      oldPath: ALPHA_PATH
    });

    expect(moves).toEqual([]);
  });

  it('should take the sidecar note along when the main file moves', () => {
    const moves = planBundleMove({
      declaration: createDeclaration({
        declaringPath: 'Alpha/report.html.md',
        mainPath: 'Alpha/report.html',
        relativePaths: ['Alpha/report-styles.css']
      }),
      newPath: 'Beta/report.html',
      oldPath: 'Alpha/report.html'
    });

    expect(moves).toEqual([
      { newPath: 'Beta/report.html.md', oldPath: 'Alpha/report.html.md' },
      { newPath: 'Beta/report-styles.css', oldPath: 'Alpha/report-styles.css' }
    ]);
  });

  it('should take the main file along when the sidecar note moves', () => {
    const moves = planBundleMove({
      declaration: createDeclaration({
        declaringPath: 'Alpha/report.html.md',
        mainPath: 'Alpha/report.html'
      }),
      newPath: 'Beta/report.html.md',
      oldPath: 'Alpha/report.html.md'
    });

    expect(moves).toEqual([{ newPath: 'Beta/report.html', oldPath: 'Alpha/report.html' }]);
  });

  it('should ignore a moved path that is neither the main file nor the declaring note', () => {
    const moves = planBundleMove({
      declaration: createDeclaration({
        declaringPath: 'Alpha/report.html.md',
        mainPath: 'Alpha/report.html'
      }),
      newPath: 'Beta/unrelated.png',
      oldPath: 'Alpha/unrelated.png'
    });

    expect(moves).toEqual([]);
  });
});

describe('planBundleRename', () => {
  it('should leave dependents alone by default', () => {
    const moves = planBundleRename({
      declaration: createDeclaration({ relativePaths: ['Alpha/alpha.png'] }),
      newPath: 'Alpha/renamed.md',
      oldPath: ALPHA_PATH,
      shouldRenameDependents: false
    });

    expect(moves).toEqual([]);
  });

  it('should rename the dependents named after the main file when asked to', () => {
    const moves = planBundleRename({
      declaration: createDeclaration({ relativePaths: ['Alpha/alpha.png', 'Alpha/other.png'] }),
      newPath: 'Alpha/renamed.md',
      oldPath: ALPHA_PATH,
      shouldRenameDependents: true
    });

    expect(moves).toEqual([{ newPath: 'Alpha/renamed.png', oldPath: 'Alpha/alpha.png' }]);
  });

  it('should rename a folder named after the main file without inventing an extension', () => {
    const moves = planBundleRename({
      declaration: createDeclaration({ folderPaths: ['Alpha/alpha'] }),
      newPath: 'Alpha/renamed.md',
      oldPath: ALPHA_PATH,
      shouldRenameDependents: true
    });

    expect(moves).toEqual([{ newPath: 'Alpha/renamed', oldPath: 'Alpha/alpha' }]);
  });

  it('should do nothing when only the folder changed', () => {
    const moves = planBundleRename({
      declaration: createDeclaration({ relativePaths: ['Alpha/alpha.png'] }),
      newPath: 'Beta/alpha.md',
      oldPath: ALPHA_PATH,
      shouldRenameDependents: true
    });

    expect(moves).toEqual([]);
  });

  /*
   * A sidecar named after its main is the convention that makes the pair legible, so it follows the rename
   * whatever the dependents setting says — leaving `report.html.md` beside `invoice.html` would break the
   * very thing that put it there.
   */
  it('should rename a sidecar named after its main file, even with dependents left alone', () => {
    const moves = planBundleRename({
      declaration: createDeclaration({
        declaringPath: 'Alpha/report.html.md',
        mainPath: 'Alpha/report.html'
      }),
      newPath: 'Alpha/invoice.html',
      oldPath: 'Alpha/report.html',
      shouldRenameDependents: false
    });

    expect(moves).toEqual([{ newPath: 'Alpha/invoice.html.md', oldPath: 'Alpha/report.html.md' }]);
  });

  it('should leave a declaring note that is not named after its main file', () => {
    const moves = planBundleRename({
      declaration: createDeclaration({
        declaringPath: 'Alpha/notes.md',
        mainPath: 'Alpha/report.html'
      }),
      newPath: 'Alpha/invoice.html',
      oldPath: 'Alpha/report.html',
      shouldRenameDependents: false
    });

    expect(moves).toEqual([]);
  });
});

describe('planBundleDeletion', () => {
  it('should take the declared dependents', () => {
    const paths = planBundleDeletion({
      declaration: createDeclaration({
        folderPaths: ['Alpha/assets'],
        relativePaths: ['Alpha/diagram.png']
      }),
      otherDeclarations: []
    });

    expect(paths).toEqual(['Alpha/diagram.png', 'Alpha/assets']);
  });

  it('should take the sidecar note with its main file', () => {
    const paths = planBundleDeletion({
      declaration: createDeclaration({
        declaringPath: 'Alpha/report.html.md',
        mainPath: 'Alpha/report.html'
      }),
      otherDeclarations: []
    });

    expect(paths).toEqual(['Alpha/report.html.md']);
  });

  /*
   * The invariant the whole delete path exists to hold.
   */
  it('should spare a dependent another bundle also declares', () => {
    const paths = planBundleDeletion({
      declaration: createDeclaration({ rootedPaths: ['Shared/logo.png'] }),
      otherDeclarations: [createDeclaration({
        declaringPath: 'Beta/beta.md',
        rootedPaths: ['Shared/logo.png']
      })]
    });

    expect(paths).toEqual([]);
  });

  it('should spare a folder another bundle claims a file inside', () => {
    const paths = planBundleDeletion({
      declaration: createDeclaration({ folderPaths: ['Alpha/assets'] }),
      otherDeclarations: [createDeclaration({
        declaringPath: 'Beta/beta.md',
        rootedPaths: ['Alpha/assets/shared.png']
      })]
    });

    expect(paths).toEqual([]);
  });

  it('should spare a declaring note another bundle declares', () => {
    const paths = planBundleDeletion({
      declaration: createDeclaration({
        declaringPath: 'Alpha/report.html.md',
        mainPath: 'Alpha/report.html'
      }),
      otherDeclarations: [createDeclaration({
        declaringPath: 'Beta/beta.md',
        rootedPaths: ['Alpha/report.html.md']
      })]
    });

    expect(paths).toEqual([]);
  });

  it('should still take a folder no other bundle reaches into', () => {
    const paths = planBundleDeletion({
      declaration: createDeclaration({ folderPaths: ['Alpha/assets'] }),
      otherDeclarations: [createDeclaration({
        declaringPath: 'Beta/beta.md',
        rootedPaths: ['Alpha/assets-other/shared.png']
      })]
    });

    expect(paths).toEqual(['Alpha/assets']);
  });
});

describe('the vault operations', () => {
  let app: App;

  beforeEach(() => {
    app = App.createConfigured__();
    castTo<AppWithPlugins>(app).plugins = { getPlugin: (): null => null };
  });

  function readFile(path: string): string {
    const file = app.vault.getFileByPath(path);
    if (!file) {
      throw new Error(`The test vault has no ${path}`);
    }
    return app.vault.readSync__(file);
  }

  function createFile(path: string, content = ''): void {
    const slashIndex = path.lastIndexOf('/');
    if (slashIndex > 0) {
      app.vault.createFolderSync__(path.slice(0, slashIndex));
    }
    app.vault.createSync__(path, content);
  }

  describe('applyBundleMoves', () => {
    it('should perform every planned move', async () => {
      createFile('Alpha/assets/diagram.png');
      app.vault.createFolderSync__('Beta');

      await applyBundleMoves({
        app: app.asOriginalType__(),
        moves: [{ newPath: 'Beta/diagram.png', oldPath: 'Alpha/assets/diagram.png' }]
      });

      expect(app.vault.getFileByPath('Beta/diagram.png')).not.toBeNull();
      expect(app.vault.getFileByPath('Alpha/assets/diagram.png')).toBeNull();
    });

    it('should do nothing at all for an empty plan', async () => {
      createFile('Alpha/assets/diagram.png');

      await applyBundleMoves({ app: app.asOriginalType__(), moves: [] });

      expect(app.vault.getFileByPath('Alpha/assets/diagram.png')).not.toBeNull();
    });
  });

  describe('trashBundlePaths', () => {
    /*
     * Asserted against the ADAPTER rather than the vault index: a soft-delete stages the file through
     * `vault.adapter`, and it is Obsidian's own watcher — which the mock has no counterpart for — that then
     * drops a dot-prefixed path from the index.
     */
    it('should trash every planned path', async () => {
      createFile('Alpha/diagram.png');

      await trashBundlePaths({ app: app.asOriginalType__(), paths: ['Alpha/diagram.png'] });

      expect(await app.vault.adapter.exists('Alpha/diagram.png')).toBe(false);
    });

    it('should do nothing at all for an empty plan', async () => {
      createFile('Alpha/diagram.png');

      await trashBundlePaths({ app: app.asOriginalType__(), paths: [] });

      expect(await app.vault.adapter.exists('Alpha/diagram.png')).toBe(true);
    });
  });

  describe('rewriteBundleDeclaration', () => {
    it('should restore the anchoring Obsidian stripped', async () => {
      createFile(ALPHA_PATH, '---\nfile-bundles:\n  files:\n    - "[[diagram.png]]"\n---\n\nAlpha.\n');
      createFile('Alpha/assets/diagram.png');

      await rewriteBundleDeclaration({
        app: app.asOriginalType__(),
        declaration: createDeclaration({ relativePaths: ['Alpha/assets/diagram.png'] }),
        frontmatterKey: FRONTMATTER_KEY
      });

      expect(readFile(ALPHA_PATH)).toContain('[[./assets/diagram.png]]');
    });

    it('should keep the rest of the frontmatter and the body', async () => {
      createFile(ALPHA_PATH, '---\ntitle: Alpha\nfile-bundles:\n  files: []\n---\n\nAlpha body.\n');
      createFile('Alpha/assets/diagram.png');

      await rewriteBundleDeclaration({
        app: app.asOriginalType__(),
        declaration: createDeclaration({ relativePaths: ['Alpha/assets/diagram.png'] }),
        frontmatterKey: FRONTMATTER_KEY
      });

      const content = readFile(ALPHA_PATH);
      expect(content).toContain('title: Alpha');
      expect(content).toContain('Alpha body.');
    });

    it('should write the folders and the per-bundle rename override', async () => {
      createFile(ALPHA_PATH, '---\nfile-bundles: {}\n---\n');
      app.vault.createFolderSync__('Alpha/assets');

      await rewriteBundleDeclaration({
        app: app.asOriginalType__(),
        declaration: createDeclaration({ folderPaths: ['Alpha/assets'], renameDependents: true }),
        frontmatterKey: FRONTMATTER_KEY
      });

      const content = readFile(ALPHA_PATH);
      expect(content).toContain('./assets');
      expect(content).toContain('renameDependents: true');
    });

    it('should name the main file when a sidecar note declares the bundle', async () => {
      createFile('Alpha/report.html.md', '---\nfile-bundles: {}\n---\n');
      createFile('Alpha/report.html');

      await rewriteBundleDeclaration({
        app: app.asOriginalType__(),
        declaration: createDeclaration({
          declaringPath: 'Alpha/report.html.md',
          mainPath: 'Alpha/report.html'
        }),
        frontmatterKey: FRONTMATTER_KEY
      });

      const content = readFile('Alpha/report.html.md');
      expect(content).toContain('main:');
      expect(content).toContain('./report.html');
    });

    it('should root the main file when it lives outside the declaring note folder', async () => {
      createFile('Alpha/report.html.md', '---\nfile-bundles: {}\n---\n');
      createFile('Shared/report.html');

      await rewriteBundleDeclaration({
        app: app.asOriginalType__(),
        declaration: createDeclaration({
          declaringPath: 'Alpha/report.html.md',
          mainPath: 'Shared/report.html'
        }),
        frontmatterKey: FRONTMATTER_KEY
      });

      expect(readFile('Alpha/report.html.md')).toContain('/Shared/report.html');
    });
  });
});
