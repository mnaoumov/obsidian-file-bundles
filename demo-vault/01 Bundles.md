# Bundles

A **bundle** is a main file plus the files and folders it declares as its own. This vault ships two, both under `Materials/01 Bundles/`.

- `Trip note.md`
  - a markdown main file, declaring `Trip assets/Route.svg` and the `Trip assets` folder in its own frontmatter.
- `Report/report.html`
  - an HTML main file, which cannot carry frontmatter — so `Quarterly report.md` sits beside it and declares the bundle on its behalf. That name is not derived from `report.html` in any way, and nothing needs it to be: the `file-bundles` key inside the note is what marks the declaration.

## What a bundle does

By default a bundle is **locked**:

- its dependents are hidden in the File Explorer, so you see only the main file;
- moving, renaming or deleting the main file carries the whole bundle along;
- unlocking it splits the pieces back into independent files.

The hiding is display only. The dependents stay in the vault index and stay resolvable as link targets — that is what separates a locked bundle from a folder you excluded.

## See what travels with a file

Open `Trip note.md` and run the command below. It reports the bundle the active file belongs to, whether that file is a main file, the note declaring one, or one of the dependents.

For the report bundle, open the sidecar `Report/Quarterly report.md` rather than `report.html` — Obsidian cannot open an HTML file, so the sidecar is the only half of that pair you can stand on. Every command works from it, and reports the bundle it declares. Finding it took no naming convention: a sidecar is marked by its `file-bundles` key, so it is free to be called whatever suits the note — and calling it `report.html.md` would have been worse than useless, painting a second row labelled `report` beside the main file with nothing on screen to tell the two apart.

```code-button
---
caption: Show the bundle of the active file
---
require('/demoSetup.ts').runCommand(app, 'show-bundle');
```

Manual equivalent: run the Command Palette entry **File Bundles: Show the bundle the active file belongs to**.

## Delete the whole bundle

Deleting a bundle deletes its main file and everything the declaration names — except anything another bundle also claims, which is left alone.

```code-button
---
caption: Delete the bundle of the active file
---
require('/demoSetup.ts').runCommand(app, 'delete-bundle');
```

Manual equivalent: **File Bundles: Delete the bundle the active file belongs to**, or right-click any file the bundle claims and choose **Delete bundle**.

This is the same route a bundle takes when you delete its main file any other way: the command only trashes the main file, and the ordinary deletion path carries the rest.

## Duplicate the whole bundle

Duplicating copies the main file, the note that declares it, and every dependent anchored to it with `./` — and then rewrites the copy's declaration, so the duplicate names its own files rather than the original's. A rooted `/…` member is shared instead of copied: it states a home of its own, so both bundles point at the same file.

```code-button
---
caption: Duplicate the bundle of the active file
---
require('/demoSetup.ts').runCommand(app, 'duplicate-bundle');
```

Manual equivalent: **File Bundles: Duplicate the bundle the active file belongs to**.

Try it with `Trip note.md` open: you get `Trip note 1.md` beside it, carrying a `Trip assets 1` folder of its own, and the copy's frontmatter names `./Trip assets 1` rather than the folder it was copied from. Obsidian's own **Make a copy** does none of that — it copies the one file, and the copy is left claiming the original's dependents.

## What it does not take over

This plugin never registers a rename/delete handler of its own. Updating the links to a renamed note, and moving the attachments it owns, belong to [Advanced Rename and Delete Handler](https://github.com/mnaoumov/obsidian-advanced-rename-and-delete-handler) — one vault, one owner of that behavior. File Bundles moves only the dependents a bundle declares.

## A file two bundles share

A file declared by two bundles is never deleted with one of them. Deleting the other main file leaves it alone, because something still claims it.
