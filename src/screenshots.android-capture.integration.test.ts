/**
 * @file
 *
 * Produces the mobile screenshots the community-store listing needs, driving a staged vault in Obsidian
 * Mobile on a real Android emulator and writing `images/screenshots/screenshot-mobile-N.png`.
 *
 * FOUR shots: the same story the desktop suite tells, minus its sidecar frame, which is a desktop
 * reader's problem — an HTML page and its assets are not what a phone is used for. Worth taking on a
 * phone rather than reusing the desktop set because the file tree here is a DRAWER the reader rarely
 * opens, so a bundle collapsing four rows into one is worth more on the small screen than on the large
 * one.
 *
 * The order is not the desktop order. Forcing an editor into source mode keeps the drawer shut for the
 * rest of the session, so the three drawer frames are taken first and the declaration frame last.
 *
 * There is no mobile equivalent of the desktop viewport override, so the capture is always the device's
 * own framebuffer — a dedicated `obsidian_screenshots` AVD built at exactly 900x1600, so the frame
 * already IS the store's size. The `readPngDimensions` assertion in `shoot` is what keeps that true: run
 * this against any other AVD and it fails loudly instead of quietly shipping an off-spec image.
 *
 * Split across several short `evalInObsidian` calls because one call is one Appium `execute/sync`, which
 * WebDriver caps near 30 seconds. Where a wait needs longer than that — the drawer retry above all — the
 * waiting happens in NODE, as a `pollInObsidian` whose `poll` does one cheap attempt and returns, with
 * the long budget in `timeoutInMilliseconds` where the cap cannot reach it.
 *
 * Excluded from `npm run test:integration` by its file name — see the `capture-screenshots:android`
 * project in `scripts/vitest-config.ts`.
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
 * What one reading of the file drawer says.
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
}

/**
 * The File Explorer view, reduced to its rows.
 */
interface FileExplorerView {
  fileItems: Record<string, CollapsibleFileItem>;
}

const PLUGIN_ID = 'file-bundles';

const WIDTH_IN_PIXELS = 900;
const HEIGHT_IN_PIXELS = 1600;

const WAIT_TIMEOUT_IN_MILLISECONDS = 20_000;
const TEST_TIMEOUT_IN_MILLISECONDS = 600_000;

/**
 * How long a state that has been waited for is left to finish PAINTING.
 *
 * Slept in Node rather than inside the closure: a settle is wall-clock time either way, and inside it
 * would be charged against the transport's per-eval cap for no benefit.
 */
const SETTLE_DELAY_IN_MILLISECONDS = 1500;

/**
 * The drawer retry's budget, and the gap between attempts.
 *
 * One attempt costs ~5.5s of its own, so the interval is short: the poll's cost IS the spacing. Six such
 * attempts is the ceiling the in-closure loop used to declare, which is why the budget is ~40s — a number
 * only a Node-side wait can honour.
 */
const DRAWER_TIMEOUT_IN_MILLISECONDS = 40_000;
const DRAWER_POLL_INTERVAL_IN_MILLISECONDS = 250;

/**
 * Base font size for the mobile shots.
 *
 * Below Obsidian's own 16px default: the screenshot AVD is a 450x800 dp screen, and this tree is three
 * levels deep, which wraps its rows at 16.
 */
const MOBILE_FONT_SIZE_IN_PIXELS = 13;

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
 * What Obsidian Mobile calls `report.html`.
 *
 * The phone strips the extension from every file it lists, including the ones it cannot open — the
 * desktop app keeps `.html`, so the two suites cannot share this string.
 */
const REPORT_MAIN_ROW_NAME = 'report';
const REPORT_STYLES_NAME = 'report-styles.css';

const ARCHIVE_FOLDER = 'Archive';
const MOVED_TRIP_NOTE_PATH = `${ARCHIVE_FOLDER}/Kyoto trip.md`;
const MOVED_TRIP_ROUTE_PATH = `${ARCHIVE_FOLDER}/${TRIP_ASSETS_FOLDER_NAME}/Route.svg`;

/**
 * How the move is waited on from the Node side: 90 checks two seconds apart, three minutes in all.
 *
 * The emulator is far slower at this than the desktop app — the plugin plans the move and then runs it
 * through a vault transaction against virtual storage, and a first measured run had not finished after a
 * minute. Short per call because each check is its own `execute/sync`, which WebDriver caps near 30
 * seconds.
 */
