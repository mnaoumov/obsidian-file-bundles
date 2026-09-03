import type {
  App,
  TAbstractFile,
  TFile
} from 'obsidian';

import { LayoutReadyComponent } from 'obsidian-dev-utils/obsidian/components/layout-ready-component';
import { PathSettings } from 'obsidian-dev-utils/obsidian/path-settings';
import { getMarkdownFilesSorted } from 'obsidian-dev-utils/obsidian/vault';

import type { BundleDeclaration } from './bundle-declaration.ts';
import type { PluginSettingsComponent } from './plugin-settings-component.ts';

import { parseBundleDeclaration } from './bundle-declaration.ts';
import { BundleIndex } from './bundle-index.ts';

/**
 * A bundle's own file is about to be forgotten, reported while its declaration is still knowable.
 */
export interface BundleDeleteEvent {
  /**
   * The bundles whose main file or declaring note was deleted.
   */
  readonly declarations: readonly BundleDeclaration[];

  /**
   * Every other bundle in the vault, so a caller can tell which dependents are shared.
   */
  readonly otherDeclarations: readonly BundleDeclaration[];

  /**
   * The deleted path.
   */
  readonly path: string;
}

/**
 * Parameters for the {@link BundleIndexComponent} constructor.
 */
export interface BundleIndexComponentConstructorParams {
  /**
   * The Obsidian application instance.
   */
  readonly app: App;

  /**
   * The live plugin settings, read for the declaration key and the excluded paths.
   */
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

/**
 * A bundle's own file has been renamed or moved, reported while its members still hold the paths they have
 * on disk.
 */
export interface BundleRenameEvent {
  /**
   * The bundles whose main file or declaring note moved.
   */
  readonly declarations: readonly BundleDeclaration[];

  /**
   * Where that file is now.
   */
  readonly newPath: string;

  /**
   * Where that file was.
   */
  readonly oldPath: string;
}

/**
 * Keeps a {@link BundleIndex} current: a full read at layout-ready, then incremental updates off the
 * metadata cache and the vault's own events.
 *
 * The index is what every operation reads, and it is deliberately the ONLY reader of the declaration at
 * operation time. Measured against Obsidian 1.14.0: on delete the declaring note is already gone when the
 * event fires, and on move Obsidian has already rewritten the declaration's links into its own
 * shortest-path style. Re-parsing at that moment would answer with a bundle that is missing or reshaped, so
 * membership has to be known BEFORE the mutation, which is what this component maintains.
 */
export class BundleIndexComponent extends LayoutReadyComponent {
  private readonly changeHandlers = new Set<() => void>();
  private readonly deletionHandlers = new Set<(event: BundleDeleteEvent) => void>();
  private readonly index: BundleIndex;
  private readonly pathSettings = new PathSettings();
  private readonly pluginSettingsComponent: PluginSettingsComponent;
  private readonly renameHandlers = new Set<(event: BundleRenameEvent) => void>();

  /**
   * Creates the component.
   *
   * @param params - The parameters.
   */
  public constructor(params: BundleIndexComponentConstructorParams) {
    super(params.app);
    this.pluginSettingsComponent = params.pluginSettingsComponent;
    this.index = new BundleIndex({
      shouldExcludePath: (path: string): boolean => this.pathSettings.isPathIgnored(path)
    });
  }

  /**
   * Answers the index this component maintains.
   *
   * @returns The index.
   */
  public getIndex(): BundleIndex {
    return this.index;
  }

