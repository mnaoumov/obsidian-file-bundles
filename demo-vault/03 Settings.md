# Settings

Open **Settings -> Community plugins -> File Bundles** to see the settings tab. Each option below lists the setting key stored in the plugin's `data.json`.

## What counts as a declaration

- `frontmatterKey`
  - the frontmatter key a markdown file uses to declare a bundle. The key is what marks a declaration, never the file name, so changing this changes what the plugin looks for and nothing else.
- `excludedPathPatterns`
  - paths matching any of these are never treated as part of a bundle, whether they declare one or are declared by one. Each entry is a plain path, matching it and everything under it, or a regular expression between slashes — the same syntax the rest of this author's plugins use for include/exclude lists.

## What a locked bundle does

- `shouldHideDependentsInFileExplorer`
  - show only a bundle's main file in the File Explorer. This is display only: the dependents stay in the vault index and stay resolvable as link targets.
- `shouldPropagateDeletions`
  - delete a bundle's dependents along with its main file. A dependent that another bundle also declares is never deleted with one of them.
- `shouldRenameDependents`
  - rename a bundle's dependents to follow the main file's new base name. Off by default, because a dependent is not necessarily named after its main, and renaming one would rename it out from under anything else that links to it. A single bundle can override this with `renameDependents` in its own declaration.

## State, not a preference

- `unlockedBundleMainPaths`
  - the bundles you have unlocked, by main file path. It is in `data.json` rather than the settings tab because it is a record of what you did, not a preference — see [04 Locking and unlocking](<./04 Locking and unlocking.md>). The plugin keeps these paths pointing at the right bundles as you move them around.
