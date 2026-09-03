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
  '---',
  '',
  'The main file.',
  ''
].join('\n');

const PLUGIN_ID = 'file-bundles';
const TEST_TIMEOUT_IN_MS = 120_000;

/*
 * Deliberately several round-trips rather than one closure. The transport caps a single `evalInObsidian`
 * at ~30 seconds, and this behavior needs four real vault operations with a settle after each — so each
 * step is its own call, and the vault carries the state between them.
 */
describe('Unlocking a bundle', () => {
  it('should stop the bundle propagating, and honour it again once locked', { timeout: TEST_TIMEOUT_IN_MS }, async () => {
    const vaultPath = getTemporaryVault().path;

    await evalInObsidian({
      async callback({ app, lib, MAIN_CONTENT: mainContent }) {
        const SETTLE_DELAY_IN_MS = 1500;
        const WAIT_TIMEOUT_IN_MS = 15_000;

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

        await create('LockTest/assets/diagram.png', 'diagram');
        await create('LockTest/main.md', mainContent);
        await ensureFolder('LockTestSecond');
        await ensureFolder('LockTestThird');

        await lib.waitUntil({
          message: 'the declaration to be parsed',
          predicate: () => {
            const file = app.vault.getFileByPath('LockTest/main.md');
            return !!file && !!app.metadataCache.getFileCache(file)?.frontmatter;
          },
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MS
        });
        await sleep(SETTLE_DELAY_IN_MS);
      },
      input: { MAIN_CONTENT },
      vaultPath
    });

    // Unlock through the real command, the way a user would, and then move the main file.
    const isDependentStayedWhileUnlocked = await evalInObsidian({
      async callback({ app, PLUGIN_ID: pluginId }) {
        const SETTLE_DELAY_IN_MS = 1500;

        const file = app.vault.getFileByPath('LockTest/main.md');
        if (file) {
          await app.workspace.getLeaf(false).openFile(file);
        }
        app.commands.executeCommandById(`${pluginId}:toggle-lock`);
        await sleep(SETTLE_DELAY_IN_MS);

        const mainFile = app.vault.getAbstractFileByPath('LockTest/main.md');
        if (mainFile) {
          await app.fileManager.renameFile(mainFile, 'LockTestSecond/main.md');
        }
        await sleep(SETTLE_DELAY_IN_MS);

        return !!app.vault.getAbstractFileByPath('LockTest/assets/diagram.png');
      },
      input: { PLUGIN_ID },
      vaultPath
    });

    /*
     * Back beside its dependent before locking again. A relocked bundle carries what sits with it NOW — it
     * does not retroactively reach after a dependent an unlocked move already left behind.
     */
    await evalInObsidian({
      async callback({ app, PLUGIN_ID: pluginId }) {
        const SETTLE_DELAY_IN_MS = 1500;

        const movedBack = app.vault.getAbstractFileByPath('LockTestSecond/main.md');
        if (movedBack) {
          await app.fileManager.renameFile(movedBack, 'LockTest/main.md');
        }
        await sleep(SETTLE_DELAY_IN_MS);

        const file = app.vault.getFileByPath('LockTest/main.md');
        if (file) {
          await app.workspace.getLeaf(false).openFile(file);
        }
        app.commands.executeCommandById(`${pluginId}:toggle-lock`);
        await sleep(SETTLE_DELAY_IN_MS);
      },
      input: { PLUGIN_ID },
      vaultPath
    });

    const isDependentFollowedWhenLocked = await evalInObsidian({
      async callback({ app, lib }) {
        const WAIT_TIMEOUT_IN_MS = 15_000;

        const mainFile = app.vault.getAbstractFileByPath('LockTest/main.md');
        if (mainFile) {
          await app.fileManager.renameFile(mainFile, 'LockTestThird/main.md');
        }

        await lib.waitUntil({
          message: 'the dependent to follow once the bundle is locked again',
          predicate: () => !!app.vault.getAbstractFileByPath('LockTestThird/assets/diagram.png'),
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MS
        });

        return !!app.vault.getAbstractFileByPath('LockTestThird/assets/diagram.png');
      },
      vaultPath
    });

    /*
     * Unlocking is what splits a bundle back into independent pieces, so the move leaves the dependent
     * behind — and once locked again the very same move carries it.
     */
    expect(isDependentStayedWhileUnlocked).toBe(true);
    expect(isDependentFollowedWhenLocked).toBe(true);
  });
});
