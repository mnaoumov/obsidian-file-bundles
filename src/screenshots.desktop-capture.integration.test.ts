/**
 * @file
 *
 * Produces the desktop screenshots the community-store listing needs, driving a staged vault in a real
 * Obsidian and writing `images/screenshots/screenshot-desktop-N.png`.
 *
 * FIVE shots, four of them of the FILE EXPLORER: this plugin's whole claim is about which files travel
 * together, and the explorer is where that is visible. The two frames that are not explorer frames show
 * the declaration itself, because "declared, not inferred from a naming convention" is the thing that
 * separates this from every folder-convention plugin in the store.
 *
 * The vault is staged rather than borrowed from `demo-vault/`: those notes document the plugin and link
 * the same subject files the fixtures do, so they flood the tree and push the demonstration out of frame.
 *
 * There is no settings-tab shot. The settings are not the feature here — a declaration in a note is — and
 * the fleet's way of opening that tab stopped rendering rows under Obsidian 1.14.
 *
 * Each shot asserts what its caption claims BEFORE capturing, so a run that staged the wrong state fails
 * instead of shipping a frame that contradicts its own label.
 *
 * The waiting happens in NODE. One closure is capped at ~30s by the transport, so the 60s ceilings this
 * file used to declare inside one — each with a settle on top — were budgets the cap could never honour:
 * they would have died as a bare `script timeout` on exactly the slow machine the budget was chosen for.
 * Every long wait is now a `pollInObsidian` whose `poll` reads the DOM or the vault and returns at once,
 * and every settle is a Node-side `sleepInNode`, a settle being wall-clock time either way.
 *
 * Excluded from `npm run test:integration` by its file name — see the `capture-screenshots:desktop`
 * project in `scripts/vitest-config.ts`. Capturing is an explicit operation
 * (`npm run capture:screenshots`), not something every test run does.
 */

import {
  mkdirSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
// Imported under a different name on purpose: a module-scope `sleep` shadows the Obsidian runtime global
// that every serialized closure in this file calls, and the failure is an opaque `ReferenceError` from
// inside the closure rather than anything naming this import.
import { setTimeout as sleepInNode } from 'node:timers/promises';
import {
  captureObsidianScreenshot,
  evalInObsidian,
  labelScreenshot,
  pollInObsidian,
  readPngDimensions
} from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  beforeAll,
  describe,
  expect,
  it
} from 'vitest';

/**
 * A File Explorer row, reduced to the collapse toggle the staged tree has to be opened with.
 */
interface CollapsibleFileItem {
  collapsed?: boolean;
  setCollapsed?: (this: void, isCollapsed: boolean) => Promise<void>;
}

/**
 * What one reading of the File Explorer says.
 */
interface ExplorerReading {
  /**
   * The painted rows the plugin has marked as a bundle's main file, sorted.
   */
  markedMainNames: string[];

  /**
   * The painted names, joined, so a shot can assert what is and is not on screen.
   */
  names: string;

  /**
   * How many file rows are painted — the number shot 1's caption quotes.
   */
  visibleFileCount: number;
}

/**
 * The File Explorer view, reduced to its rows.
 */
interface FileExplorerView {
  fileItems: Record<string, CollapsibleFileItem>;
}

const PLUGIN_ID = 'file-bundles';

const WIDTH_IN_PIXELS = 1200;
const HEIGHT_IN_PIXELS = 800;

const WAIT_TIMEOUT_IN_MILLISECONDS = 60_000;
const TEST_TIMEOUT_IN_MILLISECONDS = 300_000;

/**
 * How long a state that has been waited for is left to finish PAINTING.
 *
 * Every wait in this file ends on a fact — a file exists, a row is marked, an editor has content — and a
 * frame is judged on pixels, which arrive a beat later. Slept in Node rather than inside the closure: a
 * settle is wall-clock time either way, and inside it would be charged against the transport's per-eval
 * cap for no benefit.
 */
