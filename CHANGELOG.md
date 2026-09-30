# CHANGELOG

## 1.0.0

First release.

- **Declare a bundle.** A note can declare the files that belong with it, and the bundle then moves, renames and deletes as one: rename the main file and its sidecars follow, and delete it and they go too.
- **Bundle-aware duplicate.** A new command duplicates a file together with its whole bundle.
- A sidecar note is recognized as part of the bundle it declares.
- A bundle whose main file sits at the vault root propagates like any other.
- A declaration entry that names the vault root, or climbs above it, is rejected.
- Documentation is a demo vault, shipped with the release and in `demo-vault/` in the repository.
