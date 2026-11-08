# CHANGELOG

## 3.1.0

This release has 1 new feature and 6 documentation changes. 10 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

### New

- add a Report a bug command

### Documentation

- **readme:** point bug reports at the Report a bug command
- add issue-filing instructions for AI agents
- **readme:** combine related resources and plugin comparisons
- **readme:** cut the README to a landing page, reference lives in the demo vault
- **readme:** add a Similar plugins section from a prior-art search
- **agents:** record the 3.0.0 release and why it is a major

## 3.0.0

This release has 1 breaking change and 3 documentation changes. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

### Breaking changes

- **deps:** move to `obsidian-lib` 6 and `obsidian-dev-toolkit` 5

### Documentation

- shorten the debugging section
- **readme:** lead the Debugging section with `Advanced Debug Mode`
- **agents:** record the 2.0.0 release and why it is a major

## 2.0.0

Migration: excluded-path entries now match case-insensitively in every form. An unescaped `*`, `?` or `[` makes an entry a glob (`*.pdf`, `Archive/**/*.png`, `tmp*/`), so a plain path that contains one of those characters literally must escape it (`Notes \[old\]`). An entry shaped `/pattern/flags` is a regular expression whose flags are honored, and a folder-only glob (ending in `/`) excludes a declared folder as well as its contents.

- **BREAKING: excluded paths take globs and match case-insensitively.** The excluded-paths setting now accepts globs and regular expressions with flags, and every entry matches regardless of case.
- Notices no longer repeat the plugin name inside their text.
- The README names the community directory as the way to install the plugin.

## 1.0.0

First release.

- **Declare a bundle.** A note can declare the files that belong with it, and the bundle then moves, renames and deletes as one: rename the main file and its sidecars follow, and delete it and they go too.
- **Bundle-aware duplicate.** A new command duplicates a file together with its whole bundle.
- A sidecar note is recognized as part of the bundle it declares.
- A bundle whose main file sits at the vault root propagates like any other.
- A declaration entry that names the vault root, or climbs above it, is rejected.
- Documentation is a demo vault, shipped with the release and in `demo-vault/` in the repository.