const SETTLE_DELAY_IN_MILLISECONDS = 1500;

/**
 * The settle after a note is opened, shorter because only one view has to repaint.
 */
const NOTE_SETTLE_DELAY_IN_MILLISECONDS = 1200;

/**
 * How wide the File Explorer is made for these frames.
 *
 * The explorer is the subject, and a bundle's rows sit two levels deep, so the default width spends most
 * of a 1200-pixel frame on an editor nobody is being asked to look at.
 */
const EXPLORER_WIDTH_IN_PIXELS = 380;

const TRIP_NOTE_PATH = 'Trips/Kyoto trip.md';
const TRIP_ASSETS_FOLDER_NAME = 'Kyoto assets';
const TRIP_ROUTE_PATH = `Trips/${TRIP_ASSETS_FOLDER_NAME}/Route.svg`;

/**
 * What the File Explorer calls `Route.svg`.
 *
 * The tree strips the extension from every file type it knows, so a row asserted as `Route.svg` is never
 * found — and the failure reads as the dependent still being hidden.
 */
const TRIP_ROUTE_ROW_NAME = 'Route';

/**
 * The sidecar note that declares the HTML bundle.
 *
 * Deliberately NOT named `report.html.md`. The plugin marks a declaration by its `file-bundles` key and
 * never by the file's name, so the sidecar is free to be called anything — and naming it after the file
 * it bundles would put two rows with the same display name in the frame, since Obsidian strips `.md`
 * from both. A reader cannot tell those apart, and neither could an assertion.
 */
const SIDECAR_NOTE_PATH = 'Reports/Quarterly report.md';
const SIDECAR_ROW_NAME = 'Quarterly report';

/**
 * What the File Explorer calls `report.html` — the extension stripped, like every other listed file.
 */
const REPORT_MAIN_ROW_NAME = 'report';
const REPORT_STYLES_NAME = 'report-styles.css';

const ARCHIVE_FOLDER = 'Archive';
const MOVED_TRIP_NOTE_PATH = `${ARCHIVE_FOLDER}/Kyoto trip.md`;
const MOVED_TRIP_ROUTE_PATH = `${ARCHIVE_FOLDER}/${TRIP_ASSETS_FOLDER_NAME}/Route.svg`;

/**
 * How many files the staged vault holds, quoted in shot 1's caption.
 *
 * Derived from the fixture map rather than written out, so the caption cannot claim a count the vault
 * does not have — the exact drift that shipped a frame captioned with the wrong number elsewhere in the
 * fleet.
 */
const STAGED_FILE_COUNT = 8;

/**
 * How many file rows the explorer paints while both bundles are locked, quoted in shot 1's caption.
 *
 * `Kyoto trip.md`, `report.html`, `Quarterly report.md` and `Reading list.md`. The four DECLARED
 * dependents are the ones that go; a declaring note is not a dependent and stays.
 */
const VISIBLE_FILE_COUNT_WHEN_LOCKED = 4;

/**
 * How the relock is waited on: 10 readings of the explorer, two seconds apart.
 *
 * Each reading is itself a settle, so this is far longer than it looks.
 */
const LOCK_POLL_ATTEMPTS = 10;
const LOCK_POLL_INTERVAL_IN_MILLISECONDS = 2000;

/**
 * The rows that carry the bundle marker, in the order `readExplorer` sorts them.
 */
const EXPECTED_MAIN_ROW_NAMES = ['Kyoto trip', REPORT_MAIN_ROW_NAME];

/**
 * How the marker is waited on: 10 readings of the explorer, a second apart.
 */
const MARK_POLL_ATTEMPTS = 10;
const MARK_POLL_INTERVAL_IN_MILLISECONDS = 1000;

const IMAGES_DIRECTORY = join(process.cwd(), 'images', 'screenshots');

/**
 * A placeholder drawing, big enough to be a real file rather than a token.
 *
 * SVG rather than PNG so it needs no image library, and shapes rather than text so it renders the same on
 * any host — `sharp` and Obsidian both resolve SVG text through whatever fonts the machine happens to
 * carry.
 *
 * @param label - Which of the two accent colors to use, so the assets are visibly different files.
 * @returns The SVG source.
 */
