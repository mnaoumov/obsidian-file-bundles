# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

File Bundles lets a file **declare** which files and folders belong with it, and then treats the main file plus its dependents as one **bundle**: locked by default, so the dependents are hidden in the File Explorer and a move, rename or delete of the main file carries them along. Unlocking splits the pieces back into independent files.

Idea captured from a Discord exchange with `rakudo` (2026-08-24 to 2026-08-26) and tracked as `T708-P21`. The prior-art gate (G112) swept the 7,119-entry community registry on 2026-08-30: nothing implements declared dependencies with propagating file operations. Everything near it is one of three narrower things — a folder-convention container (`documents-bundle`), a filename-convention sidecar manager (`awesym/obsidian-sidecars`, `media-sidecar-tools`), or display-only nesting and hiding (`nested-notes`, `explorer-hider`). `depends` declares dependencies in frontmatter but has no filesystem behavior at all, which is why its declaration shape is worth copying and its scope is not.

**This generalizes what Custom Attachment Location does as a special case.** Every plugin near this idea hard-codes "a note and its attachment folder". OCAL answers exactly one question — what is the desired location for a note's attachments — and models no hierarchy and no dependency. The general concept is a different plugin, which is what this is.

## Current state

**Scaffold only.** The plugin registers one command that reports the active file and shows a placeholder notice; the declaration parser, the bundle index, the operations and the File Explorer hiding are not written yet. `README.md` and the demo vault describe the plugin as it is being built to be — the same state `alias-quick-switcher` and `advanced-markdown-export` shipped their scaffolds in. Do not treat their claims as implemented behavior, and do not release until they are.

The build is tracked as `T740-P48`.

## The declaration

One mechanism, two uses: a `file-bundles` frontmatter key in a markdown file.

```yaml
---
file-bundles:
  main: "[[./alpha.jpg]]"        # omit when the declaring note IS the main file
  files:
    - "[[./assets/diagram.png]]" # explicitly relative to the declaring file
    - "[[/shared/logo.png]]"     # explicitly rooted at the vault root
    - "[./notes.pdf](./notes.pdf)"
  folders:
    - ./assets
    - /shared/brand
    - "[[./assets/alpha/!]]"     # a folder named by its folder note
  renameDependents: false        # per-bundle override of the plugin-level default
---
```

- **The frontmatter key is the marker, never the file name.** A markdown main declares inline; a binary main gets a sidecar note carrying the same key with an explicit `main`. `main` defaults to the declaring file, so both are one code path.
- **`files` holds links, in either syntax.** Obsidian's own cache indexes wikilinks in frontmatter; markdown links in frontmatter are indexed only because Frontmatter Markdown Links adds them, so the free rewrite-on-rename holds for the markdown form only when that plugin is installed. Say so in the README rather than depend on it.
- **`folders` accepts an explicit path or a folder-note link.** Obsidian has no folder link, so a path is the form that always works and this plugin rewrites it off `vault.on('rename')` for a `TFolder`. A link to a folder's folder note survives renames for free and is how the owner's own vault is organized, so both are supported. A link means the folder because it is under `folders`; the same link under `files` would mean the note itself.
- **Every path is explicitly relative (`./…`) or explicitly rooted (`/…`).** A bare `assets/alpha` is rejected, not guessed at: a sidecar can live anywhere, so the base is genuinely ambiguous and Obsidian's shortest-path resolution would silently pick one.
- **`main` and the declaring note are implicit members** and are never listed.

## Architecture

Four layers. The bottom three carry all the correctness risk and are unit-testable with no DOM and no `App`.

- `src/bundle-declaration.ts` — parse and write the `file-bundles` key: both link forms, the mandatory `./` / `/` prefix, folder paths vs folder-note links, the implicit-`main` rule. Link handling goes through `obsidian-dev-utils/obsidian/link.ts` (`hasLeadingDot()` / `hasLeadingSlash()`), never a local regex. Folder notes resolve through ODU's `resolveFolderNoteConfig({ app })` / `resolveFolderNote` with `FolderNoteLocation.Auto`.
- `src/bundle-index.ts` — `mainPath` to members, and the reverse `memberPath` to `mainPath`, maintained incrementally off `metadataCache.on('changed')` and the vault's create/rename/delete events.
- `src/bundle-operations.ts` — move, rename, delete and duplicate, over ODU's `VaultTransaction`.
- `src/bundle-explorer-component.ts` — display-only hiding in the File Explorer, plus the unlock affordance.

