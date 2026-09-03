import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

const ALPHA_CONTENT = [
  '---',
  'file-bundles:',
  '  files:',
  '    - "[[./assets/diagram.png]]"',
  '    - "[[/DeleteTestShared/logo.png]]"',
  '---',
  '',
  'Alpha.',
  ''
].join('\n');

const BETA_CONTENT = [
  '---',
  'file-bundles:',
  '  files:',
  '    - "[[/DeleteTestShared/logo.png]]"',
  '---',
  '',
  'Beta.',
  ''
].join('\n');

describe('Deleting a bundle', () => {
  it('should take its own dependents and spare the one another bundle also declares', async () => {
    const result = await evalInObsidian({
      async callback({ ALPHA_CONTENT: alphaContent, app, BETA_CONTENT: betaContent, lib }) {
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

        await create('DeleteTestShared/logo.png', 'logo');
        await create('DeleteTest/assets/diagram.png', 'diagram');
        await create('DeleteTest/alpha.md', alphaContent);
        await create('DeleteTestOther/beta.md', betaContent);

        await lib.waitUntil({
          message: 'both declarations to be parsed',
          predicate: () => {
            const alpha = app.vault.getFileByPath('DeleteTest/alpha.md');
            const beta = app.vault.getFileByPath('DeleteTestOther/beta.md');
            return !!alpha && !!beta
              && !!app.metadataCache.getFileCache(alpha)?.frontmatter
              && !!app.metadataCache.getFileCache(beta)?.frontmatter;
          },
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MS
        });
        await sleep(SETTLE_DELAY_IN_MS);

        const mainFile = app.vault.getAbstractFileByPath('DeleteTest/alpha.md');
        if (mainFile) {
          await app.fileManager.trashFile(mainFile);
        }

        await lib.waitUntil({
          message: 'the dependent to go with its main file',
          predicate: async () => !await app.vault.adapter.exists('DeleteTest/assets/diagram.png'),
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MS
        });
        await sleep(SETTLE_DELAY_IN_MS);

        return {
          hasOwnDependent: await app.vault.adapter.exists('DeleteTest/assets/diagram.png'),
          hasSharedDependent: await app.vault.adapter.exists('DeleteTestShared/logo.png')
        };
      },
      input: {
        ALPHA_CONTENT,
        BETA_CONTENT
      },
      vaultPath: getTemporaryVault().path
    });

    expect(result.hasOwnDependent).toBe(false);

    /*
     * The invariant the whole delete path exists to hold: a file two bundles declare outlives the deletion
     * of either one of them.
     */
    expect(result.hasSharedDependent).toBe(true);
  });
});