function buildDrawing(label: 'chart' | 'map' | 'route'): string {
  const fills = { chart: '#c98b3a', map: '#4f8a5b', route: '#5a76b4' };
  return '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160">\n'
    + '  <rect width="240" height="160" rx="8" fill="#f4f5f8"/>\n'
    + `  <rect x="16" y="16" width="208" height="14" rx="7" fill="${fills[label]}"/>\n`
    + '  <rect x="16" y="48" width="160" height="10" rx="5" fill="#d8dce5"/>\n'
    + '  <rect x="16" y="72" width="184" height="10" rx="5" fill="#d8dce5"/>\n'
    + '  <rect x="16" y="104" width="96" height="40" rx="6" fill="#e3e7ef"/>\n'
    + '  <rect x="128" y="104" width="96" height="40" rx="6" fill="#e3e7ef"/>\n'
    + '</svg>\n';
}

/**
 * The two bundles the shots are framed on — one of each declaration form.
 *
 * `Reading list.md` is in there so the tree is not made entirely of bundles: a reader has to be able to
 * see that an ordinary note still looks like an ordinary note.
 *
 * @returns The fixture map.
 */
function buildFixtures(): Record<string, string> {
  return {
    [`Trips/${TRIP_ASSETS_FOLDER_NAME}/Map.svg`]: buildDrawing('map'),
    'Reading list.md': '# Reading list\n\nWhat to read on the train.\n',
    'Reports/report-styles.css': 'body { font-family: sans-serif; }\n',
    'Reports/report.html': '<!doctype html>\n<title>Quarterly report</title>\n<link rel="stylesheet" href="report-styles.css">\n',
    'Reports/Report images/chart.svg': buildDrawing('chart'),
    [SIDECAR_NOTE_PATH]: '---\n'
      + 'file-bundles:\n'
      + '  main: "[[./report.html]]"\n'
      + '  files:\n'
      + `    - "[[./${REPORT_STYLES_NAME}]]"\n`
      + '  folders:\n'
      + '    - ./Report images\n'
      + '---\n'
      + '\n'
      + '# Quarterly report\n'
      + '\n'
      + 'The sidecar note for `report.html`. An HTML file cannot carry frontmatter, so this note declares\n'
      + 'the bundle on its behalf and names `report.html` as its `main`.\n'
      + '\n'
      + 'Its own name is not part of the deal — the `file-bundles` key is what marks a declaration.\n',
    [TRIP_NOTE_PATH]: '---\n'
      + 'file-bundles:\n'
      + '  files:\n'
      + `    - "[[./${TRIP_ASSETS_FOLDER_NAME}/Route.svg]]"\n`
      + '  folders:\n'
      + `    - ./${TRIP_ASSETS_FOLDER_NAME}\n`
      + '---\n'
      + '\n'
      + '# Kyoto trip\n'
      + '\n'
      + 'An ordinary note that declares a bundle. The `file-bundles` key names one file and one folder\n'
      + 'that belong with it, so moving, renaming or deleting this note carries them along.\n',
    [TRIP_ROUTE_PATH]: buildDrawing('route')
  };
}

