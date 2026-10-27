/**
 * @file
 *
 * Renaming a bundle's main file leaves its dependents named as they are, unless the bundle opts in.
 *
 * The waiting happens in NODE, and that is not a style choice. One `evalInObsidian` closure is capped at
 * ~30s by the transport, and the operations themselves spend most of that budget on Android: four vault
 * creations, two real renames and the plugin's transactional propagation. A single closure that declared
 * even modest ceilings inside itself therefore died at the cap as `EvalCapExceededError`, naming the
 * harness rather than the step that overran — measured 31.1s on the Android leg, 2026-09-20. Each wait is
 * now a `pollInObsidian` whose `poll` reads the vault and returns at once, and each settle is a Node-side
 * `sleepInNode`, a settle being wall-clock time either way.
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

const SETTLE_DELAY_IN_MS = 2000;
const TEST_TIMEOUT_IN_MS = 120_000;

/*
 * A NODE-side budget, so the transport's per-eval cap does not bound it: what it covers is a series of
 * short polls rather than one long closure. Generous on purpose — the emulator is the slow end, and what
 * is waited on here lands in well under a second on a desktop.
 */
const WAIT_TIMEOUT_IN_MS = 30_000;

describe('Renaming a bundle', () => {
  it('should leave dependents named as they are, unless the bundle asks for them to follow', { timeout: TEST_TIMEOUT_IN_MS }, async () => {
    const vaultPath = getTemporaryVault().path;

    /*
     * BOTH declarations, not just one: a bundle whose declaration has not been parsed yet is not a bundle
     * at all, so renaming its main file would prove nothing about the opt-in.
     */
    await pollInObsidian({
      input: {
        FOLLOWING_CONTENT,
        KEEPING_CONTENT
      },
      poll({ app }): boolean {
        return ['RenameTestKeeping/keeping.md', 'RenameTestFollowing/following.md'].every((path) => {
          const file = app.vault.getFileByPath(path);
          return !!file && !!app.metadataCache.getFileCache(file)?.frontmatter;
        });
      },
      async start({ app, FOLLOWING_CONTENT: followingContent, KEEPING_CONTENT: keepingContent }): Promise<void> {
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

        await create('RenameTestKeeping/keeping.png', 'keeping');
        await create('RenameTestKeeping/keeping.md', keepingContent);
        await create('RenameTestFollowing/following.png', 'following');
        await create('RenameTestFollowing/following.md', followingContent);
      },
      timeoutInMilliseconds: WAIT_TIMEOUT_IN_MS,
      timeoutMessage: 'both declarations never reached the metadata cache',
      until: (areBothParsed: boolean): boolean => areBothParsed,
      vaultPath
    });

    await sleepInNode(SETTLE_DELAY_IN_MS);

    /*
     * Both mains renamed in the one `start`, so the two bundles see the same operation and the only thing
     * that differs between them is the `renameDependents` opt-in. The opted-in dependent arriving under its
     * new name is the signal; the other bundle's dependent is asserted below, a negative nothing can wait
     * for.
     */
    await pollInObsidian({
      poll({ app }): boolean {
        return !!app.vault.getAbstractFileByPath('RenameTestFollowing/renamed.png');
      },
      async start({ app }): Promise<void> {
        async function rename(oldPath: string, newPath: string): Promise<void> {
          const abstractFile = app.vault.getAbstractFileByPath(oldPath);
          if (!abstractFile) {
            throw new Error(`The staged main file is missing: ${oldPath}`);
          }

          await app.fileManager.renameFile(abstractFile, newPath);
        }

        await rename('RenameTestKeeping/keeping.md', 'RenameTestKeeping/renamed.md');
        await rename('RenameTestFollowing/following.md', 'RenameTestFollowing/renamed.md');
      },
      timeoutInMilliseconds: WAIT_TIMEOUT_IN_MS,
      timeoutMessage: 'the dependent of the opted-in bundle never followed the new name',
      until: (hasDependentFollowed: boolean): boolean => hasDependentFollowed,
      vaultPath
    });

    await sleepInNode(SETTLE_DELAY_IN_MS);

    const result = await evalInObsidian({
      callback({ app }) {
        return {
          keepingDependentKeptItsName: !!app.vault.getAbstractFileByPath('RenameTestKeeping/keeping.png'),
          renamedDependentFollowed: !!app.vault.getAbstractFileByPath('RenameTestFollowing/renamed.png')
        };
      },
      vaultPath
    });

    /*
     * The default is deliberate: a dependent is not necessarily named after its main, and renaming one would
     * rename it out from under everything else that links to it.
     */
    expect(result.keepingDependentKeptItsName).toBe(true);
    expect(result.renamedDependentFollowed).toBe(true);
  });
});