const MOVE_POLL_ATTEMPTS = 90;
const MOVE_POLL_INTERVAL_IN_MILLISECONDS = 2000;

/**
 * How the relock is waited on: 10 readings of the drawer, two seconds apart.
 *
 * Each reading is itself a settle, so this is far longer than it looks — and it has to be, because the
 * lock is a setting written to the device's storage.
 */
const LOCK_POLL_ATTEMPTS = 10;
const LOCK_POLL_INTERVAL_IN_MILLISECONDS = 2000;

/**
 * The rows that carry the bundle marker, in the order `readExplorer` sorts them.
 */
const EXPECTED_MAIN_ROW_NAMES = ['Kyoto trip', REPORT_MAIN_ROW_NAME];

/**
 * How the marker is waited on: 10 readings of the drawer, a second apart.
 */
const MARK_POLL_ATTEMPTS = 10;
const MARK_POLL_INTERVAL_IN_MILLISECONDS = 1000;

const IMAGES_DIRECTORY = join(process.cwd(), 'images', 'screenshots');

/**
 * Diagnostics from the setup closure, surfaced by the first test so a failed mobile layout is readable
 * instead of silent — vitest swallows console output from an integration worker.
 */
let setupDiagnostics: unknown;

/**
 * A placeholder drawing, big enough to be a real file rather than a token.
 *
 * Shapes rather than text, so it renders the same on any host: SVG text resolves through whatever fonts
 * the machine happens to carry.
 *
 * @param label - Which accent color to use, so the assets are visibly different files.
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
 * The same fixtures as the desktop suite, so a reader who meets both sets meets one vault.
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

  vault.populate(buildFixtures());
  await vault.syncToDevice();

  await pollInObsidian({
    input: {
      fontSizeInPixels: MOBILE_FONT_SIZE_IN_PIXELS,
      sidecarNotePath: SIDECAR_NOTE_PATH,
      tripNotePath: TRIP_NOTE_PATH
    },

    // BOTH declarations, not just the trip note's. The plugin's index is built from the metadata cache, so
    // a bundle whose declaration has not been parsed yet is not a bundle: its main file carries no marker
    // and its dependents are not hidden. Waiting on one of the two let the sidecar bundle be photographed
    // unmarked.
    poll({ app, sidecarNotePath, tripNotePath }): boolean {
      return [tripNotePath, sidecarNotePath].every((path) => {
        const file = app.vault.getFileByPath(path);
        return Boolean(file && app.metadataCache.getFileCache(file)?.frontmatter);
      });
    },
    start({ app, fontSizeInPixels }): void {
      app.changeTheme('obsidian');

      const style = createEl('style');
      // The drawer's foot carries the vault switcher, which in a capture run shows the harness's
      // generated `temp-vault-XXXXXX` name — private-looking data that belongs in no listing. Hidden
      // rather than renamed, because the name is the harness's to choose, not this suite's. Both
      // selectors: the switcher was rebuilt between Obsidian versions and each ships one.
      style.textContent = [
        '.workspace-drawer-vault-switcher, .workspace-drawer-header-switcher { visibility: hidden; }',
        // A notice is a full-width band across the TOP of a phone screen, and every frame here follows a
        // command that raises one. In the move frame it covered the `Archive` row — the single thing that
        // shot exists to show. The desktop twin keeps its notices: there they sit in a corner of an empty
        // editor and obscure nothing.
        //
        // Both selectors, because hiding `.notice-container` alone did NOT work on the phone and the
        // frame shipped with the band still across it. `shoot` asserts neither is painted, so a rule that
        // stops matching a future Obsidian fails the run instead of quietly returning the band.
        '.notice-container, .notice { display: none !important; }'
      ].join('\n');
      document.head.append(style);

      app.vault.setConfig('baseFontSize', fontSizeInPixels);
      app.updateFontSize();

      // Each staged note opens with its own `# H1`, so the inline title doubles it.
      app.vault.setConfig('showInlineTitle', false);
      app.updateInlineTitleDisplay();

      // A `file-bundles` declaration is a NESTED frontmatter object, and Obsidian's properties panel has
      // no editor for one — it prints the raw JSON in the red it uses for a type it cannot render. On a
      // phone frame that band of red is the largest thing in the picture, and none of the drawer shots
      // makes a claim about it. The declaration shot uses true source mode, where it is not drawn.
      app.vault.setConfig('propertiesInDocument', 'hidden');
      app.workspace.updateOptions();

      // Obsidian Mobile leaves file types it cannot open out of the tree, so `report.html` — the main
      // file of the sidecar bundle — is simply not there, and half the story cannot be told. The desktop
      // app lists it either way. The demo vault turns this on for the same reason.
      app.vault.setConfig('showUnsupportedFiles', true);

      // Without this, moving a note whose frontmatter links its own dependents raises Obsidian's
      // "Update links — do you want to update internal links that link to this file?" sheet, and the
      // rename SITS THERE waiting for an answer. From outside that reads as the plugin declining to move
      // the bundle: the main file lands in its new folder, the members never follow, and the next frame
      // is photographed with the sheet across the bottom half of it. The desktop harness writes this into
      // `app.json` before it starts ("headless rename support"); the Android one does not, so the suite
      // sets it itself.
      app.vault.setConfig('alwaysUpdateLinks', true);
    },
    timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS,
    timeoutMessage: 'both declarations never reached the metadata cache',
    until: (areBothCached: boolean): boolean => areBothCached,
    vaultPath: vaultPath()
  });

  await sleepInNode(SETTLE_DELAY_IN_MILLISECONDS);

  setupDiagnostics = await evalInObsidian({
    callback({ app, tripNotePath }) {
      return { isVaultReady: Boolean(app.vault.getFileByPath(tripNotePath)) };
    },
    input: { tripNotePath: TRIP_NOTE_PATH },
    vaultPath: vaultPath()
  });
}, TEST_TIMEOUT_IN_MILLISECONDS);

describe('mobile store screenshots', () => {
  it('stages the fixtures the shots are framed on', () => {
    expect(setupDiagnostics).toMatchObject({ isVaultReady: true });
  });

  it('1 - a locked bundle hides what it declares', async () => {
    await openNote(TRIP_NOTE_PATH);
    const { markedMainNames, names } = await waitForMarkedMains(EXPECTED_MAIN_ROW_NAMES);

    expect(names).toContain('Kyoto trip');
    expect(names).toContain(REPORT_MAIN_ROW_NAME);
    expect(names).not.toContain(TRIP_ASSETS_FOLDER_NAME);
    expect(names).not.toContain(TRIP_ROUTE_ROW_NAME);
    expect(names).not.toContain(REPORT_STYLES_NAME);

    // The sidecar STAYS, and that is by design rather than an oversight in the framing: `isDependent`
    // answers false for a declaring note, because a note someone wrote about the report is a note they
    // still want to open.
    expect(names).toContain(SIDECAR_ROW_NAME);

    // The marker glyph is the only thing in the frame that says WHICH rows are bundles.
    expect(markedMainNames).toStrictEqual(EXPECTED_MAIN_ROW_NAMES);

    await shoot(1, 'A locked bundle hides the files it declares');
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

  it('3 - moving the main file moves the bundle', async () => {
    // Relocked first: the propagation this frame is about is what LOCKED means, and shot 2 left this
    // bundle unlocked. Without it the move carries nothing and the caption is a lie — which is exactly
    // what a measured run produced, the main file landing in `Archive/` with its members left behind,
    // because the relock had not taken effect by the time the rename fired.
    await openNote(TRIP_NOTE_PATH);
    await runCommand('toggle-lock');
    await waitForDependentsHidden();

    const paths = await moveTripNote();

    expect(paths).toContain(MOVED_TRIP_ROUTE_PATH);
    expect(paths).not.toContain(TRIP_ROUTE_PATH);

    // Unlocked again for the frame itself: a locked bundle under `Archive/` is a single row with nothing
    // to prove the rest came too.
    await openNote(MOVED_TRIP_NOTE_PATH);
    await runCommand('toggle-lock');

    const { names } = await readExplorer();
    expect(names).toContain(ARCHIVE_FOLDER);
    expect(names).toContain(TRIP_ROUTE_ROW_NAME);

    await shoot(3, 'Move the main file and the whole bundle moves with it');
  }, TEST_TIMEOUT_IN_MILLISECONDS);

  it('4 - the declaration lives in the note', async () => {
    // LAST, and deliberately so: forcing the editor into source mode keeps the drawer shut for the rest
    // of the session, so every drawer frame has to be taken before this one.
    const source = await openNote(MOVED_TRIP_NOTE_PATH, false, 'source');

    expect(source).toContain('file-bundles:');
    expect(source).toContain('folders:');

    await shoot(4, 'A file declares what belongs with it, in its own frontmatter');
  }, TEST_TIMEOUT_IN_MILLISECONDS);
});

/**
 * Moves the trip note into `Archive/`, the way dragging it in the file drawer does.
 *
 * `fileManager.renameFile` rather than `vault.rename`: it is the sink Obsidian's own drag calls and the
 * one the plugin listens to, so what the frame shows is the plugin's answer rather than something this
 * suite arranged.
 *
 * @returns Every file path in the vault afterwards.
 */
