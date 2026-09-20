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
  '    - "[[/DuplicateTestShared/logo.png]]"',
  '---',
  '',
  'The main file.',
  ''
].join('\n');

/*
 * A PNG signature followed by bytes no text encoding round-trips. This is the whole point of the suite: the
 * duplicate goes through the transaction's `copy`, which copies content byte for byte, rather than through a
 * `create(path, string)` that would quietly mangle every attachment.
 */
const MEMBER_BYTES = [137, 80, 78, 71, 13, 10, 26, 10, 0, 128, 254, 255];

const PLUGIN_ID = 'file-bundles';
const TEST_TIMEOUT_IN_MS = 120_000;

/*
 * Two round-trips rather than one closure: the transport caps a single `evalInObsidian` at ~30 seconds, and
 * the vault carries the state between them.
 */
describe('Duplicating a bundle', () => {
  it('should copy the relative member byte for byte and share the rooted one', { timeout: TEST_TIMEOUT_IN_MS }, async () => {
    const vaultPath = getTemporaryVault().path;

    await evalInObsidian({
      async callback({
        app,
        lib,
        MAIN_CONTENT: mainContent,
        MEMBER_BYTES: memberBytes
      }) {
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

        async function createBinary(path: string, bytes: number[]): Promise<void> {
          const slashIndex = path.lastIndexOf('/');
          if (slashIndex > 0) {
            await ensureFolder(path.slice(0, slashIndex));
          }
          try {
            await app.vault.createBinary(path, new Uint8Array(bytes).buffer);
          } catch {
            // Already there.
          }
        }

        await createBinary('DuplicateTestShared/logo.png', memberBytes);
        await createBinary('DuplicateTest/assets/diagram.png', memberBytes);
        await create('DuplicateTest/main.md', mainContent);

        await lib.waitUntil({
          message: 'the declaration to be parsed',
          predicate: () => {
            const file = app.vault.getFileByPath('DuplicateTest/main.md');
            return !!file && !!app.metadataCache.getFileCache(file)?.frontmatter;
          },
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MS
        });
        await sleep(SETTLE_DELAY_IN_MS);
      },
      input: { MAIN_CONTENT, MEMBER_BYTES },
      vaultPath
    });

    // Through the real command, on the real active file, the way a user runs it.
    const result = await evalInObsidian({
      async callback({ app, lib, PLUGIN_ID: pluginId }) {
        const WAIT_TIMEOUT_IN_MS = 15_000;

        const mainFile = app.vault.getFileByPath('DuplicateTest/main.md');
        if (mainFile) {
          await app.workspace.getLeaf(false).openFile(mainFile);
        }

        app.commands.executeCommandById(`${pluginId}:duplicate-bundle`);

        await lib.waitUntil({
          message: 'the copy to carry a declaration naming its own member',
          predicate: async () => {
            const copy = app.vault.getFileByPath('DuplicateTest/main 1.md');
            if (!copy) {
              return false;
            }

            const content = await app.vault.read(copy);
            return content.includes('diagram 1.png');
          },
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MS
        });

        const copyFile = app.vault.getFileByPath('DuplicateTest/main 1.md');
        const copiedMember = app.vault.getFileByPath('DuplicateTest/assets/diagram 1.png');
        const originalMember = app.vault.getFileByPath('DuplicateTest/assets/diagram.png');

        const copiedBytes = copiedMember ? new Uint8Array(await app.vault.readBinary(copiedMember)) : new Uint8Array();
        const originalBytes = originalMember
          ? new Uint8Array(await app.vault.readBinary(originalMember))
          : new Uint8Array();

        return {
          copiedByteLength: copiedBytes.length,
          declaration: copyFile ? await app.vault.read(copyFile) : '',
          hasOriginalMember: !!originalMember,
          hasRootedMemberCopy: !!app.vault.getAbstractFileByPath('DuplicateTestShared/logo 1.png'),
          isCopiedMemberIdentical: copiedBytes.length === originalBytes.length
            && copiedBytes.every((byte, index) => byte === originalBytes[index])
        };
      },
      input: { PLUGIN_ID },
      vaultPath
    });

    /*
     * The binary round-trip is what this operation waited on `VaultTransaction.copy` for: `create` takes a
     * `string`, so a bundle holding an image could only ever have been duplicated with its bytes mangled.
     */
    expect(result.copiedByteLength).toBe(MEMBER_BYTES.length);
    expect(result.isCopiedMemberIdentical).toBe(true);

    // The original bundle is untouched — a duplication adds, it never moves.
    expect(result.hasOriginalMember).toBe(true);

    /*
     * A rooted member names a home of its own, so the duplicate points at the very same file instead of
     * growing a second copy of it.
     */
    expect(result.hasRootedMemberCopy).toBe(false);
    expect(result.declaration).toContain('/DuplicateTestShared/logo.png');

    // The copy declares its OWN member rather than the original's.
    expect(result.declaration).toContain('./assets/diagram 1.png');
  });
});
