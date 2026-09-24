import { App } from 'obsidian-test-mocks/obsidian';
import {
  beforeEach,
  describe,
  expect,
  it
} from 'vitest';

import type {
  BundleDeclaration,
  BundleMember
} from './bundle-declaration.ts';

import {
  BundleDeclarationProblemReason,
  BundleMemberAnchoring,
  BundleMemberKind,
  formatBundleMemberEntry,
  parseBundleDeclaration
} from './bundle-declaration.ts';

/**
 * The subset of `App` the folder-note resolution reads. `resolveFolderNoteConfig` asks the installed
 * `folder-notes` plugin for its configuration, so the strict mock has to answer — returning `null` is what
 * makes it fall back to the built-in convention (a note named after its folder, inside it).
 */
const DECLARING_PATH = 'Alpha/main.md';
const FRONTMATTER_KEY = 'file-bundles';

describe('parseBundleDeclaration', () => {
  let app: App;

  beforeEach(() => {
    app = App.createConfigured__();
  });

  function parse(declaration: unknown, declaringPath = DECLARING_PATH): ReturnType<typeof parseBundleDeclaration> {
    return parseBundleDeclaration({
      app: app.asOriginalType__(),
      declaringPath,
      frontmatter: { [FRONTMATTER_KEY]: declaration },
      frontmatterKey: FRONTMATTER_KEY
    });
  }

  describe('when there is nothing to parse', () => {
    it('should answer null for frontmatter without the key', () => {
      const result = parseBundleDeclaration({
        app: app.asOriginalType__(),
        declaringPath: DECLARING_PATH,
        frontmatter: { title: 'Alpha' },
        frontmatterKey: FRONTMATTER_KEY
      });

      expect(result.declaration).toBeNull();
      expect(result.problems).toEqual([]);
    });

    it('should answer null for frontmatter that is not an object', () => {
      const result = parseBundleDeclaration({
        app: app.asOriginalType__(),
        declaringPath: DECLARING_PATH,
        frontmatter: undefined,
        frontmatterKey: FRONTMATTER_KEY
      });

      expect(result.declaration).toBeNull();
      expect(result.problems).toEqual([]);
    });

    it('should report a declaration that is not a mapping', () => {
      const result = parse('just a string');

      expect(result.declaration).toBeNull();
      expect(result.problems).toEqual([{
        entry: 'just a string',
        key: '',
        reason: BundleDeclarationProblemReason.DeclarationIsNotAnObject
      }]);
    });
  });

  describe('main', () => {
    it('should default to the declaring note', () => {
      const result = parse({});

      expect(result.declaration?.mainPath).toBe(DECLARING_PATH);
      expect(result.declaration?.declaringPath).toBe(DECLARING_PATH);
    });

    it('should take an explicit relative link, which is how a binary main gets a sidecar note', () => {
      const result = parse({ main: '[[./alpha.jpg]]' });

      expect(result.declaration?.mainPath).toBe('Alpha/alpha.jpg');
      expect(result.declaration?.declaringPath).toBe(DECLARING_PATH);
      expect(result.problems).toEqual([]);
    });

    it('should take an explicit rooted link', () => {
      const result = parse({ main: '[[/Shared/alpha.jpg]]' });

      expect(result.declaration?.mainPath).toBe('Shared/alpha.jpg');
    });

    it('should fall back to the declaring note when main is a URL', () => {
      const result = parse({ main: '[report](https://example.com/report.html)' });

      expect(result.declaration?.mainPath).toBe(DECLARING_PATH);
      expect(result.problems[0]?.reason).toBe(BundleDeclarationProblemReason.EntryIsExternal);
    });

    it('should fall back to the declaring note when main names the vault root', () => {
      const result = parse({ main: '/' });

      expect(result.declaration?.mainPath).toBe(DECLARING_PATH);
      expect(result.problems).toEqual([{
        entry: '/',
        key: 'main',
        reason: BundleDeclarationProblemReason.EntryIsTheVaultRoot
      }]);
    });

    it('should fall back to the declaring note when main is not a string', () => {
      const result = parse({ main: 42 });

      expect(result.declaration?.mainPath).toBe(DECLARING_PATH);
      expect(result.problems).toEqual([{
        entry: '42',
        key: 'main',
        reason: BundleDeclarationProblemReason.EntryIsNotAString
      }]);
    });
  });

  describe('files', () => {
    it('should resolve a relative wikilink against the declaring note', () => {
      const result = parse({ files: ['[[./assets/diagram.png]]'] });

      expect(result.declaration?.members).toEqual<BundleMember[]>([{
        anchoring: BundleMemberAnchoring.Relative,
        isAnchorPrefixMissing: false,
        isWikilink: true,
        kind: BundleMemberKind.File,
        path: 'Alpha/assets/diagram.png'
      }]);
    });

    it('should resolve a rooted wikilink against the vault root', () => {
      const result = parse({ files: ['[[/Shared/logo.png]]'] });

      expect(result.declaration?.members).toEqual<BundleMember[]>([{
        anchoring: BundleMemberAnchoring.Rooted,
        isAnchorPrefixMissing: false,
        isWikilink: true,
        kind: BundleMemberKind.File,
        path: 'Shared/logo.png'
      }]);
    });

    it('should accept the markdown link form as readily as the wikilink form, and remember which it was', () => {
      const result = parse({ files: ['[./notes.pdf](./notes.pdf)'] });

      expect(result.declaration?.members).toEqual<BundleMember[]>([{
        anchoring: BundleMemberAnchoring.Relative,
        isAnchorPrefixMissing: false,
        isWikilink: false,
        kind: BundleMemberKind.File,
        path: 'Alpha/notes.pdf'
      }]);
    });

    it('should drop a subpath, since a bundle member is a file and not a heading in one', () => {
      const result = parse({ files: ['[[./notes.md#Section]]'] });

      expect(result.declaration?.members[0]?.path).toBe('Alpha/notes.md');
    });

    it('should accept a single entry that is not wrapped in a list', () => {
      const result = parse({ files: '[[./assets/diagram.png]]' });

      expect(result.declaration?.members).toHaveLength(1);
    });

    it('should reject an external link', () => {
      const result = parse({ files: ['[logo](https://example.com/logo.png)'] });

      expect(result.declaration?.members).toEqual([]);
      expect(result.problems).toEqual([{
        entry: '[logo](https://example.com/logo.png)',
        key: 'files.0',
        reason: BundleDeclarationProblemReason.EntryIsExternal
      }]);
    });

    it('should reject a file URL', () => {
      const result = parse({ files: ['[notes](file:///C:/notes.pdf)'] });

      expect(result.declaration?.members).toEqual([]);
      expect(result.problems[0]?.reason).toBe(BundleDeclarationProblemReason.EntryIsExternal);
    });

    it('should report a non-string entry', () => {
      const result = parse({ files: [42] });

      expect(result.declaration?.members).toEqual([]);
      expect(result.problems).toEqual([{
        entry: '42',
        key: 'files.0',
        reason: BundleDeclarationProblemReason.EntryIsNotAString
      }]);
    });

    it('should report an entry with no value at all, as an empty list item leaves behind', () => {
      const result = parse({ files: [undefined] });

      expect(result.problems).toEqual([{
        entry: '',
        key: 'files.0',
        reason: BundleDeclarationProblemReason.EntryIsNotAString
      }]);
    });

    /*
     * The format asks for links here, because a link is what Obsidian's cache indexes. A plain anchored path
     * still says exactly which file is meant, so it is accepted rather than rejected — it simply forfeits
     * the indexing a link would have got.
     */
    it('should accept an anchored path written where a link was expected', () => {
      const result = parse({ files: ['./assets/diagram.png'] });

      expect(result.declaration?.members).toEqual<BundleMember[]>([{
        anchoring: BundleMemberAnchoring.Relative,
        isAnchorPrefixMissing: false,
        isWikilink: true,
        kind: BundleMemberKind.File,
        path: 'Alpha/assets/diagram.png'
      }]);
    });

    it('should read a link that climbs out of the declaring note folder as relative', () => {
      const result = parse({ files: ['[[../Beta/diagram.png]]'] });

      expect(result.declaration?.members[0]?.anchoring).toBe(BundleMemberAnchoring.Relative);
      expect(result.declaration?.members[0]?.isAnchorPrefixMissing).toBe(false);
      expect(result.declaration?.members[0]?.path).toBe('Beta/diagram.png');
    });

    it('should accept a rooted path written where a link was expected', () => {
      const result = parse({ files: ['/Shared/logo.png'] });

      expect(result.declaration?.members[0]?.anchoring).toBe(BundleMemberAnchoring.Rooted);
      expect(result.declaration?.members[0]?.path).toBe('Shared/logo.png');
    });

    /*
     * The same root hazard as the `folders` one, reached through the sibling key: `/` goes through the same
     * path math whichever key it sits under, so rejecting it for folders alone would have left it live one
     * line over.
     */
    it('should reject an entry naming the vault root', () => {
      const result = parse({ files: ['/'] });

      expect(result.declaration?.members).toEqual([]);
      expect(result.problems).toEqual([{
        entry: '/',
        key: 'files.0',
        reason: BundleDeclarationProblemReason.EntryIsTheVaultRoot
      }]);
    });
  });

  describe('a link without the mandatory prefix', () => {
    /*
     * Obsidian's own rename bookkeeping rewrites a frontmatter link into its shortest-path style and strips
     * the prefix — measured against 1.14.0 — so this shape is what a declaration looks like AFTER an
     * ordinary drag in the File Explorer. It is reported as a problem so a hand-typed bare link is caught,
     * and still resolved so the re-anchoring pass has something to heal.
     */
    it('should report the missing prefix and still resolve the member', () => {
      app.vault.createFolderSync__('Alpha/assets');
      app.vault.createSync__('Alpha/assets/diagram.png', '');

      const result = parse({ files: ['[[diagram.png]]'] });

      expect(result.declaration?.members).toEqual<BundleMember[]>([{
        anchoring: BundleMemberAnchoring.Relative,
        isAnchorPrefixMissing: true,
        isWikilink: true,
        kind: BundleMemberKind.File,
        path: 'Alpha/assets/diagram.png'
      }]);
      expect(result.problems).toEqual([{
        entry: '[[diagram.png]]',
        key: 'files.0',
        reason: BundleDeclarationProblemReason.MissingAnchorPrefix
      }]);
    });

    it('should infer rooted anchoring for a member outside the declaring note folder', () => {
      app.vault.createFolderSync__('Shared');
      app.vault.createSync__('Shared/logo.png', '');

      const result = parse({ files: ['[[logo.png]]'] });

      expect(result.declaration?.members[0]?.anchoring).toBe(BundleMemberAnchoring.Rooted);
      expect(result.declaration?.members[0]?.path).toBe('Shared/logo.png');
    });

    it('should infer relative anchoring for a declaring note at the vault root', () => {
      app.vault.createSync__('logo.png', '');

      const result = parse({ files: ['[[logo.png]]'] }, 'main.md');

      expect(result.declaration?.members[0]?.anchoring).toBe(BundleMemberAnchoring.Relative);
    });

    /*
     * A bare `..` is missing its prefix AND names the vault root. Only the fatal problem is reported: the
     * missing-prefix branch answers with a member the caller may re-anchor, and there is nothing here worth
     * re-anchoring to.
     */
    it('should report a bare .. as the vault root rather than as a missing prefix', () => {
      const result = parse({ files: ['..'] });

      expect(result.declaration?.members).toEqual([]);
      expect(result.problems).toEqual([{
        entry: '..',
        key: 'files.0',
        reason: BundleDeclarationProblemReason.EntryIsTheVaultRoot
      }]);
    });
  });

  describe('folders', () => {
    it('should resolve a relative path against the declaring note', () => {
      const result = parse({ folders: ['./assets'] });

      expect(result.declaration?.members).toEqual<BundleMember[]>([{
        anchoring: BundleMemberAnchoring.Relative,
        isAnchorPrefixMissing: false,
        isWikilink: false,
        kind: BundleMemberKind.Folder,
        path: 'Alpha/assets'
      }]);
    });

    /*
     * `../` is explicitly relative too — and it is the form this plugin's own re-anchoring writes once a
     * main file has moved away from a dependent, so refusing it would make the plugin reject its own output.
     */
    it('should accept a path that climbs out of the declaring note folder', () => {
      const result = parse({ folders: ['../Beta/assets'] });

      expect(result.declaration?.members).toEqual<BundleMember[]>([{
        anchoring: BundleMemberAnchoring.Relative,
        isAnchorPrefixMissing: false,
        isWikilink: false,
        kind: BundleMemberKind.Folder,
        path: 'Beta/assets'
      }]);
    });

    it('should resolve a rooted path against the vault root', () => {
      const result = parse({ folders: ['/Shared/brand'] });

      expect(result.declaration?.members).toEqual<BundleMember[]>([{
        anchoring: BundleMemberAnchoring.Rooted,
        isAnchorPrefixMissing: false,
        isWikilink: false,
        kind: BundleMemberKind.Folder,
        path: 'Shared/brand'
      }]);
    });

    /*
     * A folder path carries no resolution machinery at all: unlike a link, nothing can tell whether a bare
     * `assets` means one beside the declaring note or one at the vault root, and a sidecar can live
     * anywhere. So this one really is rejected rather than guessed at.
     */
    it('should reject a bare path outright', () => {
      const result = parse({ folders: ['assets'] });

      expect(result.declaration?.members).toEqual([]);
      expect(result.problems).toEqual([{
        entry: 'assets',
        key: 'folders.0',
        reason: BundleDeclarationProblemReason.MissingAnchorPrefix
      }]);
    });

    /*
     * A trailing slash is how a person writes a folder and is not part of its path. Left on, the member
     * named no folder the vault has and the whole entry was silently inert — the near miss that shares its
     * cause with the vault-root entries below.
     */
    it('should drop a trailing slash from a rooted path', () => {
      const result = parse({ folders: ['/Shared/brand/'] });

      expect(result.declaration?.members[0]?.path).toBe('Shared/brand');
      expect(result.problems).toEqual([]);
    });

    it('should read a lone ./ as the declaring note own folder', () => {
      const result = parse({ folders: ['./'] });

      expect(result.declaration?.members).toEqual<BundleMember[]>([{
        anchoring: BundleMemberAnchoring.Relative,
        isAnchorPrefixMissing: false,
        isWikilink: false,
        kind: BundleMemberKind.Folder,
        path: 'Alpha'
      }]);
    });

    it('should read a lone ../ as the folder above the declaring note', () => {
      const result = parse({ folders: ['../'] }, 'Alpha/Beta/main.md');

      expect(result.declaration?.members[0]?.path).toBe('Alpha');
      expect(result.problems).toEqual([]);
    });

    /*
     * The entry that made this rule necessary. `/` resolved to `.`, which is the vault root, and every
     * layer below took it for an ordinary folder member: the index held it, and a deletion would have
     * handed the whole vault to the trash. Rejecting it here is what stops anything downstream having to
     * defend against it.
     */
    it('should reject a rooted path naming the vault root', () => {
      const result = parse({ folders: ['/'] });

      expect(result.declaration?.members).toEqual([]);
      expect(result.problems).toEqual([{
        entry: '/',
        key: 'folders.0',
        reason: BundleDeclarationProblemReason.EntryIsTheVaultRoot
      }]);
    });

    /*
     * `//` is the one entry whose path math leaves NOTHING rather than `.`: `normalizePath` answers `/`,
     * and trimming the trailing slash empties it. An empty path is the root, which is why the canonical
     * form is settled before the root is looked for and not after.
     */
    it('should reject a rooted path that empties to nothing', () => {
      const result = parse({ folders: ['//'] });

      expect(result.declaration?.members).toEqual([]);
      expect(result.problems).toEqual([{
        entry: '//',
        key: 'folders.0',
        reason: BundleDeclarationProblemReason.EntryIsTheVaultRoot
      }]);
    });

    it('should reject a lone ./ declared by a note at the top of the vault, which is the same root', () => {
      const result = parse({ folders: ['./'] }, 'main.md');

      expect(result.declaration?.members).toEqual([]);
      expect(result.problems).toEqual([{
        entry: './',
        key: 'folders.0',
        reason: BundleDeclarationProblemReason.EntryIsTheVaultRoot
      }]);
    });

    it('should reject a path that climbs past the vault root', () => {
      const result = parse({ folders: ['../..'] });

      expect(result.declaration?.members).toEqual([]);
      expect(result.problems).toEqual([{
        entry: '../..',
        key: 'folders.0',
        reason: BundleDeclarationProblemReason.EntryIsOutsideTheVault
      }]);
    });

    it('should reject a rooted path that climbs past the vault root', () => {
      const result = parse({ folders: ['/../Shared'] });

      expect(result.declaration?.members).toEqual([]);
      expect(result.problems).toEqual([{
        entry: '/../Shared',
        key: 'folders.0',
        reason: BundleDeclarationProblemReason.EntryIsOutsideTheVault
      }]);
    });

    it('should read a link as the folder its folder note describes', () => {
      app.vault.createFolderSync__('Alpha/assets');
      app.vault.createFolderSync__('Alpha/assets/alpha');
      app.vault.createSync__('Alpha/assets/alpha/alpha.md', '');

      const result = parse({ folders: ['[[./assets/alpha/alpha]]'] });

      expect(result.declaration?.members).toEqual<BundleMember[]>([{
        anchoring: BundleMemberAnchoring.Relative,
        isAnchorPrefixMissing: false,
        isWikilink: true,
        kind: BundleMemberKind.Folder,
        path: 'Alpha/assets/alpha'
      }]);
    });

    it('should reject a link to a note that is nobody\'s folder note', () => {
      app.vault.createFolderSync__('Alpha/assets');
      app.vault.createSync__('Alpha/assets/ordinary.md', '');

      const result = parse({ folders: ['[[./assets/ordinary]]'] });

      expect(result.declaration?.members).toEqual([]);
      expect(result.problems).toEqual([{
        entry: '[[./assets/ordinary]]',
        key: 'folders.0',
        reason: BundleDeclarationProblemReason.FolderIsNotNamedByItsFolderNote
      }]);
    });

    it('should reject a link to a note that does not exist', () => {
      const result = parse({ folders: ['[[./assets/missing]]'] });

      expect(result.declaration?.members).toEqual([]);
      expect(result.problems[0]?.reason).toBe(BundleDeclarationProblemReason.FolderIsNotNamedByItsFolderNote);
    });

    it('should reject an external link', () => {
      const result = parse({ folders: ['[assets](https://example.com/assets)'] });

      expect(result.declaration?.members).toEqual([]);
      expect(result.problems[0]?.reason).toBe(BundleDeclarationProblemReason.EntryIsExternal);
    });

    it('should report a non-string entry', () => {
      const result = parse({ folders: [42] });

      expect(result.problems).toEqual([{
        entry: '42',
        key: 'folders.0',
        reason: BundleDeclarationProblemReason.EntryIsNotAString
      }]);
    });
  });

  describe('renameDependents', () => {
    it('should be undefined when the declaration does not say, leaving the plugin setting to decide', () => {
      const result = parse({});

      expect(result.declaration?.renameDependents).toBeUndefined();
    });

    it('should carry the declared value', () => {
      expect(parse({ renameDependents: true }).declaration?.renameDependents).toBe(true);
      expect(parse({ renameDependents: false }).declaration?.renameDependents).toBe(false);
    });

    it('should ignore a non-boolean value', () => {
      const result = parse({ renameDependents: 'yes' });

      expect(result.declaration?.renameDependents).toBeUndefined();
    });
  });

  it('should keep every declared member, in declaration order, across both keys', () => {
    const result = parse({
      files: ['[[./assets/diagram.png]]', '[[/Shared/logo.png]]'],
      folders: ['./assets']
    });

    expect(result.declaration).toMatchObject<Partial<BundleDeclaration>>({
      declaringPath: DECLARING_PATH,
      mainPath: DECLARING_PATH
    });
    expect(result.declaration?.members.map((member) => member.path)).toEqual([
      'Alpha/assets/diagram.png',
      'Shared/logo.png',
      'Alpha/assets'
    ]);
    expect(result.problems).toEqual([]);
  });
});