async function moveTripNote(): Promise<string[]> {
  // The rename is awaited here and the RESULT is polled from Node across several short calls. One
  // `evalInObsidian` is one Appium `execute/sync`, which WebDriver caps near 30 seconds, and folding the
  // rename and the wait for its dependents into a single closure exceeds that on an emulator — the whole
  // call then dies as a bare `script timeout` long after the rename has succeeded.
  await evalInObsidian({
    async callback({ app, movedNotePath, sourceNotePath }) {
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
    input: {
      movedNotePath: MOVED_TRIP_NOTE_PATH,
      sourceNotePath: TRIP_NOTE_PATH
    },
    vaultPath: vaultPath()
  });

  let lastPaths: string[] = [];
  for (let attempt = 0; attempt < MOVE_POLL_ATTEMPTS; attempt++) {
    const paths = await readVaultPaths();
    if (paths.includes(MOVED_TRIP_ROUTE_PATH)) {
      return paths;
    }

    lastPaths = paths;
    await sleepInNode(MOVE_POLL_INTERVAL_IN_MILLISECONDS);
  }

  // The vault as it actually stands plus the moved note's own declaration, because "it never arrived",
  // "it arrived somewhere else" and "the declaration no longer names it" are three different bugs and the
  // message alone cannot tell them apart.
  const declaration = await readMovedDeclaration();
  throw new Error(
    `The declared member never followed the main file to ${MOVED_TRIP_ROUTE_PATH}.`
      + ` The vault holds: ${lastPaths.join(', ')}.`
      + ` The moved note declares: ${declaration}`
  );
}

/**
 * Puts the file drawer out over the note, and waits until it has actually finished sliding.
 *
 * Opening a file CLOSES the drawer on a phone, and it does so asynchronously — one `expand()` in the same
 * turn is undone a moment later, which is why this RETRIES rather than waits. The drawer also SLIDES, so a
 * frame taken mid-animation is a black panel with the note shoved off the right edge; checking a row is
 * painted at a sane x is what proves the animation finished.
 *
 * The retry is the Node-side poll and one attempt is the `poll` closure: six attempts at ~5.5s each is
 * 33s of waiting, which inside a single closure is past the transport's ~30s per-eval cap and could only
 * ever have died as a bare `script timeout`. Spread across separate short calls it is a budget the
 * transport can honour.
 *
 * @throws Error if the drawer never opens, quoting the two facts that told the story when it did not.
 */
async function openDrawer(): Promise<void> {
  try {
    await pollInObsidian({
      intervalInMilliseconds: DRAWER_POLL_INTERVAL_IN_MILLISECONDS,

      // One attempt. COLLAPSE first, always: the drawer's `collapsed` flag and its actual visibility drift
      // apart on a phone — after the first note is opened the split reports `collapsed === false` while
      // the drawer element is still `display: none`, and in that state `expand()` is a no-op that returns
      // happily and shows nothing. Toggling it shut and open again re-runs the code that displays it.
      //
      // Under the transport's ~30s per-closure cap, not at it. The budget is one toggle delay plus two
      // drawer settles — 5 500 ms — because the RETRY now lives in Node rather than in a loop here.
      async poll({ app }): Promise<boolean> {
        const DRAWER_SETTLE_DELAY_IN_MILLISECONDS = 2500;
        const TOGGLE_DELAY_IN_MILLISECONDS = 500;

        app.workspace.leftSplit.collapse();
        await sleep(TOGGLE_DELAY_IN_MILLISECONDS);
        app.workspace.leftSplit.expand();
        await sleep(DRAWER_SETTLE_DELAY_IN_MILLISECONDS);

        // ONLY once the drawer is out. The mobile drawer is tabbed — files, search, bookmarks — and an
        // open drawer showing the wrong tab lays the file rows out at zero width, which looks exactly
        // like a drawer that never opened. Revealing BEFORE expanding, though, leaves it shut.
        const fileExplorerLeaf = app.workspace.getLeavesOfType('file-explorer')[0];
        if (fileExplorerLeaf) {
          await app.workspace.revealLeaf(fileExplorerLeaf);
        }

        await sleep(DRAWER_SETTLE_DELAY_IN_MILLISECONDS);

        // ALL rows, not `querySelector`'s first: Obsidian leaves earlier renders in the document, so the
        // first match can be a detached row that is zero-sized no matter what the drawer does.
        return [...document.querySelectorAll('.nav-files-container .tree-item-self')]
          .map((row) => row.getBoundingClientRect())
          .some((rect) => rect.width > 0 && rect.left >= 0);
      },
      timeoutInMilliseconds: DRAWER_TIMEOUT_IN_MILLISECONDS,
      timeoutMessage: 'the file drawer never finished opening',
      until: (isOpen: boolean): boolean => isOpen,
      vaultPath: vaultPath()
    });
  } catch (error) {
    throw new Error(`The file drawer never finished opening. ${await readDrawerDiagnostics()}`, { cause: error });
  }
}

/**
 * Opens a note, with or without the file drawer over it.
 *
 * Reading view by default, unlike the desktop suite. Forcing `mode: 'source'` puts the phone in the
 * editor, and from there the drawer refuses to open at all — every `expand()` is undone before the next
 * frame. That is why the one source-mode frame is taken last.
 *
 * @param notePath - Vault-relative path of the note.
 * @param shouldShowTree - Whether the file drawer should be open over the note.
 * @param mode - `preview` for the drawer frames, `source` for the declaration frame.
 * @returns The text the editor is painting, so a frame whose subject is the declaration can assert that
 *   the declaration is the thing on screen.
 */
async function openNote(notePath: string, shouldShowTree = true, mode: 'preview' | 'source' = 'preview'): Promise<string> {
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
        state: { file: path, mode: viewMode === 'source' ? 'source' : 'preview', source: viewMode === 'source' },
        type: 'markdown'
      });
    },
    timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS,
    timeoutMessage: `the note never rendered: ${notePath}`,
    until: (isRendered: boolean): boolean => isRendered,
    vaultPath: vaultPath()
  });

  if (shouldShowTree) {
    await openDrawer();
  } else {
    await evalInObsidian({
      callback({ app }) {
        app.workspace.leftSplit.collapse();
      },
      vaultPath: vaultPath()
    });
  }

  await sleepInNode(SETTLE_DELAY_IN_MILLISECONDS);

  return await readEditorText();
}

