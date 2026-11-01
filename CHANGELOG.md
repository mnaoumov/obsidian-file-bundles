# CHANGELOG

## 3.1.0

- docs(readme): point bug reports at the Report a bug command
- feat: add a Report a bug command
- docs: add issue-filing instructions for AI agents
- chore(github): give the bug form the field ids bug-report links prefill
- build(deps): bump typescript-dev-toolkit to ^5.4.2 and obsidian-dev-toolkit to ^7.4.0
- build(deps): override re2js to ^2.9.1 for GHSA-gg6h-894w-4m9c
- build(deps): bump typescript-dev-toolkit to ^5.2.0 and apply prefer-dedent
- build(deps): bump @mnaoumov/typescript-dev-toolkit to ^5.1.0
- chore(deps): refresh vulnerable development dependencies
- chore: adopt shared keyword identifier rule
- refactor: adopt readonly interface members
- docs(readme): combine related resources and plugin comparisons
- refactor: group bundle feature in its own folder
- docs(readme): cut the README to a landing page, reference lives in the demo vault
- docs(readme): add a Similar plugins section from a prior-art search
- test: give the first rewriteBundleDeclaration case room for its cold start
- docs(agents): record the 3.0.0 release and why it is a major

## 3.0.0

- build(deps)!: move to obsidian-lib 6 and obsidian-dev-toolkit 5
- docs: shorten the debugging section
- chore: replace leftover obsidian-dev-utils references with @mnaoumov/obsidian-lib
- docs(readme): lead the Debugging section with `Advanced Debug Mode`
- docs(agents): record the 2.0.0 release and why it is a major

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
