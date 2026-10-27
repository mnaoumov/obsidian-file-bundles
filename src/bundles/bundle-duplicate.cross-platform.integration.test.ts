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

/*
 * The sidecar shape: a binary main cannot carry frontmatter, so a note declares the bundle on its behalf.
 * Obsidian will not open an HTML file, so the sidecar is the only half of the pair that can ever be the
 * active file — which is why the command has to find the bundle from it.
 */
const SIDECAR_CONTENT = [
  '---',
  'file-bundles:',
  '  main: "[[./report.html]]"',
  '  files:',
  '    - "[[./report-styles.css]]"',
  '---',
  '',
  'The sidecar note for `report.html`.',
  ''
].join('\n');

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

  /*
   * Run from the SIDECAR, which is the only file of this pair a user can have open. Until the index answered
   * for a declaring note as well as for a main file, every command reported `no bundle declared` here.
   */
  it('should duplicate a sidecar-declared bundle from the declaring note', { timeout: TEST_TIMEOUT_IN_MS }, async () => {
    const vaultPath = getTemporaryVault().path;

    await evalInObsidian({
      async callback({
        app,
        lib,
        SIDECAR_CONTENT: sidecarContent
      }) {
        const SETTLE_DELAY_IN_MS = 1500;
        const WAIT_TIMEOUT_IN_MS = 15_000;

        async function create(path: string, content: string): Promise<void> {
          try {
            await app.vault.create(path, content);
          } catch {
            // Already there.
          }
        }

        try {
          await app.vault.createFolder('SidecarDuplicateTest');
        } catch {
          // Already there.
        }

        await create('SidecarDuplicateTest/report.html', '<!doctype html>\n<title>Quarterly report</title>\n');
        await create('SidecarDuplicateTest/report-styles.css', 'body { color: red; }\n');
        await create('SidecarDuplicateTest/report.html.md', sidecarContent);

        await lib.waitUntil({
          message: 'the sidecar declaration to be parsed',
          predicate: () => {
            const file = app.vault.getFileByPath('SidecarDuplicateTest/report.html.md');
            return !!file && !!app.metadataCache.getFileCache(file)?.frontmatter;
          },
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MS
        });
        await sleep(SETTLE_DELAY_IN_MS);
      },
      input: { SIDECAR_CONTENT },
      vaultPath
    });

    const result = await evalInObsidian({
      async callback({ app, lib, PLUGIN_ID: pluginId }) {
        const WAIT_TIMEOUT_IN_MS = 15_000;

        const sidecarFile = app.vault.getFileByPath('SidecarDuplicateTest/report.html.md');
        if (sidecarFile) {
          await app.workspace.getLeaf(false).openFile(sidecarFile);
        }

        app.commands.executeCommandById(`${pluginId}:duplicate-bundle`);

        /*
         * On the copied sidecar's CONTENT, never on the file appearing. The copy arrives carrying a
         * verbatim copy of the ORIGINAL's declaration, and the rewrite that points it at its own main is a
         * separate, later write — so a read taken the moment the file exists lands between the two and sees
         * the original's names. The rewrite is the operation's LAST write, after every copy has been made,
         * which is why this one signal also settles `hasCopiedMain` and `hasCopiedMember`.
         */
        await lib.waitUntil({
          message: 'the copied sidecar to declare its own main and member',
          predicate: async () => {
            const copy = app.vault.getFileByPath('SidecarDuplicateTest/report 1.html.md');
            if (!copy) {
              return false;
            }

            const content = await app.vault.read(copy);
            return content.includes('report 1.html') && content.includes('report-styles 1.css');
          },
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MS
        });

        const copiedSidecar = app.vault.getFileByPath('SidecarDuplicateTest/report 1.html.md');

        return {
          declaration: copiedSidecar ? await app.vault.read(copiedSidecar) : '',
          hasCopiedMain: !!app.vault.getAbstractFileByPath('SidecarDuplicateTest/report 1.html'),
          hasCopiedMember: !!app.vault.getAbstractFileByPath('SidecarDuplicateTest/report-styles 1.css'),
          hasOriginalMain: !!app.vault.getAbstractFileByPath('SidecarDuplicateTest/report.html')
        };
      },
      input: { PLUGIN_ID },
      vaultPath
    });

    // The whole bundle came across — the binary main, its member, and the note declaring them.
    expect(result.hasCopiedMain).toBe(true);
    expect(result.hasCopiedMember).toBe(true);
    expect(result.hasOriginalMain).toBe(true);

    // And the copy's declaration names its own main and its own member, not the originals.
    expect(result.declaration).toContain('./report 1.html');
    expect(result.declaration).toContain('./report-styles 1.css');
  });
});