  /**
   * Wires the incremental updates.
   */
  public override onload(): void {
    super.onload();

    this.registerEvent(this.app.metadataCache.on('changed', (file) => {
      this.readDeclaration(file);
      this.notifyChanged();
    }));

    this.registerEvent(this.app.vault.on('delete', (file) => {
      this.forgetPath(file);
      this.notifyChanged();
    }));

    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      this.handleRename(file, oldPath);
      this.notifyChanged();
    }));

    /*
     * The settings component raises its own async events rather than Obsidian's, so they are unregistered
     * by hand on unload instead of through `registerEvent`.
     */
    const rebuildOnSettingsChange = (): void => {
      this.rebuild();
    };
    this.pluginSettingsComponent.on('loadSettings', rebuildOnSettingsChange);
    this.pluginSettingsComponent.on('saveSettings', rebuildOnSettingsChange);
    this.register(() => {
      this.pluginSettingsComponent.off('loadSettings', rebuildOnSettingsChange);
      this.pluginSettingsComponent.off('saveSettings', rebuildOnSettingsChange);
    });
  }

  /**
   * Registers a handler invoked whenever the index changed, so a view can redraw.
   *
   * @param handler - The handler.
   */
  public registerChangeHandler(handler: () => void): void {
    this.changeHandlers.add(handler);
    this.register(() => {
      this.changeHandlers.delete(handler);
    });
  }

  /**
   * Registers a handler invoked when a bundle's own file is about to be forgotten, BEFORE the index drops
   * it.
   *
   * The moment matters: `vault.on('delete')` fires after the fact, so by the time anything else could look,
   * the declaring note is gone and nothing can say what went with it. This hands the caller the
   * declaration as it stood.
   *
   * @param handler - The handler.
   */
  public registerDeleteHandler(handler: (event: BundleDeleteEvent) => void): void {
    this.deletionHandlers.add(handler);
    this.register(() => {
      this.deletionHandlers.delete(handler);
    });
  }

  /**
   * Registers a handler invoked when a bundle's own file has been renamed or moved, BEFORE the index
   * re-paths it.
   *
   * The declarations it receives still hold the paths the members have on disk right now, which is what an
   * operation has to plan against.
   *
   * @param handler - The handler.
   */
  public registerRenameHandler(handler: (event: BundleRenameEvent) => void): void {
    this.renameHandlers.add(handler);
    this.register(() => {
      this.renameHandlers.delete(handler);
    });
  }

  /**
   * Reads every declaration in the vault once the layout is ready.
   */
  protected override onLayoutReady(): void {
    this.rebuild();
  }

  private forgetPath(file: TAbstractFile): void {
    this.notifyDeleting(file.path);
    this.index.removeDeclaration(file.path);

    /*
     * A folder going takes every declaration inside it, and the per-file `delete` events Obsidian raises
     * alongside are not something to rely on for correctness.
     */
    const folderPrefix = `${file.path}/`;
    for (const declaration of this.index.getDeclarations()) {
      if (declaration.declaringPath.startsWith(folderPrefix)) {
        this.index.removeDeclaration(declaration.declaringPath);
      }
    }
  }

  /*
   * A rename is CARRIED in the index, and deliberately not re-read from the note.
   *
   * Re-reading here would answer with the declaration's text, which a rename has just made stale: a folder
   * rename never touches a single note, so `./assets` still names the old folder, and a declaring note's
   * own move is followed by Obsidian rewriting its links asynchronously, so at this instant the note still
   * says where things used to be. Carrying the paths the index already knows is the only answer that matches
   * the disk. The `changed` event that eventually arrives — from Obsidian's rewrite, from this plugin's own,
   * or from the user editing the note — supersedes it with whatever the note then really says.
   */
  private handleRename(file: TAbstractFile, oldPath: string): void {
    this.notifyRenaming(oldPath, file.path);

    const renamedDeclarations: BundleDeclaration[] = [];

    for (const declaration of this.index.getDeclarations()) {
      if (!isAffectedByRename(declaration, oldPath)) {
        continue;
      }

      this.index.removeDeclaration(declaration.declaringPath);
      renamedDeclarations.push(toRenamedDeclaration(declaration, oldPath, file.path));
    }

    for (const declaration of renamedDeclarations) {
      this.index.setDeclaration(declaration);
    }
  }

  private notifyChanged(): void {
    for (const handler of this.changeHandlers) {
      handler();
    }
  }

  private notifyDeleting(path: string): void {
    if (this.deletionHandlers.size === 0) {
      return;
    }

    const declarations = this.index.getDeclarations()
      .filter((declaration) => declaration.declaringPath === path || declaration.mainPath === path);
    if (declarations.length === 0) {
      return;
    }

    const otherDeclarations = this.index.getDeclarations()
      .filter((declaration) => !declarations.includes(declaration));

    for (const handler of this.deletionHandlers) {
      handler({ declarations, otherDeclarations, path });
    }
  }

  private notifyRenaming(oldPath: string, newPath: string): void {
    if (this.renameHandlers.size === 0) {
      return;
    }

    const declarations = this.index.getDeclarations()
      .filter((declaration) => declaration.declaringPath === oldPath || declaration.mainPath === oldPath);
    if (declarations.length === 0) {
      return;
    }

    for (const handler of this.renameHandlers) {
      handler({ declarations, newPath, oldPath });
    }
  }

  private readDeclaration(file: TFile): void {
    /*
     * No cache entry means the note has not been parsed YET, which is not the same as it declaring nothing.
     * Reading it as "nothing" would drop a live bundle every time a rename outran the cache.
     */
    const cache = this.app.metadataCache.getFileCache(file);
    if (!cache) {
      return;
    }

    const { declaration } = parseBundleDeclaration({
      app: this.app,
      declaringPath: file.path,
      frontmatter: cache.frontmatter,
      frontmatterKey: this.pluginSettingsComponent.settings.frontmatterKey
    });

    if (declaration) {
      this.index.setDeclaration(declaration);
      return;
    }

    this.index.removeDeclaration(file.path);
  }

  private rebuild(): void {
    this.pathSettings.excludePaths = [...this.pluginSettingsComponent.settings.excludedPathPatterns];
    this.index.clear();

    for (const file of getMarkdownFilesSorted(this.app)) {
      this.readDeclaration(file);
    }

    this.notifyChanged();
  }
}

function isAffectedByRename(declaration: BundleDeclaration, oldPath: string): boolean {
  const paths = [
    declaration.declaringPath,
    declaration.mainPath,
    ...declaration.members.map((member) => member.path)
  ];
  const oldFolderPrefix = `${oldPath}/`;
  return paths.some((path) => path === oldPath || path.startsWith(oldFolderPrefix));
}

function toRenamedDeclaration(declaration: BundleDeclaration, oldPath: string, newPath: string): BundleDeclaration {
  return {
    ...declaration,
    declaringPath: toRenamedPath(declaration.declaringPath, oldPath, newPath),
    mainPath: toRenamedPath(declaration.mainPath, oldPath, newPath),
    members: declaration.members.map((member) => ({
      ...member,
      path: toRenamedPath(member.path, oldPath, newPath)
    }))
  };
}

function toRenamedPath(path: string, oldPath: string, newPath: string): string {
  if (path === oldPath) {
    return newPath;
  }

  const oldFolderPrefix = `${oldPath}/`;
  return path.startsWith(oldFolderPrefix) ? `${newPath}/${path.slice(oldFolderPrefix.length)}` : path;
}