describe('formatBundleMemberEntry', () => {
  let app: App;

  beforeEach(() => {
    app = App.createConfigured__();
    // A link is generated for a member that exists; the library only reaches for the vault's raw file map
    // when asked to name a file that does not.
    app.vault.createFolderSync__('Alpha/assets');
    app.vault.createSync__('Alpha/assets/diagram.png', '');
    app.vault.createFolderSync__('Shared');
    app.vault.createSync__('Shared/logo.png', '');
  });

  function format(member: BundleMember, declaringPath = DECLARING_PATH): string {
    return formatBundleMemberEntry({
      app: app.asOriginalType__(),
      declaringPath,
      member
    });
  }

  it('should render a relative folder member of a note at the vault root', () => {
    expect(format(
      {
        anchoring: BundleMemberAnchoring.Relative,
        isAnchorPrefixMissing: false,
        isWikilink: true,
        kind: BundleMemberKind.Folder,
        path: 'assets'
      },
      'main.md'
    )).toBe('./assets');
  });

  /*
   * A relative member that does not sit under the declaring note's folder has to climb out of it, and `../`
   * is explicitly relative just as `./` is. This is the shape the plugin's own re-anchoring produces after a
   * main file moves away from a dependent, so it has to round-trip.
   */
  it('should climb out of the declaring note folder for a member that sits outside it', () => {
    expect(format({
      anchoring: BundleMemberAnchoring.Relative,
      isAnchorPrefixMissing: false,
      isWikilink: true,
      kind: BundleMemberKind.Folder,
      path: 'Beta/assets'
    })).toBe('../Beta/assets');
  });

  it('should render a relative folder member as a dot-prefixed path', () => {
    expect(format({
      anchoring: BundleMemberAnchoring.Relative,
      isAnchorPrefixMissing: false,
      isWikilink: true,
      kind: BundleMemberKind.Folder,
      path: 'Alpha/assets'
    })).toBe('./assets');
  });

  it('should render a rooted folder member as a slash-prefixed path', () => {
    expect(format({
      anchoring: BundleMemberAnchoring.Rooted,
      isAnchorPrefixMissing: false,
      isWikilink: true,
      kind: BundleMemberKind.Folder,
      path: 'Shared/brand'
    })).toBe('/Shared/brand');
  });

  it('should render a relative file member as a dot-prefixed link', () => {
    expect(format({
      anchoring: BundleMemberAnchoring.Relative,
      isAnchorPrefixMissing: false,
      isWikilink: true,
      kind: BundleMemberKind.File,
      path: 'Alpha/assets/diagram.png'
    })).toContain('./assets/diagram.png');
  });

  it('should render a rooted file member as a slash-prefixed link', () => {
    expect(format({
      anchoring: BundleMemberAnchoring.Rooted,
      isAnchorPrefixMissing: false,
      isWikilink: true,
      kind: BundleMemberKind.File,
      path: 'Shared/logo.png'
    })).toContain('/Shared/logo.png');
  });

  it('should render the markdown link form when the declaration used it', () => {
    const entry = format({
      anchoring: BundleMemberAnchoring.Relative,
      isAnchorPrefixMissing: false,
      isWikilink: false,
      kind: BundleMemberKind.File,
      path: 'Alpha/assets/diagram.png'
    });

    expect(entry.startsWith('[')).toBe(true);
    expect(entry).toContain('](./assets/diagram.png)');
  });
});
