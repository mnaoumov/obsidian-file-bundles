/**
 * @file
 *
 * Unlocking a bundle stops it propagating, and locking it again makes it propagate once more.
 *
 * The waiting happens in NODE, and that is not a style choice. One `evalInObsidian` closure is capped at
 * ~30s by the transport, and the operations themselves spend most of that budget on Android: four real
 * vault operations, two runs of the toggle-lock command and the plugin's transactional propagation. The
 * closures here used to declare a 15s ceiling beside their settles, which the cap could never honour — the
 * eval was killed as `EvalCapExceededError`, naming the harness rather than the step that overran, measured
 * 32.8s on the Android leg, 2026-09-20. Each wait is now a `pollInObsidian` whose `poll` reads the vault
 * and returns at once, and each settle is a Node-side `sleepInNode`, a settle being wall-clock time either
 * way.
 */

// Imported under a different name on purpose: a module-scope `sleep` shadows the Obsidian runtime global
// that a serialized closure would otherwise reach for, and the failure is an opaque `ReferenceError` from
// inside the closure rather than anything naming this import.
import { setTimeout as sleepInNode } from 'node:timers/promises';
import {
  evalInObsidian,
  pollInObsidian
} from 'obsidian-integration-testing';
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
const SETTLE_DELAY_IN_MS = 1500;
const TEST_TIMEOUT_IN_MS = 120_000;

/*
 * A NODE-side budget, so the transport's per-eval cap does not bound it: what it covers is a series of
 * short polls rather than one long closure. Generous on purpose — the emulator is the slow end, and what
 * is waited on here lands in well under a second on a desktop.
 */
const WAIT_TIMEOUT_IN_MS = 30_000;

describe('Unlocking a bundle', () => {
  it('should stop the bundle propagating, and honour it again once locked', { timeout: TEST_TIMEOUT_IN_MS }, async () => {
    const vaultPath = getTemporaryVault().path;

    // Staging and the wait for the declaration are one round trip: `start` creates the files and returns,
    // and the polling — from Node — is what waits for the metadata cache to catch up.
    await pollInObsidian({
      input: { MAIN_CONTENT },
      poll({ app }): boolean {
        const file = app.vault.getFileByPath('LockTest/main.md');
        return !!file && !!app.metadataCache.getFileCache(file)?.frontmatter;
      },
      async start({ app, MAIN_CONTENT: mainContent }): Promise<void> {
        /*
         * Moving a note whose frontmatter links its own dependents otherwise raises Obsidian's "Update
         * links — do you want to update internal links that link to this file?" sheet, and the rename SITS
         * THERE waiting for an answer, so `renameFile` never resolves and the eval is killed at the
         * transport's cap. The desktop harness writes this into `app.json` before it starts; on Android the
         * setting does not survive to the running app, so the suite sets it itself.
         */
        app.vault.setConfig('alwaysUpdateLinks', true);

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
      },
      timeoutInMilliseconds: WAIT_TIMEOUT_IN_MS,
      timeoutMessage: 'the declaration never reached the metadata cache',
      until: (isDeclarationParsed: boolean): boolean => isDeclarationParsed,
      vaultPath
    });

    await sleepInNode(SETTLE_DELAY_IN_MS);

    // Unlock through the real command, on the real active file, the way a user would.
    await toggleLock(vaultPath, 'LockTest/main.md');

    /*
     * Moving an unlocked bundle: the main file goes and the dependent does not, so the main arriving at its
     * new path is the only positive signal there is. What the dependent did is asserted below, a negative
     * nothing can wait for.
     */
    await pollInObsidian({
      poll({ app }): boolean {
        return !!app.vault.getAbstractFileByPath('LockTestSecond/main.md');
      },
      async start({ app }): Promise<void> {
        const mainFile = app.vault.getAbstractFileByPath('LockTest/main.md');
        if (!mainFile) {
          throw new Error('The staged main file is missing: LockTest/main.md');
        }

        await app.fileManager.renameFile(mainFile, 'LockTestSecond/main.md');
      },
      timeoutInMilliseconds: WAIT_TIMEOUT_IN_MS,
      timeoutMessage: 'the unlocked main file never arrived at its new path',
      until: (hasMainMoved: boolean): boolean => hasMainMoved,
      vaultPath
    });

    await sleepInNode(SETTLE_DELAY_IN_MS);

    const isDependentStayedWhileUnlocked = await evalInObsidian({
      callback({ app }) {
        return !!app.vault.getAbstractFileByPath('LockTest/assets/diagram.png');
      },
      vaultPath
    });

    /*
     * Back beside its dependent before locking again. A relocked bundle carries what sits with it NOW — it
     * does not retroactively reach after a dependent an unlocked move already left behind.
     */
    await pollInObsidian({
      poll({ app }): boolean {
        return !!app.vault.getAbstractFileByPath('LockTest/main.md');
      },
      async start({ app }): Promise<void> {
        const movedBack = app.vault.getAbstractFileByPath('LockTestSecond/main.md');
        if (!movedBack) {
          throw new Error('The moved main file is missing: LockTestSecond/main.md');
        }

        await app.fileManager.renameFile(movedBack, 'LockTest/main.md');
      },
      timeoutInMilliseconds: WAIT_TIMEOUT_IN_MS,
      timeoutMessage: 'the unlocked main file never came back beside its dependent',
      until: (hasMainMovedBack: boolean): boolean => hasMainMovedBack,
      vaultPath
    });

    await sleepInNode(SETTLE_DELAY_IN_MS);

    await toggleLock(vaultPath, 'LockTest/main.md');

    const isDependentFollowedWhenLocked = await pollInObsidian({
      poll({ app }): boolean {
        return !!app.vault.getAbstractFileByPath('LockTestThird/assets/diagram.png');
      },
      async start({ app }): Promise<void> {
        const mainFile = app.vault.getAbstractFileByPath('LockTest/main.md');
        if (!mainFile) {
          throw new Error('The relocked main file is missing: LockTest/main.md');
        }

        await app.fileManager.renameFile(mainFile, 'LockTestThird/main.md');
      },
      timeoutInMilliseconds: WAIT_TIMEOUT_IN_MS,
      timeoutMessage: 'the dependent never followed the main file once the bundle was locked again',
      until: (hasDependentFollowed: boolean): boolean => hasDependentFollowed,
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

/**
 * Runs the plugin's toggle-lock command on a note, the way a user does: the note is made the active file
 * first, because the command reads the active file rather than taking a path.
 *
 * Its own round trip, followed by a Node-side settle. The command is fire-and-forget — `executeCommandById`
 * returns whether the command ran, not whether it finished — and a lock flip has no vault-visible effect to
 * poll for, only the propagation of the NEXT operation.
 *
 * @param vaultPath - The vault to evaluate against.
 * @param notePath - Vault-relative path of the note to toggle the lock on.
 */
async function toggleLock(vaultPath: string, notePath: string): Promise<void> {
  await evalInObsidian({
    async callback({ app, notePath: path, PLUGIN_ID: pluginId }) {
      const file = app.vault.getFileByPath(path);
      if (!file) {
        throw new Error(`The staged main file is missing: ${path}`);
      }

      await app.workspace.getLeaf(false).openFile(file);
      app.commands.executeCommandById(`${pluginId}:toggle-lock`);
    },
    input: {
      notePath,
      PLUGIN_ID
    },
    vaultPath
  });

  await sleepInNode(SETTLE_DELAY_IN_MS);
}