/**
 * The two facts that told the story when the drawer failed to open: the split's own flag, and whether the
 * drawer element is actually displayed. They disagree, and that disagreement IS the bug `openDrawer`
 * works around — so the failure quotes both rather than saying only that the rows never appeared.
 *
 * @returns A one-line summary.
 */
async function readDrawerDiagnostics(): Promise<string> {
  return await evalInObsidian({
    callback({ app }) {
      const drawer = document.querySelector('.workspace-drawer.mod-left');
      const display = drawer ? window.getComputedStyle(drawer).display : 'no-drawer';
      return `collapsed=${String(app.workspace.leftSplit.collapsed)} display=${display}`;
    },
    vaultPath: vaultPath()
  });
}

/**
 * Reads the text the editor is painting.
 *
 * The text the EDITOR is painting, not the file's content. The declaration frame claims the declaration is
 * on screen, and reading it off disk would pass just as happily with the editor showing something else
 * entirely — which is the mistake this whole suite exists to not make.
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
 * Expands every folder in the drawer and reads back what it is showing.
 *
 * The tree arrives fully collapsed, and a folder the tree has not expanded is a folder whose rows do not
 * exist — which reads exactly like a bundle hiding them. Expanded on every call rather than once, because
 * a move creates a new folder and it arrives collapsed.
 *
 * Three short transport calls rather than one long one — wait for the tree, expand it, read it — with the
 * settle between the last two spent in Node.
 *
 * @returns The visible names joined, and the rows marked as bundle main files.
 */
