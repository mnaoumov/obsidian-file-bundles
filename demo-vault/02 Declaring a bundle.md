# Declaring a bundle

A declaration is a `file-bundles` key in a markdown file's frontmatter. The **key** is what marks it — never the file's name — so any markdown file anywhere can declare a bundle, and a file that declares one is still an ordinary note you can write in.

## A markdown file declares its own bundle

`Materials/01 Bundles/Trip note.md` carries this:

```yaml
---
file-bundles:
  files:
    - "[[./Trip assets/Route.svg]]"
  folders:
    - ./Trip assets
---
```

## A file that cannot carry frontmatter gets a sidecar

`Materials/01 Bundles/Report/report.html.md` declares the bundle for the HTML file beside it, naming it as `main`:

```yaml
---
file-bundles:
  main: "[[./report.html]]"
  files:
    - "[[./report-styles.css]]"
  folders:
    - ./Report images
---
```

## The keys

- `main`
  - the file the bundle is built around. Omit it and the declaring note is itself the main file.
- `files`
  - links to the files that travel with the main file, written as wikilinks or as markdown links.
- `folders`
  - folders that travel with it, written as paths — or as a link to a folder note, meaning that note's folder.
- `renameDependents`
  - whether renaming the main file renames these dependents too, overriding the plugin-wide default for this one bundle.

The main file and the note that declares the bundle are always members. You never list them.

## Paths say which base they mean

Every path is either explicitly relative (`./Trip assets`) or explicitly rooted at the vault (`/Shared/Brand`). A bare `Trip assets` is rejected rather than guessed at: a sidecar can live anywhere, so it would be ambiguous between the note's own folder and the vault root, and Obsidian's shortest-path link resolution would silently pick one.

## Why links, and where the free bookkeeping ends

A link in `files` is a real link as far as Obsidian is concerned, so renaming or moving the file it points at rewrites the declaration for you. Two limits are worth knowing:

- markdown links in frontmatter are only indexed when [Frontmatter Markdown Links](https://github.com/mnaoumov/obsidian-frontmatter-markdown-links) is installed, so without it the wikilink form is the one that stays correct by itself;
- Obsidian has no folder link at all, so a path under `folders` is kept correct by this plugin rather than by Obsidian. A link to a folder's **folder note** is the one form that survives a rename for free, and it is accepted here for exactly that reason.
