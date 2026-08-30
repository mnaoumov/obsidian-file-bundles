# Bundles

A **bundle** is a main file plus the files and folders it declares as its own. This vault ships two, both under `Materials/01 Bundles/`.

- `Trip note.md`
  - a markdown main file, declaring `Trip assets/Route.svg` and the `Trip assets` folder in its own frontmatter.
- `Report/report.html`
  - an HTML main file, which cannot carry frontmatter — so `report.html.md` sits beside it and declares the bundle on its behalf.

## What a bundle does

By default a bundle is **locked**:

- its dependents are hidden in the File Explorer, so you see only the main file;
- moving, renaming or deleting the main file carries the whole bundle along;
- unlocking it splits the pieces back into independent files.

The hiding is display only. The dependents stay in the vault index and stay resolvable as link targets — that is what separates a locked bundle from a folder you excluded.

## See what travels with a file

Open either main file and run the command below. It reports the bundle the active file belongs to, whether the file is a main or one of its dependents.

```code-button
---
caption: Show the bundle of the active file
---
require('/demoSetup.ts').runCommand(app, 'show-bundle');
```

Manual equivalent: run the Command Palette entry **File Bundles: Show the bundle the active file belongs to**.

## What it does not take over

This plugin never registers a rename/delete handler of its own. Updating the links to a renamed note, and moving the attachments it owns, belong to [Advanced Rename and Delete Handler](https://github.com/mnaoumov/obsidian-advanced-rename-and-delete-handler) — one vault, one owner of that behavior. File Bundles moves only the dependents a bundle declares.

## A file two bundles share

A file declared by two bundles is never deleted with one of them. Deleting the other main file leaves it alone, because something still claims it.
