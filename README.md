# File Bundles

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ffdd00?logo=buy-me-a-coffee&logoColor=black)](https://www.buymeacoffee.com/mnaoumov) [![GitHub release](https://img.shields.io/github/v/release/mnaoumov/obsidian-file-bundles)](https://github.com/mnaoumov/obsidian-file-bundles/releases) [![GitHub downloads](https://img.shields.io/github/downloads/mnaoumov/obsidian-file-bundles/total)](https://github.com/mnaoumov/obsidian-file-bundles/releases)

An HTML page and the assets it loads, a note and the images pasted into it, a scanned invoice and the note describing it — these are one thing to you and several files to Obsidian. Move the main file and the rest stay behind. Delete it and they are orphaned. This plugin lets a file declare which files and folders belong with it, and then treats them as one **bundle**: what happens to the main file happens to the whole thing.

## What makes it different

**The dependency is declared, not inferred from a naming convention.** Every existing plugin in this space recognizes a bundle by where a file sits or what it is called — a note and its same-named attachment folder, a sidecar named after the file beside it. That works until the two things you want bundled do not share a name or a folder. Here you say which files belong together, in the main file's own frontmatter, and nothing depends on what they are called.

**It is not limited to notes.** An HTML file, a PDF or an image can be the main file of a bundle. Those cannot carry frontmatter, so they get a small sidecar note that declares the bundle on their behalf — the declaration is marked by the frontmatter key, never by the file name, so that note is an ordinary note you can also write in.

**A bundle is locked by default.** Its dependents are hidden in the File Explorer, leaving only the main file, and moving, renaming or deleting the main file carries them along. Unlock it and the pieces go back to being independent files. The hiding is display only: the dependents stay in your vault index and stay resolvable as link targets, which is what separates a locked bundle from an excluded folder.

**A file that two bundles both declare is never deleted with one of them.**

## Declaring a bundle

A markdown file declares its own bundle inline:

```yaml
---
file-bundles:
  files:
    - "[[./assets/diagram.png]]"
    - "[[/shared/logo.png]]"
  folders:
    - ./assets
---
```

A file that cannot carry frontmatter gets a sidecar note that names it:

```yaml
---
file-bundles:
  main: "[[./report.html]]"
  files:
    - "[[./report-styles.css]]"
  folders:
    - ./report-images
---
```

- `main`
  - The file the bundle is built around. Omit it and the declaring note is itself the main file.
- `files`
  - Links to the files that travel with it, as wikilinks or as markdown links.
- `folders`
  - Folders that travel with it, as paths — or as a link to a folder note, meaning that note's folder.

**Every path is explicitly relative (`./assets`) or explicitly rooted (`/shared/brand`).** A sidecar can live anywhere, so a bare `assets` would be ambiguous between the declaring file and the vault root, and this plugin would rather reject it than guess.

The main file and the note that declares the bundle are always members. You never list them.

## Usage

Run **File Bundles: Show the bundle the active file belongs to** to see what travels with the file you are looking at.

## Demo vault

**The documentation is a demo vault.** Every feature has a note that explains what it does, with a worked example you can search yourself.

**[Start reading here](<./demo-vault/00 Start.md>)** — it is plain markdown, so it works on GitHub with nothing installed.

A copy of the vault ships with every release. You can access it via any of the following:

1. Running the **File Bundles: Open demo vault** command.
2. Downloading `file-bundles-demo-vault-<version>.zip` (`<version>` is the release version) from the [Releases](https://github.com/mnaoumov/obsidian-file-bundles/releases).
3. Browsing its source in [`demo-vault/`](./demo-vault/README.md) in this repository.

## Installation

### Beta versions

To install the latest beta release of this plugin (regardless if it is available in [the official Community Plugins repository](https://community.obsidian.md) or not), follow these steps:

1. Ensure you have the [BRAT plugin](https://community.obsidian.md/plugins/obsidian42-brat) installed and enabled.
2. Click [Install via BRAT](https://intradeus.github.io/http-protocol-redirector?r=obsidian://brat?plugin=https://github.com/mnaoumov/obsidian-file-bundles).
3. An Obsidian pop-up window should appear. In the window, click the `Add plugin` button once and wait a few seconds for the plugin to install.

## Debugging

By default, debug messages for this plugin are hidden.

To show them, run the following command:

```js
window.DEBUG.enable('file-bundles');
```

For more details, refer to the [documentation](https://mnaoumov.dev/obsidian-dev-utils/guides/debugging/).

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
