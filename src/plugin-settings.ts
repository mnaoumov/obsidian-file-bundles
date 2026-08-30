export class PluginSettings {
  /**
   * Paths matching any of these are never treated as part of a bundle, whether they declare one or are
   * declared by one. Matched against the whole vault-relative path, so a pattern can exclude a folder or
   * a single file.
   */
  public excludedPathPatterns: readonly string[] = [];

  /**
   * The frontmatter key a markdown file uses to declare a bundle.
   *
   * The key is what marks a declaration — never the file name. A binary main file gets a sidecar note
   * carrying this key with an explicit `main`; a markdown main declares inline and omits `main`.
   */
  public frontmatterKey = 'file-bundles';

  /**
   * Whether a bundle's dependents are hidden in the File Explorer, leaving only its main file visible.
   *
   * This is display only. Dependents stay in the vault index and stay resolvable as link targets, which
   * is what separates a locked bundle from an excluded path.
   */
  public shouldHideDependentsInFileExplorer = true;

  /**
   * Whether deleting a bundle's main file deletes its dependents too.
   *
   * A dependent that another bundle also declares is never deleted with one of them.
   */
  public shouldPropagateDeletions = true;

  /**
   * Whether renaming a bundle's main file renames its dependents to follow the new base name.
   *
   * Off by default: a dependent is not necessarily named after its main, and renaming one would rename it
   * out from under anything else that links to it. A bundle can override this with `renameDependents` in
   * its own declaration.
   */
  public shouldRenameDependents = false;
}
