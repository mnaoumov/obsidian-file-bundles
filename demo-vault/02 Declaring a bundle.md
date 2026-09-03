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

Every path is either explicitly relative (`./Trip assets`, or `../Elsewhere/Route.svg` when it has to climb out of the note's folder) or explicitly rooted at the vault (`/Shared/Brand`). A bare `Trip assets` is rejected rather than guessed at: a sidecar can live anywhere, so it would be ambiguous between the note's own folder and the vault root, and Obsidian's shortest-path link resolution would silently pick one.

**The two forms mean different things when the main file moves.** A relative member is anchored to the main file and travels with it. A rooted member states a home of its own and stays where it is — which is what you want for a shared logo that several bundles point at.

## Why links, and who keeps them correct

A link in `files` is a real link as far as Obsidian is concerned: it appears in the metadata cache, and moving the file it points at rewrites the declaration. Both syntaxes are indexed natively — the wikilink form and the markdown form alike — so [Frontmatter Markdown Links](https://github.com/mnaoumov/obsidian-frontmatter-markdown-links) is not needed for the cache to see them.

What that free rewrite does **not** preserve is the anchoring. Obsidian rewrites a frontmatter link into its own shortest-path style, dropping the `./` or `/` this format requires, so `[[./Trip assets/Route.svg]]` comes back as `[[Route.svg]]`. Left alone, the bundle would quietly dissolve the first time you dragged its main file somewhere else. So this plugin writes the anchoring back after every move — which is why the declaration you wrote is still the declaration you see afterwards.

Obsidian has no folder link at all, so a path under `folders` is kept correct by this plugin rather than by Obsidian. A link to a folder's **folder note** is the one form that survives a rename for free, and it is accepted here for exactly that reason.