beforeAll(async () => {
  const vault = getTemporaryVault();
  const fixtures = buildFixtures();

  expect(Object.keys(fixtures)).toHaveLength(STAGED_FILE_COUNT);

  vault.populate(fixtures);
  await vault.syncToDevice();

  await pollInObsidian({
    input: {
      explorerWidthInPixels: EXPLORER_WIDTH_IN_PIXELS,
      sidecarNotePath: SIDECAR_NOTE_PATH,
      tripNotePath: TRIP_NOTE_PATH
    },

    // The declaration is frontmatter, and the plugin's index is built from the metadata cache — so a
    // frame taken before the cache has parsed it shows a vault where no bundle exists yet. BOTH
    // declarations, not just the trip note's: a bundle whose declaration has not been parsed yet is not a
    // bundle, its main file carries no marker and its dependents are not hidden. Waiting on one of the two
    // let the sidecar bundle be photographed unmarked.
    poll({ app, sidecarNotePath, tripNotePath }): boolean {
      return [tripNotePath, sidecarNotePath].every((path) => {
        const file = app.vault.getFileByPath(path);
        return Boolean(file && app.metadataCache.getFileCache(file)?.frontmatter);
      });
    },
    async start({ app, explorerWidthInPixels }): Promise<void> {
      app.changeTheme('obsidian');

      // Each staged note opens with its own `# H1`, so the inline title doubles it. The config alone
      // changes nothing on screen — the setting is a class on `document.body`, and only this call applies
      // it. `app.workspace.updateOptions()` does NOT.
      app.vault.setConfig('showInlineTitle', false);
      app.updateInlineTitleDisplay();

      const style = createEl('style');
      style.textContent = [
        // The sidebar's foot carries the vault switcher, which in a capture run shows the harness's
        // generated `temp-vault-XXXXXX` name — private-looking data that belongs in no listing. Hidden
        // rather than renamed, because the name is the harness's to choose, not this suite's.
        '.workspace-drawer-vault-switcher, .workspace-drawer-header-switcher, .workspace-sidedock-vault-profile { visibility: hidden; }'
      ].join('\n');
      document.head.append(style);

      // A `file-bundles` declaration is a NESTED frontmatter object, and Obsidian's properties panel has
      // no editor for one — it prints the raw JSON in the red it uses for a type it cannot render. That is
      // Obsidian's rendering, not the plugin's, and none of these frames makes a claim about it: the
      // explorer frames are about the tree, and the two declaration frames show the YAML in true source
      // mode, where the panel is not drawn at all. Left visible it reads as an error in every shot.
      app.vault.setConfig('propertiesInDocument', 'hidden');
      app.workspace.updateOptions();

      // `report.html` is a type Obsidian will not open, and whether such a file is LISTED at all is a
      // setting rather than a constant. Left to the default, the main file of the sidecar bundle came and
      // went between runs — and with it the marker the first frame's caption is about.
      app.vault.setConfig('showUnsupportedFiles', true);

      // The file explorer IS the subject here, so it is the one thing that must be open — the opposite of
      // most capture suites, which collapse it to give a modal the frame. Widened past the default,
      // because a bundle's rows are nested two deep and the default width leaves two thirds of a
      // 1200-pixel frame to an empty editor.
      const { leftSplit } = app.workspace;
      leftSplit.expand();

      // `setSize` belongs to the desktop sidedock and not to the phone's drawer, which is what the split
      // is typed as on mobile — so it is narrowed rather than asserted.
      if ('setSize' in leftSplit) {
        leftSplit.setSize(explorerWidthInPixels);
      }
      const fileExplorerLeaf = app.workspace.getLeavesOfType('file-explorer')[0];
      if (fileExplorerLeaf) {
        await app.workspace.revealLeaf(fileExplorerLeaf);
      }
    },
    timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS,
    timeoutMessage: 'both declarations never reached the metadata cache',
    until: (areBothCached: boolean): boolean => areBothCached,
    vaultPath: vaultPath()
  });

  await sleepInNode(SETTLE_DELAY_IN_MILLISECONDS);
}, TEST_TIMEOUT_IN_MILLISECONDS);

