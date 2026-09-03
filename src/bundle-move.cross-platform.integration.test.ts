import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

const MAIN_CONTENT = [
  '---',
  'file-bundles:',
  '  files:',
  '    - "[[./assets/diagram.png]]"',
  '    - "[[/MoveTestShared/logo.png]]"',
  '  folders:',
  '    - ./assets',
  '---',
  '',
  'The main file.',
  ''
].join('\n');

describe('Moving a bundle', () => {
  it('should carry the relative members into the new folder and leave the rooted one where it is', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib, MAIN_CONTENT: mainContent }) {
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

        await create('MoveTestShared/logo.png', 'logo');
        await create('MoveTest/assets/diagram.png', 'diagram');
        await create('MoveTest/main.md', mainContent);
        await ensureFolder('MoveTestTarget');

        await lib.waitUntil({
          message: 'the declaration to be parsed',
          predicate: () => {
            const file = app.vault.getFileByPath('MoveTest/main.md');
            return !!file && !!app.metadataCache.getFileCache(file)?.frontmatter;
          },
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MS
        });
        await sleep(SETTLE_DELAY_IN_MS);

        const mainFile = app.vault.getAbstractFileByPath('MoveTest/main.md');
        if (mainFile) {
          await app.fileManager.renameFile(mainFile, 'MoveTestTarget/main.md');
        }

        await lib.waitUntil({
          message: 'the relative member to follow the main file',
          predicate: () => !!app.vault.getAbstractFileByPath('MoveTestTarget/assets/diagram.png'),
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MS
        });
        await sleep(SETTLE_DELAY_IN_MS);

        const movedMain = app.vault.getFileByPath('MoveTestTarget/main.md');

        return {
          declaration: movedMain ? await app.vault.read(movedMain) : '',
          hasRelativeMemberAtNewPath: !!app.vault.getAbstractFileByPath('MoveTestTarget/assets/diagram.png'),
          hasRelativeMemberAtOldPath: !!app.vault.getAbstractFileByPath('MoveTest/assets/diagram.png'),
          hasRootedMemberAtOriginalPath: !!app.vault.getAbstractFileByPath('MoveTestShared/logo.png')
        };
      },
      input: { MAIN_CONTENT },
      vaultPath: getTemporaryVault().path
    });

    expect(result.hasRelativeMemberAtNewPath).toBe(true);
    expect(result.hasRelativeMemberAtOldPath).toBe(false);

    /*
     * A rooted member names a home of its own, so it stays put — the whole operational difference between
     * the two prefixes.
     */
    expect(result.hasRootedMemberAtOriginalPath).toBe(true);

    /*
     * Obsidian rewrites a frontmatter link in its own shortest-path style, stripping the prefix the format
     * requires. Finding the prefixes back in place is what proves the re-anchoring pass ran.
     */
    expect(result.declaration).toContain('./assets/diagram.png');
    expect(result.declaration).toContain('/MoveTestShared/logo.png');
  });
});
