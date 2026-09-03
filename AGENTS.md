# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

File Bundles lets a file **declare** which files and folders belong with it, and then treats the main file plus its dependents as one **bundle**: locked by default, so the dependents are hidden in the File Explorer and a move, rename or delete of the main file carries them along. Unlocking splits the pieces back into independent files.

Idea captured from a Discord exchange with `rakudo` (2026-08-24 to 2026-08-26) and tracked as `T708-P21`. The prior-art gate (G112) swept the 7,119-entry community registry on 2026-08-30: nothing implements declared dependencies with propagating file operations. Everything near it is one of three narrower things — a folder-convention container (`documents-bundle`), a filename-convention sidecar manager (`awesym/obsidian-sidecars`, `media-sidecar-tools`), or display-only nesting and hiding (`nested-notes`, `explorer-hider`). `depends` declares dependencies in frontmatter but has no filesystem behavior at all, which is why its declaration shape is worth copying and its scope is not.

**This generalizes what Custom Attachment Location does as a special case.** Every plugin near this idea hard-codes "a note and its attachment folder". OCAL answers exactly one question — what is the desired location for a note's attachments — and models no hierarchy and no dependency. The general concept is a different plugin, which is what this is.

## Current state

**Built, not yet released.** The declaration parser, the bundle index, the transactional operations and the display-only File Explorer hiding are all in place, wired together, and covered by unit tests at 100% plus four behavioral integration suites that pass against a real Obsidian 1.14.0 (move, rename, delete, unlock). `README.md` and the demo vault describe what the plugin actually does.

**Duplicate is the one operation of the four that is NOT built.** ODU's `VaultTransaction` has no `copy` and its `create()` takes a `string`, so a bundle holding an image or a PDF cannot be duplicated through it — and the alternatives are the hand-rolled rollback this plugin's invariants forbid, or a command silently correct for notes and lossy for attachments. Tracked as `T941-P48`, blocked on `T940-P1`. Neither the README nor the demo vault promises it, so nothing needs correcting when it lands — only adding.

The build is tracked as `T741-P48`.

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
- **`files` holds links, in either syntax.** Obsidian's own cache indexes both in frontmatter, wikilinks and markdown links alike, and emits them under dotted nested keys (`file-bundles.files.0`) — measured, see below, and no longer dependent on Frontmatter Markdown Links. What it does *not* preserve is the anchoring: its rename bookkeeping rewrites an entry into its own shortest-path style and strips the `./` / `/` prefix, which is why this plugin re-anchors the declaration rather than trusting the rewrite.
- **`folders` accepts an explicit path or a folder-note link.** Obsidian has no folder link, so a path is the form that always works and this plugin rewrites it off `vault.on('rename')` for a `TFolder`. A link to a folder's folder note survives renames for free and is how the owner's own vault is organized, so both are supported. A link means the folder because it is under `folders`; the same link under `files` would mean the note itself.
- **Every path is explicitly relative (`./…`) or explicitly rooted (`/…`).** A bare `assets/alpha` is rejected, not guessed at: a sidecar can live anywhere, so the base is genuinely ambiguous and Obsidian's shortest-path resolution would silently pick one.
- **`main` and the declaring note are implicit members** and are never listed.

## Architecture

Four layers. The bottom three carry all the correctness risk and are unit-testable with no DOM and no `App`.

- `src/bundle-declaration.ts` — parse and write the `file-bundles` key: both link forms, the mandatory `./` / `/` prefix, folder paths vs folder-note links, the implicit-`main` rule. Link handling goes through `obsidian-dev-utils/obsidian/link.ts` (`hasLeadingDot()` / `hasLeadingSlash()`), never a local regex. Folder notes resolve through ODU's `resolveFolderNoteConfig({ app })` / `resolveFolderNote` with `FolderNoteLocation.Auto`.
- `src/bundle-index.ts` — `mainPath` to members, and the reverse `memberPath` to the mains claiming it (a SET, because a shared dependent is the case the delete rule turns on). Pure: no `App`, no events.
- `src/bundle-index-component.ts` — keeps that index current off `metadataCache.on('changed')` and the vault's create/rename/delete events, and reports a bundle's own file moving or going **before** it updates itself.
- `src/bundle-operations.ts` — the planners (pure, so every propagation rule is testable without a vault) and the executors, over ODU's `VaultTransaction`.
- `src/bundle-operations-component.ts` — subscribes to those pre-mutation reports and performs the operation.
- `src/bundle-explorer-component.ts` — display-only hiding in the File Explorer.
- `src/file-bundles-component.ts` — the commands and the File Explorer menu items.