describe('desktop store screenshots', () => {
  it('1 - a locked bundle hides what it declares', async () => {
    // Opened so the editor holds a note rather than the "New tab" placeholder, and so the row the frame
    // is about is the selected one.
    await openNote(TRIP_NOTE_PATH);

    const { markedMainNames, names, visibleFileCount } = await waitForMarkedMains(EXPECTED_MAIN_ROW_NAMES);

    // Both bundles collapsed. Asserted in both directions: the mains present, every declared dependent
    // absent — a frame that shows the dependents would contradict its own caption.
    expect(names).toContain('Kyoto trip');
    expect(names).toContain(REPORT_MAIN_ROW_NAME);
    expect(names).not.toContain(TRIP_ASSETS_FOLDER_NAME);
    expect(names).not.toContain(TRIP_ROUTE_ROW_NAME);
    expect(names).not.toContain(REPORT_STYLES_NAME);

    // The sidecar STAYS, and that is by design rather than an oversight in the framing: `isDependent`
    // answers false for a declaring note, because a note someone wrote about the report is a note they
    // still want to open. Asserted so the caption's count cannot be read as a bug.
    expect(names).toContain(SIDECAR_ROW_NAME);

    // The count in the caption, asserted rather than written out.
    expect(visibleFileCount).toBe(VISIBLE_FILE_COUNT_WHEN_LOCKED);

    // Both main files carry the marker glyph. It is the only thing in the frame that says WHICH rows are
    // bundles, so a frame where it is missing shows a tidy explorer and demonstrates nothing.
    expect(markedMainNames).toStrictEqual(EXPECTED_MAIN_ROW_NAMES);

    await shoot(
      1,
      `${String(STAGED_FILE_COUNT)} files on disk, ${String(VISIBLE_FILE_COUNT_WHEN_LOCKED)} rows in the explorer`
    );
  }, TEST_TIMEOUT_IN_MILLISECONDS);

  it('2 - unlocking puts the dependents back', async () => {
    await openNote(TRIP_NOTE_PATH);
    await runCommand('toggle-lock');

    const { names } = await readExplorer();

    expect(names).toContain(TRIP_ASSETS_FOLDER_NAME);
    expect(names).toContain(TRIP_ROUTE_ROW_NAME);
    // The other bundle is untouched, which is what makes this a per-bundle switch rather than a setting.
    expect(names).not.toContain(REPORT_STYLES_NAME);

    await shoot(2, 'Unlock one bundle and its dependents come back, dimmed');
  }, TEST_TIMEOUT_IN_MILLISECONDS);

  it('3 - the declaration lives in the note', async () => {
    const source = await openNote(TRIP_NOTE_PATH, 'source');

    expect(source).toContain('file-bundles:');
    expect(source).toContain('folders:');

    await shoot(3, 'A file declares what belongs with it, in its own frontmatter');
  }, TEST_TIMEOUT_IN_MILLISECONDS);

  it('4 - a sidecar declares a bundle for a file that cannot', async () => {
    const source = await openNote(SIDECAR_NOTE_PATH, 'source');

    // `main` is the whole difference between the two forms: without it the declaring note IS the main.
    expect(source).toContain('main:');
    expect(source).toContain('report.html');

    await shoot(4, 'A sidecar bundles a file that cannot carry frontmatter');
  }, TEST_TIMEOUT_IN_MILLISECONDS);

  it('5 - moving the main file moves the bundle', async () => {
    // Relocked first: the propagation this frame is about is what LOCKED means, and shot 2 left this
    // bundle unlocked. Without it the move carries nothing and the caption is a lie — which is what the
    // Android twin produced before the same wait was added there, the main file landing in `Archive/`
    // with its members left behind. Waited on rather than slept through, because locking is a SETTING
    // and the next command can otherwise still run against the unlocked state.
    await openNote(TRIP_NOTE_PATH);
    await runCommand('toggle-lock');
    await waitForDependentsHidden();

    const paths = await moveTripNote();

    // The declared member followed the main file, and nothing was left behind at the old address.
    expect(paths).toContain(MOVED_TRIP_ROUTE_PATH);
    expect(paths).not.toContain(TRIP_ROUTE_PATH);

    // Unlocked again for the frame itself: the move is the claim, and a locked bundle would show a single
    // row under `Archive/` with nothing to prove the rest came too.
    await openNote(MOVED_TRIP_NOTE_PATH);
    await runCommand('toggle-lock');

    const { names } = await readExplorer();
    expect(names).toContain(ARCHIVE_FOLDER);
    expect(names).toContain(TRIP_ROUTE_ROW_NAME);

    await shoot(5, 'Move the main file and the whole bundle moves with it');
  }, TEST_TIMEOUT_IN_MILLISECONDS);
});

