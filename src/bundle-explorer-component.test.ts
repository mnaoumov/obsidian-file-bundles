import type {
  FileExplorerView,
  FileTreeItem
} from '@obsidian-typings/obsidian-public-latest';
import type {
  App as AppOriginal,
  WorkspaceLeaf
} from 'obsidian';

import { sleep } from 'obsidian-dev-utils/async';
import { castTo } from 'obsidian-dev-utils/object-utils';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { BundleDeclaration } from './bundle-declaration.ts';
import type { BundleIndexComponent } from './bundle-index-component.ts';
import type { PluginSettingsComponent } from './plugin-settings-component.ts';

import {
  BundleMemberAnchoring,
  BundleMemberKind
} from './bundle-declaration.ts';
import { BundleExplorerComponent } from './bundle-explorer-component.ts';
import { BundleIndex } from './bundle-index.ts';
import { PluginSettings } from './plugin-settings.ts';

interface TreeItemElements {
  readonly el: HTMLElement;
  readonly selfEl: HTMLElement;
}

const ALPHA_PATH = 'Alpha/alpha.md';
const DEPENDENT_PATH = 'Alpha/assets/diagram.png';
const LAYOUT_READY_DELAY_IN_MS = 10;

describe('BundleExplorerComponent', () => {
  let app: App;
  let appOriginal: AppOriginal;
  let changeHandlers: (() => void)[];
  let container: HTMLElement;
  let elementsByPath: Map<string, TreeItemElements>;
  let index: BundleIndex;
  let settings: PluginSettings;

  beforeEach(() => {
    vi.clearAllMocks();
    app = App.createConfigured__();
    appOriginal = app.asOriginalType__();
    appOriginal.workspace.onLayoutReady = vi.fn((callback: () => void) => {
      callback();
    });
    changeHandlers = [];
    index = new BundleIndex();
    settings = new PluginSettings();
    container = createDiv();
    elementsByPath = new Map();
  });

  function addRow(path: string): TreeItemElements {
    const el = createDiv();
    const selfEl = createDiv();
    el.append(selfEl);
    container.append(el);
    const elements = { el, selfEl };
    elementsByPath.set(path, elements);
    return elements;
  }

  function stubFileExplorer(): void {
    const fileItems: Record<string, FileTreeItem> = {};
    for (const [path, elements] of elementsByPath) {
      fileItems[path] = castTo<FileTreeItem>(elements);
    }

    const view = strictProxy<FileExplorerView>({
      containerEl: container,
      fileItems
    });
    appOriginal.workspace.getLeavesOfType = vi.fn(() => [castTo<WorkspaceLeaf>({ view })]);
  }

  function declare(declaration: BundleDeclaration): void {
    index.setDeclaration(declaration);
  }

  function createBundle(): BundleDeclaration {
    return {
      declaringPath: ALPHA_PATH,
      mainPath: ALPHA_PATH,
      members: [{
        anchoring: BundleMemberAnchoring.Relative,
        isAnchorPrefixMissing: false,
        isWikilink: true,
        kind: BundleMemberKind.File,
        path: DEPENDENT_PATH
      }]
    };
  }

  async function createComponent(): Promise<BundleExplorerComponent> {
    const component = new BundleExplorerComponent({
      app: appOriginal,
      bundleIndexComponent: strictProxy<BundleIndexComponent>({
        getIndex: () => index,
        registerChangeHandler: (handler: () => void) => {
          changeHandlers.push(handler);
        }
      }),
      pluginSettingsComponent: strictProxy<PluginSettingsComponent>({ settings })
    });
    component.load();
    // The base component defers its layout-ready work by a turn of the event loop.
    await sleep({ milliseconds: LAYOUT_READY_DELAY_IN_MS });
    return component;
  }

  function classesOf(path: string): string[] {
    const elements = elementsByPath.get(path);
    return [...elements?.el.classList ?? [], ...elements?.selfEl.classList ?? []];
  }

  it('should mark a main file and fold its dependent away', async () => {
    addRow(ALPHA_PATH);
    addRow(DEPENDENT_PATH);
    stubFileExplorer();
    declare(createBundle());

    await createComponent();

    expect(classesOf(ALPHA_PATH)).toContain('file-bundles-main');
    expect(classesOf(DEPENDENT_PATH)).toContain('file-bundles-hidden');
  });

  it('should leave a file no bundle claims untouched', async () => {
    addRow('Alpha/unrelated.md');
    stubFileExplorer();
    declare(createBundle());

    await createComponent();

    expect(classesOf('Alpha/unrelated.md')).toEqual([]);
  });

  /*
   * Unlocking is what splits a bundle back into independent pieces, so its dependents come back into view —
   * dimmed rather than hidden, since they are still declared.
   */
  it('should reveal and dim the dependents of an unlocked bundle', async () => {
    addRow(DEPENDENT_PATH);
    stubFileExplorer();
    declare(createBundle());
    settings.unlockedBundleMainPaths = [ALPHA_PATH];

    await createComponent();

    expect(classesOf(DEPENDENT_PATH)).toContain('file-bundles-dependent');
    expect(classesOf(DEPENDENT_PATH)).not.toContain('file-bundles-hidden');
  });

  it('should leave dependents visible when hiding is turned off', async () => {
    addRow(DEPENDENT_PATH);
    stubFileExplorer();
    declare(createBundle());
    settings.shouldHideDependentsInFileExplorer = false;

    await createComponent();

    expect(classesOf(DEPENDENT_PATH)).not.toContain('file-bundles-hidden');
  });

  /*
   * A file cannot be half-hidden, so one unlocked claimant is enough to keep it in view.
   */
  it('should keep a shared dependent visible when either bundle is unlocked', async () => {
    addRow(DEPENDENT_PATH);
    stubFileExplorer();
    declare(createBundle());
    declare({
      declaringPath: 'Beta/beta.md',
      mainPath: 'Beta/beta.md',
      members: [{
        anchoring: BundleMemberAnchoring.Rooted,
        isAnchorPrefixMissing: false,
        isWikilink: true,
        kind: BundleMemberKind.File,
        path: DEPENDENT_PATH
      }]
    });
    settings.unlockedBundleMainPaths = ['Beta/beta.md'];

    await createComponent();

    expect(classesOf(DEPENDENT_PATH)).not.toContain('file-bundles-hidden');
  });

  it('should redraw when the index changes', async () => {
    addRow(ALPHA_PATH);
    addRow(DEPENDENT_PATH);
    stubFileExplorer();
    await createComponent();
    expect(classesOf(DEPENDENT_PATH)).not.toContain('file-bundles-hidden');

    declare(createBundle());
    for (const handler of changeHandlers) {
      handler();
    }

    expect(classesOf(DEPENDENT_PATH)).toContain('file-bundles-hidden');
  });

  /*
   * The File Explorer builds rows lazily, so a row can appear with nothing else to announce it.
   */
  it('should draw a row the explorer adds after it was first drawn', async () => {
    addRow(ALPHA_PATH);
    stubFileExplorer();
    declare(createBundle());
    await createComponent();

    const lateRow = addRow(DEPENDENT_PATH);
    stubFileExplorer();
    container.append(createSpan());
    await sleep({ milliseconds: LAYOUT_READY_DELAY_IN_MS });

    expect([...lateRow.el.classList]).toContain('file-bundles-hidden');
  });

  it('should redraw on a workspace layout change', async () => {
    addRow(DEPENDENT_PATH);
    stubFileExplorer();
    await createComponent();

    declare(createBundle());
    app.workspace.trigger('layout-change');

    expect(classesOf(DEPENDENT_PATH)).toContain('file-bundles-hidden');
  });

  it('should leave the explorer as it found it when unloaded', async () => {
    addRow(ALPHA_PATH);
    addRow(DEPENDENT_PATH);
    stubFileExplorer();
    declare(createBundle());
    const component = await createComponent();

    component.unload();

    expect(classesOf(ALPHA_PATH)).toEqual([]);
    expect(classesOf(DEPENDENT_PATH)).toEqual([]);
  });

  it('should do nothing at all when there is no File Explorer open', async () => {
    appOriginal.workspace.getLeavesOfType = vi.fn(() => []);

    const component = await createComponent();
    component.unload();

    expect(changeHandlers).toHaveLength(1);
  });
});
