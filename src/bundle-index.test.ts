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
import { BundleIndex } from './bundle-index.ts';

interface DeclarationOverrides {
  readonly declaringPath?: string;
  readonly folderPaths?: readonly string[];
  readonly mainPath?: string;
  readonly memberPaths?: readonly string[];
}

const ALPHA_PATH = 'Alpha/alpha.md';

function createDeclaration(overrides: DeclarationOverrides = {}): BundleDeclaration {
  const declaringPath = overrides.declaringPath ?? ALPHA_PATH;

  return {
    declaringPath,
    mainPath: overrides.mainPath ?? declaringPath,
    members: [
      ...(overrides.memberPaths ?? []).map((path) => ({
        anchoring: BundleMemberAnchoring.Relative,
        isAnchorPrefixMissing: false,
        isWikilink: true,
        kind: BundleMemberKind.File,
        path
      })),
      ...(overrides.folderPaths ?? []).map((path) => ({
        anchoring: BundleMemberAnchoring.Relative,
        isAnchorPrefixMissing: false,
        isWikilink: true,
        kind: BundleMemberKind.Folder,
        path
      }))
    ]
  };
}

describe('BundleIndex', () => {
  let index: BundleIndex;

  beforeEach(() => {
    index = new BundleIndex();
  });

  describe('recording declarations', () => {
    it('should answer nothing before anything is recorded', () => {
      expect(index.getDeclaration(ALPHA_PATH)).toBeNull();
      expect(index.getDeclarations()).toEqual([]);
      expect(index.getDeclarationsOfMain(ALPHA_PATH)).toEqual([]);
      expect(index.getDeclarationsOfMember('Alpha/assets/diagram.png')).toEqual([]);
    });

    it('should answer the declaration a note carries', () => {
      const declaration = createDeclaration({ memberPaths: ['Alpha/assets/diagram.png'] });
      index.setDeclaration(declaration);

      expect(index.getDeclaration(ALPHA_PATH)).toEqual(declaration);
      expect(index.getDeclarations()).toEqual([declaration]);
    });

    it('should replace what a note declared before, forgetting the members it dropped', () => {
      index.setDeclaration(createDeclaration({ memberPaths: ['Alpha/assets/old.png'] }));
      index.setDeclaration(createDeclaration({ memberPaths: ['Alpha/assets/new.png'] }));

      expect(index.getDeclarationsOfMember('Alpha/assets/old.png')).toEqual([]);
      expect(index.getDeclarationsOfMember('Alpha/assets/new.png')).toHaveLength(1);
      expect(index.getDeclarations()).toHaveLength(1);
    });

    it('should forget a declaration when its note goes', () => {
      index.setDeclaration(createDeclaration({ memberPaths: ['Alpha/assets/diagram.png'] }));
      index.removeDeclaration(ALPHA_PATH);

      expect(index.getDeclaration(ALPHA_PATH)).toBeNull();
      expect(index.getDeclarationsOfMain(ALPHA_PATH)).toEqual([]);
      expect(index.getDeclarationsOfMember('Alpha/assets/diagram.png')).toEqual([]);
    });

    /*
     * A declaration listing the same file twice is a user typo, not a corrupt state: the second removal
     * finds the entry the first one already emptied out, and has to leave the index intact.
     */
    it('should survive a declaration that lists the same member twice', () => {
      index.setDeclaration(createDeclaration({
        memberPaths: ['Alpha/assets/diagram.png', 'Alpha/assets/diagram.png']
      }));
      index.removeDeclaration(ALPHA_PATH);

      expect(index.getDeclarations()).toEqual([]);
      expect(index.getDeclarationsOfMember('Alpha/assets/diagram.png')).toEqual([]);
    });

    it('should ignore removing a note that declared nothing', () => {
      index.removeDeclaration('Beta/beta.md');

      expect(index.getDeclarations()).toEqual([]);
    });

    it('should forget everything on clear', () => {
      index.setDeclaration(createDeclaration({ folderPaths: ['Alpha/assets'] }));
      index.clear();

      expect(index.getDeclarations()).toEqual([]);
      expect(index.getDeclarationsOfMember('Alpha/assets/nested/deep.png')).toEqual([]);
    });
  });

  describe('the main file', () => {
    it('should treat the declaring note as its own main when the declaration is inline', () => {
      index.setDeclaration(createDeclaration());

      expect(index.getDeclarationsOfMain(ALPHA_PATH)).toHaveLength(1);
    });

    /*
     * The sidecar shape: a binary main cannot carry frontmatter, so a note declares the bundle on its
     * behalf. An operation on the binary has to find the bundle, which is what this lookup is for.
     */
    it('should answer the sidecar declaration when asked about the binary it names', () => {
      index.setDeclaration(createDeclaration({
        declaringPath: 'Alpha/report.html.md',
        mainPath: 'Alpha/report.html'
      }));

      expect(index.getDeclarationsOfMain('Alpha/report.html')).toHaveLength(1);
      expect(index.getDeclarationsOfMain('Alpha/report.html.md')).toEqual([]);
    });

    it('should report both declarations when two notes name the same main file', () => {
      index.setDeclaration(createDeclaration({ declaringPath: 'Alpha/one.md', mainPath: 'Alpha/report.html' }));
      index.setDeclaration(createDeclaration({ declaringPath: 'Alpha/two.md', mainPath: 'Alpha/report.html' }));

      expect(index.getDeclarationsOfMain('Alpha/report.html').map((declaration) => declaration.declaringPath))
        .toEqual(['Alpha/one.md', 'Alpha/two.md']);
    });
  });

  describe('the reverse lookup', () => {
    it('should answer the bundle that declares a file directly', () => {
      index.setDeclaration(createDeclaration({ memberPaths: ['Alpha/assets/diagram.png'] }));

      expect(index.getDeclarationsOfMember('Alpha/assets/diagram.png').map((declaration) => declaration.declaringPath))
        .toEqual([ALPHA_PATH]);
    });

    it('should answer for a file covered by a declared folder', () => {
      index.setDeclaration(createDeclaration({ folderPaths: ['Alpha/assets'] }));

      expect(index.getDeclarationsOfMember('Alpha/assets/diagram.png')).toHaveLength(1);
      expect(index.getDeclarationsOfMember('Alpha/assets/nested/deep/photo.png')).toHaveLength(1);
    });

    it('should not answer for a sibling of a declared folder', () => {
      index.setDeclaration(createDeclaration({ folderPaths: ['Alpha/assets'] }));

      expect(index.getDeclarationsOfMember('Alpha/assets-other/diagram.png')).toEqual([]);
      expect(index.getDeclarationsOfMember('Alpha/other.png')).toEqual([]);
    });

    it('should not treat a declared FILE as covering paths beneath it', () => {
      index.setDeclaration(createDeclaration({ memberPaths: ['Alpha/assets'] }));

      expect(index.getDeclarationsOfMember('Alpha/assets/diagram.png')).toEqual([]);
    });

    /*
     * This is the lookup the delete rule turns on: a dependent two bundles both declare must survive the
     * deletion of either one of them.
     */
    it('should name every bundle claiming a shared dependent, without duplicating one', () => {
      index.setDeclaration(createDeclaration({
        declaringPath: 'Alpha/alpha.md',
        folderPaths: ['Shared'],
        memberPaths: ['Shared/logo.png']
      }));
      index.setDeclaration(createDeclaration({
        declaringPath: 'Beta/beta.md',
        memberPaths: ['Shared/logo.png']
      }));

      expect(index.getDeclarationsOfMember('Shared/logo.png').map((declaration) => declaration.declaringPath))
        .toEqual(['Alpha/alpha.md', 'Beta/beta.md']);
    });

    it('should keep a shared dependent claimed when only one of its bundles goes', () => {
      index.setDeclaration(createDeclaration({
        declaringPath: 'Alpha/alpha.md',
        memberPaths: ['Shared/logo.png']
      }));
      index.setDeclaration(createDeclaration({
        declaringPath: 'Beta/beta.md',
        memberPaths: ['Shared/logo.png']
      }));

      index.removeDeclaration('Alpha/alpha.md');

      expect(index.getDeclarationsOfMember('Shared/logo.png').map((declaration) => declaration.declaringPath))
        .toEqual(['Beta/beta.md']);
    });

    it('should answer for a member at the vault root', () => {
      index.setDeclaration(createDeclaration({ memberPaths: ['logo.png'] }));

      expect(index.getDeclarationsOfMember('logo.png')).toHaveLength(1);
    });
  });

  describe('isDependent', () => {
    it('should be true for a declared dependent', () => {
      index.setDeclaration(createDeclaration({ memberPaths: ['Alpha/assets/diagram.png'] }));

      expect(index.isDependent('Alpha/assets/diagram.png')).toBe(true);
    });

    it('should be false for the declaring note and for the main file', () => {
      index.setDeclaration(createDeclaration({
        declaringPath: 'Alpha/report.html.md',
        mainPath: 'Alpha/report.html',
        memberPaths: ['Alpha/report-styles.css']
      }));

      expect(index.isDependent('Alpha/report.html.md')).toBe(false);
      expect(index.isDependent('Alpha/report.html')).toBe(false);
    });

    it('should be false for a file no bundle claims', () => {
      index.setDeclaration(createDeclaration({ memberPaths: ['Alpha/assets/diagram.png'] }));

      expect(index.isDependent('Alpha/unrelated.png')).toBe(false);
    });

    /*
     * A file that is one bundle's dependent and another's main stays visible: hiding it would hide a
     * bundle's own main file, which is the one row the File Explorer must always show.
     */
    it('should be false for a file that is also some bundle\'s main', () => {
      index.setDeclaration(createDeclaration({
        declaringPath: 'Alpha/alpha.md',
        memberPaths: ['Beta/beta.md']
      }));
      index.setDeclaration(createDeclaration({ declaringPath: 'Beta/beta.md' }));

      expect(index.isDependent('Beta/beta.md')).toBe(false);
    });
  });

  describe('getPaths', () => {
    it('should list the main file once when the declaration is inline', () => {
      const declaration = createDeclaration({ memberPaths: ['Alpha/assets/diagram.png'] });

      expect(index.getPaths(declaration)).toEqual({
        memberPaths: ['Alpha/assets/diagram.png'],
        ownPaths: [ALPHA_PATH]
      });
    });

    it('should list the sidecar note alongside the main file', () => {
      const declaration = createDeclaration({
        declaringPath: 'Alpha/report.html.md',
        mainPath: 'Alpha/report.html',
        memberPaths: ['Alpha/report-styles.css']
      });

      expect(index.getPaths(declaration)).toEqual({
        memberPaths: ['Alpha/report-styles.css'],
        ownPaths: ['Alpha/report.html', 'Alpha/report.html.md']
      });
    });
  });

  describe('excluded paths', () => {
    it('should refuse a declaration from an excluded note', () => {
      const excludingIndex = new BundleIndex({ shouldExcludePath: (path): boolean => path.startsWith('Archive/') });
      excludingIndex.setDeclaration(createDeclaration({ declaringPath: 'Archive/old.md' }));

      expect(excludingIndex.getDeclarations()).toEqual([]);
    });

    it('should refuse a declaration whose main file is excluded', () => {
      const excludingIndex = new BundleIndex({ shouldExcludePath: (path): boolean => path.startsWith('Archive/') });
      excludingIndex.setDeclaration(createDeclaration({ mainPath: 'Archive/report.html' }));

      expect(excludingIndex.getDeclarations()).toEqual([]);
    });

    it('should drop an excluded member rather than the whole bundle', () => {
      const excludingIndex = new BundleIndex({ shouldExcludePath: (path): boolean => path.startsWith('Archive/') });
      excludingIndex.setDeclaration(createDeclaration({
        memberPaths: ['Alpha/assets/diagram.png', 'Archive/old.png']
      }));

      expect(excludingIndex.getDeclaration(ALPHA_PATH)?.members.map((member) => member.path))
        .toEqual(['Alpha/assets/diagram.png']);
      expect(excludingIndex.getDeclarationsOfMember('Archive/old.png')).toEqual([]);
    });

    it('should still drop what an earlier declaration recorded when the note becomes excluded', () => {
      let isArchived = false;
      const excludingIndex = new BundleIndex({ shouldExcludePath: (): boolean => isArchived });
      excludingIndex.setDeclaration(createDeclaration({ memberPaths: ['Alpha/assets/diagram.png'] }));

      isArchived = true;
      excludingIndex.setDeclaration(createDeclaration({ memberPaths: ['Alpha/assets/diagram.png'] }));

      expect(excludingIndex.getDeclarations()).toEqual([]);
      expect(excludingIndex.getDeclarationsOfMember('Alpha/assets/diagram.png')).toEqual([]);
    });
  });
});