async function readExplorer(): Promise<ExplorerReading> {
  await pollInObsidian({
    poll(): number {
      return document.querySelectorAll('.nav-files-container .tree-item-self').length;
    },
    timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS,
    timeoutMessage: 'the file drawer never listed the staged files',
    until: (rowCount: number): boolean => rowCount > 0,
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

      const markedMainNames = [...document.querySelectorAll('.nav-files-container .file-bundles-main .nav-file-title-content')]
        .filter((entry) => entry.getBoundingClientRect().width > 0)
        .map((entry) => entry.textContent)
        .sort();

      return { markedMainNames, names };
    },
    vaultPath: vaultPath()
  });
}

/**
 * Reads the moved note's frontmatter, and whether the plugin is still loaded.
 *
 * Only ever called to explain a failure: what the declaration says after the rename separates "the plugin
 * never saw the move" from "it saw it and planned nothing".
 *
 * @returns A one-line summary.
 */
async function readMovedDeclaration(): Promise<string> {
  return await evalInObsidian({
    async callback({ app, movedNotePath, pluginId }) {
      const file = app.vault.getFileByPath(movedNotePath);
      const text = file ? await app.vault.read(file) : '(the moved note is not there)';
      const isPluginEnabled = app.plugins.enabledPlugins.has(pluginId);
      return `${JSON.stringify(text.split('---', 2)[1] ?? text)} (plugin enabled: ${String(isPluginEnabled)})`;
    },
    input: { movedNotePath: MOVED_TRIP_NOTE_PATH, pluginId: PLUGIN_ID },
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
      // Notices count as dialogs here. On a phone a notice is a full-width band across the TOP of the
      // screen, over the file drawer — where every one of these frames has its subject — so an
      // unnoticed one is a frame that does not show the thing its caption claims.
      return [...document.querySelectorAll('.modal-container, .notice, .notice-container')]
        .filter((element) => element.getBoundingClientRect().height > 0)
        .length;
    },
    vaultPath: vaultPath()
  });
}