## Invariants that are easy to break

- **Never register a `RenameDeleteHandlerComponent`.** Advanced Rename and Delete Handler is the single owner of rename/delete in a vault, and its `src/conflicting-plugins.ts` makes it *refuse to load* beside a plugin that owns a handler — its own header explains why competing is unwinnable, since the `runAsyncLinkUpdate` patch sits outside the registry's election and is therefore load-order dependent. This plugin moves only the dependents a bundle declares and leaves links and attachments to that one. Needing to add `file-bundles` to its `CONFLICTING_PLUGINS` list would mean this invariant was already broken.
- **Every bundle operation goes through ODU's `VaultTransaction`.** It is a reversible, `await using`-friendly log of vault mutations with dot-prefixed soft-delete staging that Obsidian's watcher ignores — exactly "move, rename or delete N files as one unit, or none of them". Do not hand-roll rollback.
- **Explorer hiding is display only.** Advanced Exclude hides files by removing them from the vault index (adapter patches, an IndexedDB projection). That is correct for exclusion and wrong here: bundle dependents must stay indexed and resolvable as link targets, which is the whole difference between a locked bundle and an excluded path. Its `src/file-tree-component.ts` is the in-fleet reference for touching the file tree; its index-projection machinery is not.
- **A file two bundles declare is never deleted with one of them.** Advanced Rename and Delete Handler already solves the equivalent for attachments through `GetRescuePathParams.survivingNotePaths`; the same shape applies.
- **Resolving a folder note never creates one.** A folder with no folder note is simply not a valid `folders` link.

## Deviations from the standard plugin architecture

The workspace convention is that all plugins share the same architecture; intentional deviations are documented here.

- **None yet.**

## Open questions the build has to answer

- **Nested frontmatter links.** Frontmatter Markdown Links resolves Obsidian's own `frontmatterLinks` entries with `getNestedPropertyValue(frontmatter, link.key)`, so Obsidian emits dotted nested keys and a link at `file-bundles.files.0` should be indexed and rewritten. Measure it over CDP against a real Obsidian before relying on it, and measure the `./` and `/` prefixes in the same pass: ODU parses both forms, but whether Obsidian's cache *resolves and rewrites* them inside nested frontmatter is the load-bearing claim. If it does not hold, this plugin rewrites those entries itself — the same code path `folders` needs anyway.
- **Delete.** `vault.on('delete')` fires after the fact and there is no pre-delete hook, so a bundle delete either intercepts the entry point or reacts post-hoc — and Advanced Rename and Delete Handler's own cleanup is already acting on the same event. Measure the ordering rather than assuming it.
- **Duplicate.** Obsidian has no duplicate-file event to intercept, so a bundle-aware duplicate is almost certainly a command of this plugin's own.
- **Relationship to Advanced Markdown Export.** Its `src/dependency-resolver.ts` walks *discovered* dependencies (links, embeds, canvas); this plugin acts on *declared* ones. Different sources of truth, so the graph layer does not share cleanly — worth a look, not a blocker.

## Naming and licensing decisions

- **Name: File Bundles**, id `file-bundles`, verified free against the registry on 2026-08-30. Deliberately outside the `sidecar` / `companion` namespace, which is crowded and confusable, and outside the fleet's `Advanced-*` family, which by convention means "improves an Obsidian built-in" — there is no built-in here.
- **No takeover of `obsidian-sidecars`.** The "if you're a plugin dev and would like to take over ownership" notice recorded in the original task was on `Alb-O/obsidian-sidecars`, which now 404s. The project lives at `awesym/obsidian-sidecars` under **GPL-3.0**, incompatible with this fleet's MIT licensing, with no such notice in its README. The hand-over angle is closed.

## Traps to clear before the first release

- The scaffold ships a real rule in `src/styles/main.scss` on purpose. A `styles.css` that builds to **0 bytes** makes `gh release create` fail with `HTTP 400: Bad Content-Length` *after* the tag has been pushed, rolling the whole release back. Keep at least one real rule in there.
- `scripts/version.ts` deliberately carries **no** template-release guard, and must stay that way. The sample-plugin-extended template disables its own release with a guard keyed to the presence of a root `.template` marker file, which the scaffold deletes. It used to be keyed to the template's plugin id instead, so the scaffold's global rename re-armed it against the new plugin and made every release throw — `alias-quick-switcher` and `advanced-markdown-export` both shipped with that defect before it was fixed in T742.
