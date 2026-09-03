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
      if (this.isUnlocked(declaration)) {
        continue;
      }

      const moves = [
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
      await rewriteBundleDeclaration({
        app: this.app,
        declaration: toMovedDeclaration({
          declaration,
          moves,
          newPath: event.newPath,
          oldPath: event.oldPath
        }),
        frontmatterKey: this.pluginSettingsComponent.settings.frontmatterKey
      });
    }
  }

  private isUnlocked(declaration: BundleDeclaration): boolean {
    return this.pluginSettingsComponent.settings.unlockedBundleMainPaths.includes(declaration.mainPath);
  }
}
