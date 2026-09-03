# Locking and unlocking

A bundle is **locked** by default. Locked is what makes it behave as one thing:

- its dependents are hidden in the File Explorer, so only the main file shows;
- moving, renaming or deleting the main file carries them along.

**Unlocking splits the pieces back into independent files.** The dependents come back into view, dimmed rather than hidden, and nothing propagates any more: move the main file while unlocked and the dependents stay exactly where they are.

## Try it

Open `Materials/01 Bundles/Trip note.md` and unlock it. Watch `Trip assets` appear in the File Explorer.

```code-button
---
caption: Lock or unlock the bundle of the active file
---
require('/demoSetup.ts').runCommand(app, 'toggle-lock');
```

Manual equivalent: **File Bundles: Lock or unlock the bundle the active file belongs to**, or right-click any file the bundle claims and choose **Unlock bundle** / **Lock bundle**.

Run it again to lock the bundle back up.

## Unlocking never edits your note

The declaration is not touched. It still says the files belong together — the plugin simply stops acting on it until you lock the bundle again. The state lives in the plugin's own `data.json`, under `unlockedBundleMainPaths`.

That has one consequence worth knowing. A relocked bundle carries whatever sits with it **now**: if you unlocked a bundle, moved its main file away, and locked it again, the dependents you left behind are no longer beside it, and a later move will not reach back for them. The declaration still names them, so they are still its dependents — they simply no longer travel, because they are no longer anchored anywhere near the main file.

## The declaration is still maintained while unlocked

Unlocking means *do not move my files*, not *let the declaration rot*. Obsidian strips the `./` and `/` prefixes off frontmatter links whenever anything moves, whether the bundle is locked or not, so the plugin writes the anchoring back either way. Without that, an unlocked bundle would stop parsing and would no longer be a bundle at all by the time you locked it again.