/**
 * Moves the trip note into `Archive/`, the way dragging it in the File Explorer does.
 *
 * `fileManager.renameFile` rather than `vault.rename`: it is the sink Obsidian's own File Explorer drag
 * calls and the one the plugin listens to, so what the frame shows is the plugin's answer rather than
 * something this suite arranged.
 *
 * @returns Every file path in the vault afterwards.
 */
async function moveTripNote(): Promise<string[]> {
  await pollInObsidian({
    input: {
      movedMemberPath: MOVED_TRIP_ROUTE_PATH,
      movedNotePath: MOVED_TRIP_NOTE_PATH,
      sourceNotePath: TRIP_NOTE_PATH
    },

    // The plugin plans the move and then runs it through a vault transaction, so the rename returning and
    // the dependents having arrived are different events. The dependent itself is the signal.
    poll({ app, movedMemberPath }): boolean {
      return Boolean(app.vault.getFileByPath(movedMemberPath));
    },
    async start({ app, movedNotePath, sourceNotePath }): Promise<void> {
      const file = app.vault.getFileByPath(sourceNotePath);
      if (!file) {
        throw new Error(`The trip note is missing: ${sourceNotePath}`);
      }

      // `renameFile` does not create the destination's parent — it fails with a bare `ENOENT` naming the
      // two paths, which reads as the plugin refusing the move rather than as a missing folder.
      const destinationFolder = movedNotePath.slice(0, movedNotePath.lastIndexOf('/'));
      if (!app.vault.getFolderByPath(destinationFolder)) {
        await app.vault.createFolder(destinationFolder);
      }

      await app.fileManager.renameFile(file, movedNotePath);
    },
    timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS,
    timeoutMessage: 'the declared member never followed the main file',
    until: (hasMemberArrived: boolean): boolean => hasMemberArrived,
    vaultPath: vaultPath()
  });

  await sleepInNode(SETTLE_DELAY_IN_MILLISECONDS);

  return await readVaultPaths();
}

/**
 * Opens a note and leaves it on screen for the capture.
 *
 * @param notePath - Vault-relative path of the note.
 * @param mode - `preview` frames the explorer beside a rendered note; `source` is for the two frames
 *   whose subject is the declaration itself.
 * @returns The text the editor is painting, so a frame whose subject is the declaration can assert that
 *   the declaration is the thing on screen.
 */
async function openNote(notePath: string, mode: 'preview' | 'source' = 'preview'): Promise<string> {
  await pollInObsidian({
    input: { mode, notePath },
    poll(): boolean {
      return Boolean(document.querySelector('.cm-content, .markdown-preview-view'));
    },
    async start({ app, mode: viewMode, notePath: path }): Promise<void> {
      const file = app.vault.getFileByPath(path);
      if (!file) {
        throw new Error(`Note is missing from the vault: ${path}`);
      }

      const leaf = app.workspace.getLeaf(false);
      await leaf.openFile(file);
      await leaf.setViewState({
        // `source: true` is what puts the editor in TRUE source mode. With `source: false` the mode is
        // Live Preview, which renders frontmatter through the properties panel — so a frame captioned
        // "declares it in its frontmatter" would show no frontmatter at all.
        state: { file: path, mode: viewMode === 'source' ? 'source' : 'preview', source: viewMode === 'source' },
        type: 'markdown'
      });
    },
    timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS,
    timeoutMessage: `the note never rendered: ${notePath}`,
    until: (isRendered: boolean): boolean => isRendered,
    vaultPath: vaultPath()
  });

  await sleepInNode(NOTE_SETTLE_DELAY_IN_MILLISECONDS);

  return await readEditorText();
}