## Invariants that are easy to break

- **Never register a `RenameDeleteHandlerComponent`.** Advanced Rename and Delete Handler is the single owner of rename/delete in a vault, and its `src/conflicting-plugins.ts` makes it *refuse to load* beside a plugin that owns a handler — its own header explains why competing is unwinnable, since the `runAsyncLinkUpdate` patch sits outside the registry's election and is therefore load-order dependent. This plugin moves only the dependents a bundle declares and leaves links and attachments to that one. Needing to add `file-bundles` to its `CONFLICTING_PLUGINS` list would mean this invariant was already broken.
- **Every bundle operation goes through ODU's `VaultTransaction`.** It is a reversible, `await using`-friendly log of vault mutations with dot-prefixed soft-delete staging that Obsidian's watcher ignores — exactly "move, rename or delete N files as one unit, or none of them". Do not hand-roll rollback.
- **Explorer hiding is display only.** Advanced Exclude hides files by removing them from the vault index (adapter patches, an IndexedDB projection). That is correct for exclusion and wrong here: bundle dependents must stay indexed and resolvable as link targets, which is the whole difference between a locked bundle and an excluded path. Its `src/file-tree-component.ts` is the in-fleet reference for touching the file tree; its index-projection machinery is not.
- **A file two bundles declare is never deleted with one of them.** Advanced Rename and Delete Handler already solves the equivalent for attachments through `GetRescuePathParams.survivingNotePaths`; the same shape applies.
- **Resolving a folder note never creates one.** A folder with no folder note is simply not a valid `folders` link.
- **`../` is explicitly relative, exactly as `./` is.** The library's `hasLeadingDot()` answers only for `./`, and this plugin's own re-anchoring emits `../` whenever a main file has moved away from a dependent — so treating `../` as unprefixed made the plugin reject its own output, re-infer the anchoring as rooted, and quietly stop moving that dependent. Found by the integration suite, never by a unit test.
- **The index reports a change BEFORE making it, and that ordering is the design.** `vault.on('delete')` fires after the fact and a move is followed by Obsidian rewriting the declaration, so nothing downstream can reconstruct what went with a file once the index has caught up. Do not replace the pre-mutation handlers with ordinary event subscriptions "in the right order" — that makes correctness depend on registration order between two components.
- **Unlocking stops PROPAGATION, not bookkeeping.** An unlocked bundle still gets its declaration re-anchored, because Obsidian strips the prefixes either way and a declaration left in that state stops parsing. The unlocked list is keyed by main path and is kept pointing at the bundle as it moves, or a moved bundle silently locks itself again.

## Deviations from the standard plugin architecture

The workspace convention is that all plugins share the same architecture; intentional deviations are documented here.

- **None yet.**

## What the real app actually does (measured 2026-09-02 against Obsidian 1.14.0)

Measured over CDP with three throwaway `evalInObsidian` probes (G54), which were deleted afterwards. These findings replace the questions that used to stand here; do not re-open them without re-measuring.

- **Nested frontmatter links are indexed.** Obsidian emits `frontmatterLinks` entries with dotted keys — `file-bundles.files.0`, `.1`, `.2` — for a link nested two levels under the declaration key, in the wikilink form *and* the markdown form. **Markdown links in frontmatter are indexed natively as of 1.14.0**: Frontmatter Markdown Links is not required for the cache to see them, so the earlier note that the markdown form only works when that plugin is installed no longer holds.
- **The free rename bookkeeping is real, and hostile to this declaration format.** Obsidian rewrites the entry in its own shortest-path style and **strips the mandatory prefix**: renaming `A/assets/diagram.png` turned `[[./assets/diagram.png]]` into `[[diagram-renamed.png]]`, and `[./notes.pdf](./notes.pdf)` into `[notes-renamed.pdf](notes-renamed.pdf)`. Moving the *declaring* note from `A/` to `B/` does the same to every relative entry (`[[./assets/diagram.png]]` becomes `[[diagram.png]]`, still resolving to the file left behind in `A/assets/`), while leaving a rooted `[[/shared/logo.png]]` untouched — Obsidian rewrites a link only when the link text has to change.
  - **Consequence: this plugin owns a re-anchoring pass.** A declaration Obsidian has rewritten no longer carries the `./` or `/` the format requires, so left alone a bundle would silently dissolve after an ordinary drag in the File Explorer. Any member link that still resolves but has lost its prefix is rewritten back to the anchored form. Rejecting a bare path on input and healing one on rewrite are the same rule seen from two sides, not a softening of it.
