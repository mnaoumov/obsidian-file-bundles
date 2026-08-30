import process from 'node:process';
import { registerDemoVaultCoverageSuite } from 'obsidian-dev-utils/script-utils/demo-vault-coverage';
import { getRootFolder } from 'obsidian-dev-utils/script-utils/root';

// Keeps the in-repo `demo-vault/` in sync with the plugin's public surface WITHOUT
// Launching Obsidian: it reflects the real config from source and asserts every
// Setting is documented in a note, and that the guard note/member still exist
// (rename drift).
//
// The `Materials/` files are the fixture the plugin is demonstrated ON, not lessons about it, so they sit
// Outside the authoring checks - they deliberately carry a bundle declaration and no explanatory prose,
// Because that is exactly the shape the plugin has to read.
registerDemoVaultCoverageSuite({
  authoring: {
    excludedNotes: [
      'README.md',
      'Materials/01 Bundles/Trip note.md',
      'Materials/01 Bundles/Report/report.html.md'
    ]
  },
  configInterfaces: [{ interfaceName: 'PluginSettings', sourcePath: 'src/plugin-settings.ts' }],
  interfaces: [],
  nonTrivialGuard: {
    expectDemoNote: '03 Settings.md',
    expectMember: 'shouldHideDependentsInFileExplorer',
    interfaceName: 'PluginSettings',
    sourcePath: 'src/plugin-settings.ts'
  },
  rootFolder: getRootFolder() ?? process.cwd()
});