/**
 * Reads the text the editor is painting.
 *
 * The text the EDITOR is painting, not the file's content. The two declaration frames claim the
 * declaration is on screen, and reading it off disk would pass just as happily with the editor showing
 * something else entirely — which is the mistake this whole suite exists to not make.
 *
 * @returns What the editor shows, or the empty string when no editor is open.
 */
async function readEditorText(): Promise<string> {
  return await evalInObsidian({
    callback() {
      return document.querySelector('.cm-content')?.textContent ?? '';
    },
    vaultPath: vaultPath()
  });
}

/**
 * Expands every folder and reads back what the File Explorer is showing.
 *
 * The tree arrives fully collapsed, and a folder the tree has not expanded is a folder whose rows do not
 * exist — which reads exactly like a bundle hiding them. Expanded on every call rather than once, because
 * a move creates a new folder and it arrives collapsed.
 *
 * Hidden dependents are hidden with `display: none`, so they stay in the DOM and keep matching the
 * selector. That is why both halves of the result measure what is PAINTED rather than what exists: a
 * frame is judged on what a reader can see.
 *
 * Three short transport calls rather than one long one — wait for the tree, expand it, read it — with the
 * settle between the last two spent in Node.
 *
 * @returns The visible names joined, and how many file rows are painted.
 */
async function readExplorer(): Promise<ExplorerReading> {
  await pollInObsidian({
    poll(): number {
      return document.querySelectorAll('.nav-files-container .nav-folder').length;
    },
    timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS,
    timeoutMessage: 'the file explorer never listed the staged files',
    until: (folderCount: number): boolean => folderCount > 0,
    vaultPath: vaultPath()
  });

  await evalInObsidian({
    async callback({ app }) {
      const fileExplorerView = app.workspace.getLeavesOfType('file-explorer')[0]?.view as FileExplorerView | undefined;
      for (const item of Object.values(fileExplorerView?.fileItems ?? {})) {
        if (item.collapsed === true) {
          await item.setCollapsed?.(false);
        }
      }
    },
    vaultPath: vaultPath()
  });

  await sleepInNode(SETTLE_DELAY_IN_MILLISECONDS);

  return await evalInObsidian({
    callback() {
      const names = [...document.querySelectorAll('.nav-files-container .nav-file-title-content, .nav-files-container .nav-folder-title-content')]
        .filter((entry) => entry.getBoundingClientRect().width > 0)
        .map((entry) => entry.textContent)
        .join(' | ');

      const visibleFileCount = [...document.querySelectorAll('.nav-files-container .nav-file')]
        .filter((row) => row.getBoundingClientRect().height > 0)
        .length;

      const markedMainNames = [...document.querySelectorAll('.nav-files-container .file-bundles-main .nav-file-title-content')]
        .filter((entry) => entry.getBoundingClientRect().width > 0)
        .map((entry) => entry.textContent)
        .sort();

      return { markedMainNames, names, visibleFileCount };
    },
    vaultPath: vaultPath()
  });
}

/**
 * Counts the dialogs currently on screen.
 *
 * @returns How many modal containers are painted.
 */
async function readOpenModalCount(): Promise<number> {
  return await evalInObsidian({
    callback() {
      return [...document.querySelectorAll('.modal-container')]
        .filter((modal) => modal.getBoundingClientRect().height > 0)
        .length;
    },
    vaultPath: vaultPath()
  });
}

/**
 * Reads every file path in the vault.
 *
 * Its own short call, so the wait that precedes it never holds the transport longer than one cheap walk.
 *
 * @returns The paths.
 */
async function readVaultPaths(): Promise<string[]> {
  return await evalInObsidian({
    callback({ app }) {
      return app.vault.getFiles().map((candidate) => candidate.path);
    },
    vaultPath: vaultPath()
  });
}

/**
 * Runs one of the plugin's commands against the active file.
 *
 * @param commandId - The command's id, without the plugin prefix.
 */