- **`folders` entries are never touched, because they are paths and not links.** `./assets` survived both a rename of that folder and a move of the declaring note — after which it silently named a different, non-existent folder. Rewriting them off `vault.on('rename')` is this plugin's job, as designed.
- **Both prefixes resolve.** From `A/main.md`, `metadataCache.getFirstLinkpathDest` answered `A/assets/diagram.png` for `./assets/diagram.png` and `shared/logo.png` for `/shared/logo.png`. Member paths are still resolved by this plugin's own path math, which is deterministic and unit-testable with no `App`; the measurement only confirms that nothing else resolves them differently.
- **Delete is safe to react to post-hoc, and coexistence holds.** With Advanced Rename and Delete Handler installed and enabled beside it, both plugins load. `vault.on('delete')` fires with the main file already gone from the vault and every declared member still present, untouched by that plugin's own cleanup.
- **Consequence for both delete and move: the bundle index is the source of truth at operation time.** The declaration cannot be re-read after the fact — on delete the file is gone, and on move Obsidian has already rewritten it. Membership is captured from the index before mutating, never by parsing afterwards.

## Open questions the build has to answer

- **Relationship to Advanced Markdown Export.** Its `src/dependency-resolver.ts` walks *discovered* dependencies (links, embeds, canvas); this plugin acts on *declared* ones. Different sources of truth, so the graph layer does not share cleanly — worth a look, not a blocker.

## Naming and licensing decisions

- **Name: File Bundles**, id `file-bundles`, verified free against the registry on 2026-08-30. Deliberately outside the `sidecar` / `companion` namespace, which is crowded and confusable, and outside the fleet's `Advanced-*` family, which by convention means "improves an Obsidian built-in" — there is no built-in here.
- **No takeover of `obsidian-sidecars`.** The "if you're a plugin dev and would like to take over ownership" notice recorded in the original task was on `Alb-O/obsidian-sidecars`, which now 404s. The project lives at `awesym/obsidian-sidecars` under **GPL-3.0**, incompatible with this fleet's MIT licensing, with no such notice in its README. The hand-over angle is closed.

## Traps to clear before the first release

- The scaffold ships a real rule in `src/styles/main.scss` on purpose. A `styles.css` that builds to **0 bytes** makes `gh release create` fail with `HTTP 400: Bad Content-Length` *after* the tag has been pushed, rolling the whole release back. Keep at least one real rule in there.
- `scripts/version.ts` deliberately carries **no** template-release guard, and must stay that way. The sample-plugin-extended template disables its own release with a guard keyed to the presence of a root `.template` marker file, which the scaffold deletes. It used to be keyed to the template's plugin id instead, so the scaffold's global rename re-armed it against the new plugin and made every release throw — `alias-quick-switcher` and `advanced-markdown-export` both shipped with that defect before it was fixed in T742.
- **The README has no screenshot block, and the community listing reads the README.** No `images/screenshots/` and no capture suites exist here yet; G102 puts the gallery between the lead paragraph and `## Demo vault`. Tracked as `T959-P48`, wanted before the first release.
- **Do not sweep the demo-vault zip name onto the unversioned form yet.** This repo is on `obsidian-dev-utils` 96.5.2; the rename to `<plugin-id>-demo-vault.zip` arrives with ODU 98, so both READMEs correctly still name `file-bundles-demo-vault-<version>.zip` until that bump lands. Tracked fleet-wide as `T874-P21`.