/**
 * Reads every file path in the vault.
 *
 * Its own short call, so the polling loop never holds the transport longer than one cheap walk.
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
 * Captures the device's framebuffer, captions it, and writes it as
 * `images/screenshots/screenshot-mobile-<index>.png`.
 *
 * @param index - The 1-based listing position.
 * @param caption - The caption drawn across the bottom of the frame.
 */
async function shoot(index: number, caption: string): Promise<void> {
  // No frame ships with a dialog across it. Obsidian's own "Update links" sheet took the bottom half of a
  // measured frame, and because the rename behind it was still waiting for an answer the shot was wrong
  // in two ways at once. Checked here rather than remembered, so it cannot come back quietly.
  expect(await readOpenModalCount()).toBe(0);

  const captured = await captureObsidianScreenshot({ vaultPath: vaultPath() });

  // The AVD is 900x1600, so the device frame IS the store's size. Asserting it here is what keeps that
  // true: run this against any other AVD and it fails loudly instead of quietly shipping an off-spec
  // image.
  expect(readPngDimensions(captured)).toStrictEqual({
    heightInPixels: HEIGHT_IN_PIXELS,
    widthInPixels: WIDTH_IN_PIXELS
  });

  const labeled = await labelScreenshot(captured, { text: caption });

  mkdirSync(IMAGES_DIRECTORY, { recursive: true });
  writeFileSync(join(IMAGES_DIRECTORY, `screenshot-mobile-${String(index)}.png`), labeled);
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
 * Waits until the trip bundle's dependents are out of the drawer again.
 *
 * Locking is a SETTING, written to `data.json`, and on a device that write is slow enough that the very
 * next command can still run against the unlocked state. The drawer is the honest signal that it landed:
 * the rows a locked bundle hides are hidden by the same index the move consults.
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

  throw new Error('The bundle never relocked — its dependents are still in the drawer.');
}

/**
 * Reads the drawer until it has marked exactly the expected main files.
 *
 * The tree builds its rows lazily, so a folder that has just been expanded hands the plugin's observer
 * rows it has never classified — and a reading taken in that window sees a bundle main as an ordinary
 * file. Waited on rather than slept through: on the desktop twin a fixed settle passed four runs and
 * failed the fifth, which is precisely the kind of capture flakiness that ships a frame contradicting its
 * caption.
 *
 * @param expected - The row names that should carry the marker, sorted.
 * @returns The settled reading.
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
