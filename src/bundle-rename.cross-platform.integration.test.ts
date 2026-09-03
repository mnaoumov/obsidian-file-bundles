import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

const KEEPING_CONTENT = [
  '---',
  'file-bundles:',
  '  files:',
  '    - "[[./keeping.png]]"',
  '---',
  '',
  'Dependents keep their own names here.',
  ''
].join('\n');

const FOLLOWING_CONTENT = [
  '---',
  'file-bundles:',
  '  files:',
  '    - "[[./following.png]]"',
  '  renameDependents: true',
  '---',
  '',
  'Dependents follow the name here.',
  ''
].join('\n');

describe('Renaming a bundle', () => {
  it('should leave dependents named as they are, unless the bundle asks for them to follow', async () => {
    const result = await evalInObsidian({
      async callback({ app, FOLLOWING_CONTENT: followingContent, KEEPING_CONTENT: keepingContent, lib }) {
        const SETTLE_DELAY_IN_MS = 2000;
        const WAIT_TIMEOUT_IN_MS = 20_000;

        async function ensureFolder(path: string): Promise<void> {
          try {
            await app.vault.createFolder(path);
          } catch {
            // Already there.
          }
        }

        async function create(path: string, content: string): Promise<void> {
          const slashIndex = path.lastIndexOf('/');
          if (slashIndex > 0) {
            await ensureFolder(path.slice(0, slashIndex));
          }
          try {
            await app.vault.create(path, content);
          } catch {
            // Already there.
          }
        }

        async function rename(oldPath: string, newPath: string): Promise<void> {
          const abstractFile = app.vault.getAbstractFileByPath(oldPath);
          if (abstractFile) {
            await app.fileManager.renameFile(abstractFile, newPath);
          }
        }

        await create('RenameTestKeeping/keeping.png', 'keeping');
        await create('RenameTestKeeping/keeping.md', keepingContent);
        await create('RenameTestFollowing/following.png', 'following');
        await create('RenameTestFollowing/following.md', followingContent);

        await lib.waitUntil({
          message: 'both declarations to be parsed',
          predicate: () => {
            const keeping = app.vault.getFileByPath('RenameTestKeeping/keeping.md');
            const following = app.vault.getFileByPath('RenameTestFollowing/following.md');
            return !!keeping && !!following
              && !!app.metadataCache.getFileCache(keeping)?.frontmatter
              && !!app.metadataCache.getFileCache(following)?.frontmatter;
          },
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MS
        });
        await sleep(SETTLE_DELAY_IN_MS);

        await rename('RenameTestKeeping/keeping.md', 'RenameTestKeeping/renamed.md');
        await rename('RenameTestFollowing/following.md', 'RenameTestFollowing/renamed.md');

        await lib.waitUntil({
          message: 'the dependent of the opted-in bundle to follow the new name',
          predicate: () => !!app.vault.getAbstractFileByPath('RenameTestFollowing/renamed.png'),
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MS
        });
        await sleep(SETTLE_DELAY_IN_MS);

        return {
          keepingDependentKeptItsName: !!app.vault.getAbstractFileByPath('RenameTestKeeping/keeping.png'),
          renamedDependentFollowed: !!app.vault.getAbstractFileByPath('RenameTestFollowing/renamed.png')
        };
      },
      input: {
        FOLLOWING_CONTENT,
        KEEPING_CONTENT
      },
      vaultPath: getTemporaryVault().path
    });

    /*
     * The default is deliberate: a dependent is not necessarily named after its main, and renaming one would
     * rename it out from under everything else that links to it.
     */
    expect(result.keepingDependentKeptItsName).toBe(true);
    expect(result.renamedDependentFollowed).toBe(true);
  });
});
