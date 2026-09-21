/**
 * @file
 *
 * Moving a bundle carries its relative members into the new folder and leaves its rooted ones where they
 * are.
 *
 * The waiting happens in NODE, and that is not a style choice. One `evalInObsidian` closure is capped at
 * ~30s by the transport, and the operations themselves spend most of that budget on Android: three vault
 * creations, a real move, the plugin's transactional propagation and its re-anchoring pass. A single
 * closure that declared even modest ceilings inside itself therefore died at the cap as
 * `EvalCapExceededError`, naming the harness rather than the step that overran — measured 31.2s on the
 * Android leg, 2026-09-20. Each wait is now a `pollInObsidian` whose `poll` reads the vault and returns at
 * once, and each settle is a Node-side `sleepInNode`, a settle being wall-clock time either way.
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
  '    - "[[/MoveTestShared/logo.png]]"',
  '  folders:',
  '    - ./assets',
  '---',
  '',
  'The main file.',
  ''
].join('\n');

const SETTLE_DELAY_IN_MS = 2000;
const TEST_TIMEOUT_IN_MS = 120_000;

/*
 * A NODE-side budget, so the transport's per-eval cap does not bound it: what it covers is a series of
 * short polls rather than one long closure. Generous on purpose — the emulator is the slow end, and what
 * is waited on here lands in well under a second on a desktop.
 */
const WAIT_TIMEOUT_IN_MS = 30_000;

describe('Moving a bundle', () => {
  it('should carry the relative members into the new folder and leave the rooted one where it is', { timeout: TEST_TIMEOUT_IN_MS }, async () => {
    const vaultPath = getTemporaryVault().path;

    // Staging and the wait for the declaration are one round trip: `start` creates the files and returns,
    // and the polling — from Node — is what waits for the metadata cache to catch up.
    await pollInObsidian({
      input: { MAIN_CONTENT },
      poll({ app }): boolean {
        const file = app.vault.getFileByPath('MoveTest/main.md');
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

        await create('MoveTestShared/logo.png', 'logo');
        await create('MoveTest/assets/diagram.png', 'diagram');
        await create('MoveTest/main.md', mainContent);
        await ensureFolder('MoveTestTarget');
      },
      timeoutInMilliseconds: WAIT_TIMEOUT_IN_MS,
      timeoutMessage: 'the declaration never reached the metadata cache',
      until: (isDeclarationParsed: boolean): boolean => isDeclarationParsed,
      vaultPath
    });

    await sleepInNode(SETTLE_DELAY_IN_MS);

    /*
     * The plugin plans the move and then runs it through a vault transaction, so `renameFile` returning and
     * the dependents having arrived are different events. The dependent itself is the signal.
     */
    await pollInObsidian({
      poll({ app }): boolean {
        return !!app.vault.getAbstractFileByPath('MoveTestTarget/assets/diagram.png');
      },
      async start({ app }): Promise<void> {
        const mainFile = app.vault.getAbstractFileByPath('MoveTest/main.md');
        if (!mainFile) {
          throw new Error('The staged main file is missing: MoveTest/main.md');
        }

        await app.fileManager.renameFile(mainFile, 'MoveTestTarget/main.md');
      },
      timeoutInMilliseconds: WAIT_TIMEOUT_IN_MS,
      timeoutMessage: 'the relative member never followed the main file',
      until: (hasMemberFollowed: boolean): boolean => hasMemberFollowed,
      vaultPath
    });

    // The re-anchoring pass runs after the move lands, so the declaration is read once it has settled.
    await sleepInNode(SETTLE_DELAY_IN_MS);

    const result = await evalInObsidian({
      async callback({ app }) {
        const movedMain = app.vault.getFileByPath('MoveTestTarget/main.md');

        return {
          declaration: movedMain ? await app.vault.read(movedMain) : '',
          hasRelativeMemberAtNewPath: !!app.vault.getAbstractFileByPath('MoveTestTarget/assets/diagram.png'),
          hasRelativeMemberAtOldPath: !!app.vault.getAbstractFileByPath('MoveTest/assets/diagram.png'),
          hasRootedMemberAtOriginalPath: !!app.vault.getAbstractFileByPath('MoveTestShared/logo.png')
        };
      },
      vaultPath
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
