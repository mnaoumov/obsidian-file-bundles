import type { App } from 'obsidian';

import { invokeAsyncSafely } from 'obsidian-dev-utils/async';
import { ComponentEx } from 'obsidian-dev-utils/obsidian/components/component-ex';

import type { BundleDeclaration } from './bundle-declaration.ts';
import type {
  BundleDeleteEvent,
  BundleIndexComponent,
  BundleRenameEvent
} from './bundle-index-component.ts';
import type { PluginSettingsComponent } from './plugin-settings-component.ts';

import {
  applyBundleMoves,
  planBundleDeletion,
  planBundleMove,
  planBundleRename,
  rewriteBundleDeclaration,
  toMovedDeclaration,
  trashBundlePaths
} from './bundle-operations.ts';

/**
 * Parameters for the {@link BundleOperationsComponent} constructor.
 */
export interface BundleOperationsComponentConstructorParams {
  /**
   * The Obsidian application instance.
   */
  readonly app: App;

  /**
   * The index, which reports a bundle's own file moving or going while its declaration is still knowable.
   */
  readonly bundleIndexComponent: BundleIndexComponent;

  /**
   * The live plugin settings.
   */
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

/**
 * Makes what happens to a main file happen to its bundle.
 *
 * It reacts to the vault's own `rename` and `delete` rather than owning them: Advanced Rename and Delete
 * Handler is the single owner of rename/delete in a vault and refuses to load beside a plugin that competes
 * for that, so this plugin subscribes like any other listener, moves only the dependents a bundle declares,
 * and leaves every link and attachment to that plugin.
 */
export class BundleOperationsComponent extends ComponentEx {
  private readonly app: App;
  private readonly bundleIndexComponent: BundleIndexComponent;
  private readonly pluginSettingsComponent: PluginSettingsComponent;

  /**
   * Creates the component.
   *
   * @param params - The parameters.
   */
  public constructor(params: BundleOperationsComponentConstructorParams) {
    super();
    this.app = params.app;
    this.bundleIndexComponent = params.bundleIndexComponent;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
  }

  /**
   * Subscribes to the index's pre-mutation reports.
   */
  public override onload(): void {
    super.onload();

    this.bundleIndexComponent.registerRenameHandler((event) => {
      invokeAsyncSafely(() => this.handleRename(event));
    });

    this.bundleIndexComponent.registerDeleteHandler((event) => {
      invokeAsyncSafely(() => this.handleDelete(event));
    });
  }

  /**
   * Keeps the unlocked list pointing at the bundle it unlocked.
   *
   * The list is keyed by main path, so a move would otherwise leave it naming a file that no longer exists —
   * and the bundle would silently lock itself again the moment the user moved it.
   */
  private async followUnlockedMainPath(oldMainPath: string, newMainPath: string): Promise<void> {
    if (oldMainPath === newMainPath) {
      return;
    }

    const { unlockedBundleMainPaths } = this.pluginSettingsComponent.settings;
    if (!unlockedBundleMainPaths.includes(oldMainPath)) {
      return;
    }

    await this.pluginSettingsComponent.editAndSave((settings) => {
      settings.unlockedBundleMainPaths = settings.unlockedBundleMainPaths
        .map((path) => path === oldMainPath ? newMainPath : path);
    });
  }

  private async handleDelete(event: BundleDeleteEvent): Promise<void> {
    if (!this.pluginSettingsComponent.settings.shouldPropagateDeletions) {
      return;
    }

    for (const declaration of event.declarations) {
      if (this.isUnlocked(declaration)) {
        continue;
      }

      const paths = planBundleDeletion({
        declaration,
        otherDeclarations: event.otherDeclarations
      });
      await trashBundlePaths({ app: this.app, paths });
    }
  }

  private async handleRename(event: BundleRenameEvent): Promise<void> {
    for (const declaration of event.declarations) {
      /*
       * An unlocked bundle moves nothing, but its declaration is still maintained. Unlocking means "do not
       * move my files", not "let the declaration rot": Obsidian has just stripped the anchoring off every
       * entry, and leaving it that way would mean a bundle that no longer parses by the time it is locked
       * again.
       */
      const moves = this.isUnlocked(declaration)
        ? []
        : [
          ...planBundleMove({
            declaration,
            newPath: event.newPath,
            oldPath: event.oldPath
          }),
          ...planBundleRename({
            declaration,
            newPath: event.newPath,
            oldPath: event.oldPath,
            shouldRenameDependents: declaration.renameDependents
              ?? this.pluginSettingsComponent.settings.shouldRenameDependents
          })
        ];

      await applyBundleMoves({ app: this.app, moves });

      /*
       * Rewritten even when nothing moved: Obsidian has just re-pointed the declaration's links in its own
       * shortest-path style, stripping the prefixes the format requires, so this is what puts the anchoring
       * back before the next read rejects them.
       */
      const movedDeclaration = toMovedDeclaration({
        declaration,
        moves,
        newPath: event.newPath,
        oldPath: event.oldPath
      });

      await this.followUnlockedMainPath(declaration.mainPath, movedDeclaration.mainPath);

      await rewriteBundleDeclaration({
        app: this.app,
        declaration: movedDeclaration,
        frontmatterKey: this.pluginSettingsComponent.settings.frontmatterKey
      });
    }
  }

  private isUnlocked(declaration: BundleDeclaration): boolean {
    return this.pluginSettingsComponent.settings.unlockedBundleMainPaths.includes(declaration.mainPath);
  }
}