async function runCommand(commandId: string): Promise<void> {
  await evalInObsidian({
    callback({ app, commandId: id, pluginId }) {
      // `executeCommandById` returns false silently when the id is wrong, which reads from outside as a
      // command that ran and did nothing — so the return value is checked rather than ignored.
      if (!app.commands.executeCommandById(`${pluginId}:${id}`)) {
        throw new Error(`The command did not run: ${pluginId}:${id}`);
      }
    },
    input: { commandId, pluginId: PLUGIN_ID },
    vaultPath: vaultPath()
  });

  await sleepInNode(SETTLE_DELAY_IN_MILLISECONDS);
}

/**
 * Captures the window, captions it, and writes it as
 * `images/screenshots/screenshot-desktop-<index>.png`.
 *
 * @param index - The 1-based listing position.
 * @param caption - The caption drawn across the bottom of the frame.
 */
async function shoot(index: number, caption: string): Promise<void> {
  // No frame ships with a dialog across it. On the phone, Obsidian's own "Update links" sheet took the
  // bottom half of a measured frame, and because the rename behind it was still waiting for an answer the
  // shot was wrong in two ways at once. Checked on both platforms, so it cannot come back quietly here.
  expect(await readOpenModalCount()).toBe(0);

  const bytes = await captureObsidianScreenshot({
    heightInPixels: HEIGHT_IN_PIXELS,
    vaultPath: vaultPath(),
    widthInPixels: WIDTH_IN_PIXELS
  });

  const labeled = await labelScreenshot(bytes, { text: caption });

  expect(readPngDimensions(labeled)).toStrictEqual({
    heightInPixels: HEIGHT_IN_PIXELS,
    widthInPixels: WIDTH_IN_PIXELS
  });

  mkdirSync(IMAGES_DIRECTORY, { recursive: true });
  writeFileSync(join(IMAGES_DIRECTORY, `screenshot-desktop-${String(index)}.png`), labeled);
}

/**
 * The vault the harness staged for this run.
 *
 * @returns Its absolute path.
 */
function vaultPath(): string {
  return getTemporaryVault().path;
}

/**
 * Waits until the trip bundle's dependents are out of the File Explorer again.
 *
 * Locking is a SETTING, written to `data.json`, so the command returning and the lock being in force are
 * different events. The explorer is the honest signal that it landed: the rows a locked bundle hides are
 * hidden by the same index the move consults.
 *
 * @throws Error if the bundle never relocks.
 */
async function waitForDependentsHidden(): Promise<void> {
  for (let attempt = 0; attempt < LOCK_POLL_ATTEMPTS; attempt++) {
    const { names } = await readExplorer();
    if (!names.includes(TRIP_ASSETS_FOLDER_NAME)) {
      return;
    }

    await sleepInNode(LOCK_POLL_INTERVAL_IN_MILLISECONDS);
  }

  throw new Error('The bundle never relocked — its dependents are still in the File Explorer.');
}

/**
 * Reads the explorer until it has marked exactly the expected main files.
 *
 * The tree builds its rows lazily, so a folder that has just been expanded hands the plugin's observer
 * rows it has never classified — and a reading taken in that window sees a bundle main as an ordinary
 * file. Waited on rather than slept through: a fixed settle passed four runs and failed the fifth, which
 * is precisely the kind of capture flakiness that ships a frame contradicting its caption.
 *
 * @param expected - The row names that should carry the marker, sorted.
 * @returns The settled reading.
 * @throws Error if the marks never settle.
 */
async function waitForMarkedMains(expected: readonly string[]): Promise<ExplorerReading> {
  let reading = await readExplorer();
  for (let attempt = 0; attempt < MARK_POLL_ATTEMPTS; attempt++) {
    if (reading.markedMainNames.join('|') === expected.join('|')) {
      return reading;
    }

    await sleepInNode(MARK_POLL_INTERVAL_IN_MILLISECONDS);
    reading = await readExplorer();
  }

  return reading;
}
