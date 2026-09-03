import type { FileExplorerView } from '@obsidian-typings/obsidian-public-latest';
import type { App } from 'obsidian';

import { LayoutReadyComponent } from 'obsidian-dev-utils/obsidian/components/layout-ready-component';

import type { BundleIndexComponent } from './bundle-index-component.ts';
import type { PluginSettingsComponent } from './plugin-settings-component.ts';

/**
 * Parameters for the {@link BundleExplorerComponent} constructor.
 */
export interface BundleExplorerComponentConstructorParams {
  /**
   * The Obsidian application instance.
   */
  readonly app: App;

  /**
   * The index, which answers which rows are main files and which are dependents.
   */
  readonly bundleIndexComponent: BundleIndexComponent;

  /**
   * The live plugin settings.
   */
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

const DEPENDENT_CSS_CLASS = 'file-bundles-dependent';
const FILE_EXPLORER_VIEW_TYPE = 'file-explorer';
const HIDDEN_CSS_CLASS = 'file-bundles-hidden';
const MAIN_CSS_CLASS = 'file-bundles-main';

/**
 * Shows a bundle in the File Explorer as one thing: the main file marked, its dependents folded away.
 *
 * Display ONLY. It adds and removes CSS classes on rows the File Explorer has already drawn, and touches
 * nothing else. Advanced Exclude hides a file by removing it from the vault index — correct for exclusion
 * and wrong here, because a bundle's dependents have to stay indexed and stay resolvable as link targets.
 * That is the entire difference between a locked bundle and an excluded folder, so this component
 * deliberately borrows that plugin's way of reaching the file tree and none of its index projection.
 */
export class BundleExplorerComponent extends LayoutReadyComponent {
  private readonly bundleIndexComponent: BundleIndexComponent;
  private readonly pluginSettingsComponent: PluginSettingsComponent;

  /**
   * Creates the component.
   *
   * @param params - The parameters.
   */
  public constructor(params: BundleExplorerComponentConstructorParams) {
    super(params.app);
    this.bundleIndexComponent = params.bundleIndexComponent;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
  }

  /**
   * Removes every class this component added, so unloading the plugin leaves the explorer as it found it.
   */
  public override onunload(): void {
    for (const treeItem of Object.values(this.getFileExplorerView()?.fileItems ?? {})) {
      treeItem.el.removeClass(HIDDEN_CSS_CLASS);
      treeItem.selfEl.removeClass(MAIN_CSS_CLASS, DEPENDENT_CSS_CLASS);
    }

    super.onunload();
  }

  /**
   * Draws the current state, and redraws it whenever the index or the explorer changes.
   */
  protected override onLayoutReady(): void {
    this.apply();

    this.bundleIndexComponent.registerChangeHandler(() => {
      this.apply();
    });

    /*
     * The File Explorer builds rows lazily — expanding a folder or scrolling a long list creates elements
     * this component has never seen, and neither the vault nor the index has anything to say about it. So
     * the DOM itself is what to watch.
     */
    const container = this.getFileExplorerView()?.containerEl;
    if (container) {
      const observer = new MutationObserver(() => {
        this.apply();
      });
      observer.observe(container, { childList: true, subtree: true });
      this.register(() => {
        observer.disconnect();
      });
    }

    this.registerEvent(this.app.workspace.on('layout-change', () => {
      this.apply();
    }));
  }

  private apply(): void {
    const fileExplorerView = this.getFileExplorerView();
    if (!fileExplorerView) {
      return;
    }

    const index = this.bundleIndexComponent.getIndex();
    const { settings } = this.pluginSettingsComponent;

    for (const [path, treeItem] of Object.entries(fileExplorerView.fileItems)) {
      const isMain = index.getDeclarationsOfMain(path).length > 0;
      treeItem.selfEl.toggleClass(MAIN_CSS_CLASS, isMain);

      const declarations = isMain ? [] : index.getDeclarationsOfMember(path);
      const isDependent = !isMain && declarations.length > 0;

      /*
       * A dependent claimed by even one unlocked bundle stays visible: unlocking is what splits a bundle
       * back into independent pieces, and a file cannot be half-hidden.
       */
      const isUnlocked = declarations.some((declaration) => settings.unlockedBundleMainPaths.includes(declaration.mainPath));

      treeItem.selfEl.toggleClass(DEPENDENT_CSS_CLASS, isDependent && isUnlocked);
      treeItem.el.toggleClass(
        HIDDEN_CSS_CLASS,
        isDependent && !isUnlocked && settings.shouldHideDependentsInFileExplorer
      );
    }
  }

  private getFileExplorerView(): FileExplorerView | undefined {
    return this.app.workspace.getLeavesOfType(FILE_EXPLORER_VIEW_TYPE)[0]?.view as FileExplorerView | undefined;
  }
}
