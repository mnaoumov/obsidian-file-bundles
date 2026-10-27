# File Bundles

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ffdd00?logo=buy-me-a-coffee&logoColor=black)](https://www.buymeacoffee.com/mnaoumov) [![GitHub release](https://img.shields.io/github/v/release/mnaoumov/obsidian-file-bundles)](https://github.com/mnaoumov/obsidian-file-bundles/releases) [![GitHub downloads](https://img.shields.io/github/downloads/mnaoumov/obsidian-file-bundles/total)](https://github.com/mnaoumov/obsidian-file-bundles/releases) [![Coverage: 100%](https://img.shields.io/badge/coverage-100%25-brightgreen)](https://github.com/mnaoumov/obsidian-file-bundles)

An HTML page and the assets it loads, a note and the images pasted into it, a scanned invoice and the note describing it — these are one thing to you and several files to Obsidian. Move the main file and the rest stay behind. Delete it and they are orphaned. This plugin lets a file declare which files and folders belong with it, and then treats them as one **bundle**: what happens to the main file happens to the whole thing.

<!-- markdownlint-disable MD033 -->

<a href="https://github.com/mnaoumov/obsidian-file-bundles/blob/HEAD/images/screenshots/screenshot-desktop-1.png"><img src="images/screenshots/screenshot-desktop-1.png" alt="8 files on disk, 4 rows in the explorer" width="600"></a>

<details>
<summary>More screenshots</summary>

<div>
<a href="https://github.com/mnaoumov/obsidian-file-bundles/blob/HEAD/images/screenshots/screenshot-desktop-2.png"><img src="images/screenshots/screenshot-desktop-2.png" alt="Unlock a bundle and its dependents come back, dimmed" width="600"></a>
<a href="https://github.com/mnaoumov/obsidian-file-bundles/blob/HEAD/images/screenshots/screenshot-desktop-3.png"><img src="images/screenshots/screenshot-desktop-3.png" alt="A file declares what belongs with it, in its own frontmatter" width="600"></a>
<a href="https://github.com/mnaoumov/obsidian-file-bundles/blob/HEAD/images/screenshots/screenshot-desktop-4.png"><img src="images/screenshots/screenshot-desktop-4.png" alt="A sidecar bundles a file that cannot carry frontmatter" width="600"></a>
<a href="https://github.com/mnaoumov/obsidian-file-bundles/blob/HEAD/images/screenshots/screenshot-desktop-5.png"><img src="images/screenshots/screenshot-desktop-5.png" alt="Move the main file and the whole bundle moves with it" width="600"></a>
<a href="https://github.com/mnaoumov/obsidian-file-bundles/blob/HEAD/images/screenshots/screenshot-mobile-1.png"><img src="images/screenshots/screenshot-mobile-1.png" alt="A locked bundle hides the files it declares" width="270"></a>
<a href="https://github.com/mnaoumov/obsidian-file-bundles/blob/HEAD/images/screenshots/screenshot-mobile-2.png"><img src="images/screenshots/screenshot-mobile-2.png" alt="Unlock a bundle and its dependents come back, dimmed" width="270"></a>
<a href="https://github.com/mnaoumov/obsidian-file-bundles/blob/HEAD/images/screenshots/screenshot-mobile-3.png"><img src="images/screenshots/screenshot-mobile-3.png" alt="Move the main file and the whole bundle moves with it" width="270"></a>
<a href="https://github.com/mnaoumov/obsidian-file-bundles/blob/HEAD/images/screenshots/screenshot-mobile-4.png"><img src="images/screenshots/screenshot-mobile-4.png" alt="A file declares what belongs with it, in its own frontmatter" width="270"></a>
</div>

</details>

<!-- markdownlint-enable MD033 -->

## Demo vault

**The documentation is a demo vault.** Every feature has a note that explains what it does, with a worked example you can search yourself.

**[Start reading here](<./demo-vault/00 Start.md>)** — it is plain markdown, so it works on GitHub with nothing installed.

A copy of the vault ships with every release. You can access it via any of the following:

1. Running the **`File Bundles`: Open demo vault** command.
2. Downloading `file-bundles-demo-vault.zip` from the [Releases](https://github.com/mnaoumov/obsidian-file-bundles/releases). It unzips into a single `file-bundles-demo-vault-<version>` folder.
3. Browsing its source in [`demo-vault/`](./demo-vault/README.md) in this repository.

## What it does

- **A bundle is declared, not inferred from a naming convention.** A `file-bundles` key in the main file's own frontmatter says which files and folders belong with it, whatever they are called: see [Declaring a bundle](<./demo-vault/02 Declaring a bundle.md>).
- **Any file can be a main file.** An HTML file, a PDF or an image gets a sidecar note that declares the bundle on its behalf: see [Bundles](<./demo-vault/01 Bundles.md>).
- **A locked bundle moves, renames and deletes as one.** Its dependents are hidden in the File Explorer (display only, so they stay linkable) and follow the main file wherever you drag it; unlocking splits them back into independent files: see [Locking and unlocking](<./demo-vault/04 Locking and unlocking.md>).
- **A bundle duplicates as one.** The copy gets its own dependents and a declaration that names them, unlike Obsidian's **Make a copy**: see [Bundles](<./demo-vault/01 Bundles.md>).
- **A shared file is never deleted with one of the bundles declaring it.**
- **Settings** choose the frontmatter key, excluded paths, and what a locked bundle does: see [Settings](<./demo-vault/03 Settings.md>).

## Declaring a bundle

```yaml
---
file-bundles:
  main: "[[./report.html]]"   # omit when this note is itself the main file
  files:
    - "[[./report-styles.css]]"
    - "[[/shared/logo.png]]"
  folders:
    - ./report-images
---
```

Every path is explicitly relative (`./`, travels with the main file) or rooted (`/`, stays put). The keys and rules are in [Declaring a bundle](<./demo-vault/02 Declaring a bundle.md>).

## Usage

Moving and renaming need no command: a bundle follows its main file. Four commands cover the rest, with locking and deleting also on the File Explorer's context menu:

- **`File Bundles`: Show the bundle the active file belongs to**
- **`File Bundles`: Lock or unlock the bundle the active file belongs to**
- **`File Bundles`: Delete the bundle the active file belongs to**
- **`File Bundles`: Duplicate the bundle the active file belongs to**

## Similar plugins

- [`Documents Bundle`](https://community.obsidian.md/plugins/documents-bundle) — turns a note into a folder with an `assets/` folder beside it, saves pasted and dropped files there and keeps the folder's name in step with the note; this plugin has no folder convention and does not capture new attachments, but bundles whatever files and folders a declaration names, wherever they sit.
- [`Sidecars`](https://github.com/awesym/obsidian-sidecars) (not in the community directory) — creates and manages a companion note named after each attachment, cleans up orphaned ones and can dim or hide them in the File Explorer; this plugin pairs files by a declaration rather than by name, and one bundle can hold any number of files and folders.
- [`Media Sidecar Tools`](https://community.obsidian.md/plugins/media-sidecar-tools) — creates a sidecar note for a media file on Ctrl+Click and can hide the media in the File Explorer; this plugin creates no notes, and groups declared files and folders that move, rename, duplicate and delete together.
- [`Att Meta Map`](https://community.obsidian.md/plugins/att-meta-map) — creates companion notes for PDFs and other attachments, fills their properties from file metadata and links several resources to one note through a `source` property; this plugin fills no metadata, and instead carries a bundle's files through file operations and hides them while it is locked.
- [`Depends`](https://community.obsidian.md/plugins/depends) — declares dependencies between notes in frontmatter and writes them as links for the graph view; this plugin's declaration acts on the files themselves, moving and deleting them with their main file.
- [`Nested Notes`](https://community.obsidian.md/plugins/nested-notes) — nests notes under other notes in its own view by drag and drop; this plugin keeps the File Explorer and changes only which rows it shows, with the grouping coming from a declaration.
- [`Custom Attachment Location`](https://community.obsidian.md/plugins/custom-attachment-location) — decides where a note's attachments are stored and keeps that folder in step with the note; it handles one fixed relation, a note and its attachment folder, while this plugin lets any file declare any set of files and folders that belong with it.

Last searched for similar plugins on 2026-10-26.

## Installation

The plugin is available in [the official Community Plugins repository](https://community.obsidian.md/plugins/file-bundles).

### Beta versions

To install the latest beta release of this plugin (regardless if it is available in [the official Community Plugins repository](https://community.obsidian.md) or not), follow these steps:

1. Ensure you have the [BRAT plugin](https://community.obsidian.md/plugins/obsidian42-brat) installed and enabled.
2. Click [Install via BRAT](https://intradeus.github.io/http-protocol-redirector?r=obsidian://brat?plugin=https://github.com/mnaoumov/obsidian-file-bundles).
3. An Obsidian pop-up window should appear. In the window, click the `Add plugin` button once and wait a few seconds for the plugin to install.

## Debugging

By default, debug messages for this plugin (id: `file-bundles`) are hidden.

If you need to enable them refer to the [documentation](https://mnaoumov.dev/obsidian-lib/guides/debugging/).

## Changelog

All notable changes to this project will be documented in the [CHANGELOG](./CHANGELOG.md).

## Contributing

Contributions are welcome — see [CONTRIBUTING](./CONTRIBUTING.md) to get set up.

## Support

<!-- markdownlint-disable MD033 -->

<a href="https://www.buymeacoffee.com/mnaoumov" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" height="60" width="217"></a>

<!-- markdownlint-enable MD033 -->

## My other Obsidian resources

[See my other Obsidian resources](https://github.com/mnaoumov/obsidian-resources).

## License

© [Michael Naumov](https://github.com/mnaoumov/)
