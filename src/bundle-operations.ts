import type { App } from 'obsidian';

import {
  parseFrontmatter,
  setFrontmatter
} from 'obsidian-dev-utils/obsidian/frontmatter';
import { VaultTransaction } from 'obsidian-dev-utils/obsidian/vault-transaction';
import {
  basename,
  dirname,
  extname,
  join
} from 'obsidian-dev-utils/path';

import type {
  BundleDeclaration,
  BundleMember
} from './bundle-declaration.ts';

import {
  BundleMemberAnchoring,
  BundleMemberKind,
  formatBundleMemberEntry
} from './bundle-declaration.ts';

/**
 * Parameters for {@link applyBundleMoves}.
 */
export interface ApplyBundleMovesParams {
  /**
   * The Obsidian application instance.
   */
  readonly app: App;

  /**
   * The moves to perform, in order.
   */
  readonly moves: readonly BundleMemberMove[];
}

/**
 * One rename an operation will perform. A move and a rename are the same vault operation, so they are the
 * same plan entry.
 */
export interface BundleMemberMove {
  /**
   * Where the resource ends up.
   */
  readonly newPath: string;

  /**
   * Where the resource is now.
   */
  readonly oldPath: string;
}

/**
 * Parameters for {@link planBundleDeletion}.
 */
export interface PlanBundleDeletionParams {
  /**
   * The bundle being deleted.
   */
  readonly declaration: BundleDeclaration;

  /**
   * Every OTHER bundle in the vault. A dependent one of them also declares outlives this deletion.
   */
  readonly otherDeclarations: readonly BundleDeclaration[];
}

/**
 * Parameters for {@link planBundleMove} and {@link planBundleRename}.
 */
export interface PlanBundleMoveParams {
  /**
   * The bundle whose main file moved.
   */
  readonly declaration: BundleDeclaration;

  /**
   * The path the moved file now has.
   */
  readonly newPath: string;

  /**
   * The path the moved file had.
   */
  readonly oldPath: string;
}

/**
 * Parameters for {@link planBundleRename}.
 */
export interface PlanBundleRenameParams extends PlanBundleMoveParams {
  /**
   * Whether dependents follow the main file's new name. The bundle's own `renameDependents` where it says,
   * the plugin setting otherwise — resolved by the caller, because only it can see both.
   */
  readonly shouldRenameDependents: boolean;
}

/**
 * Parameters for {@link rewriteBundleDeclaration}.
 */
export interface RewriteBundleDeclarationParams {
  /**
   * The Obsidian application instance.
   */
  readonly app: App;

  /**
   * The declaration to write, with the paths it should now name.
   */
  readonly declaration: BundleDeclaration;

  /**
   * The frontmatter key that marks a declaration.
   */
  readonly frontmatterKey: string;
}

/**
 * Parameters for {@link trashBundlePaths}.
 */
export interface TrashBundlePathsParams {
  /**
   * The Obsidian application instance.
   */
  readonly app: App;

  /**
   * The paths to trash.
   */
  readonly paths: readonly string[];
}

/**
 * Performs a planned set of moves as ONE unit.
 *
 * Every rename goes through the library's {@link VaultTransaction}, so a failure part-way rolls the earlier
 * ones back rather than leaving a bundle half-moved. The transaction renames through
 * `fileManager.renameFile`, which means Obsidian — or Advanced Rename and Delete Handler where it is
 * installed — does the link bookkeeping, exactly as this plugin's invariants require.
 *
 * @param params - The parameters.
 * @returns A {@link Promise} that resolves when every move has been made.
 */
export async function applyBundleMoves(params: ApplyBundleMovesParams): Promise<void> {
  const { app, moves } = params;

  if (moves.length === 0) {
    return;
  }

  await using transaction = new VaultTransaction({ app });
  for (const move of moves) {
    await transaction.rename(move.oldPath, move.newPath);
  }
  await transaction.commit();
}

/**
 * Answers which paths a bundle's deletion should take with it.
 *
 * A dependent another bundle also declares is never among them — that is the invariant this function
 * exists to hold. A declared FOLDER is spared for the same reason when another bundle claims anything
 * inside it, since trashing the folder would take that file too.
 *
 * The main file itself is not listed: it is the file the deletion started from, and is already gone by the
 * time this is asked.
 *
 * @param params - The parameters.
 * @returns The paths to trash, in declaration order.
 */
export function planBundleDeletion(params: PlanBundleDeletionParams): string[] {
  const { declaration, otherDeclarations } = params;

  const claimedPaths = otherDeclarations.flatMap((other) => [
    other.mainPath,
    other.declaringPath,
    ...other.members.map((member) => member.path)
  ]);

  const paths: string[] = [];

  if (declaration.declaringPath !== declaration.mainPath && !claimedPaths.includes(declaration.declaringPath)) {
    paths.push(declaration.declaringPath);
  }

  for (const member of declaration.members) {
    const isClaimedElsewhere = member.kind === BundleMemberKind.Folder
      ? claimedPaths.some((claimedPath) => claimedPath === member.path || isUnder(member.path, claimedPath))
      : claimedPaths.includes(member.path);
    if (!isClaimedElsewhere) {
      paths.push(member.path);
    }
  }

  return paths;
}

/**
 * Answers which resources follow a bundle's main file into its new folder.
 *
 * A `./…` member is anchored to the main file and travels with it; a `/…` member states a home of its own
 * and stays where it is. That is the whole operational difference between the two prefixes.
 *
 * A member inside a folder member that is itself moving is left out: the folder's own move carries it, and
 * moving it separately would move it twice.
 *
 * @param params - The parameters.
 * @returns The moves to perform, outermost first.
 */
export function planBundleMove(params: PlanBundleMoveParams): BundleMemberMove[] {
  const {
    declaration,
    newPath,
    oldPath
  } = params;

  const oldFolderPath = dirname(oldPath);
  const newFolderPath = dirname(newPath);
  if (oldFolderPath === newFolderPath) {
    return [];
  }

  const moves: BundleMemberMove[] = [];

  const otherOwnPath = getOtherOwnPath(declaration, oldPath);
  if (otherOwnPath !== null && isUnder(oldFolderPath, otherOwnPath)) {
    moves.push({
      newPath: rebase(otherOwnPath, oldFolderPath, newFolderPath),
      oldPath: otherOwnPath
    });
  }

  const movingFolderPaths: string[] = [];
  for (const member of [...declaration.members].sort(byPathDepth)) {
    if (member.anchoring !== BundleMemberAnchoring.Relative || !isUnder(oldFolderPath, member.path)) {
      continue;
    }

    if (movingFolderPaths.some((folderPath) => isUnder(folderPath, member.path))) {
      continue;
    }

    moves.push({
      newPath: rebase(member.path, oldFolderPath, newFolderPath),
      oldPath: member.path
    });

    if (member.kind === BundleMemberKind.Folder) {
      movingFolderPaths.push(member.path);
    }
  }

  return moves;
}

/**
 * Answers which resources follow a bundle's main file to its new NAME.
 *
 * Dependents keep their own names by default, because a dependent is not necessarily named after its main
 * and renaming one would rename it out from under everything else that links to it. When the bundle or the
 * plugin says otherwise, the ones actually named after the main follow it.
 *
 * The declaring note is the exception, and follows regardless: a sidecar named after its main is what makes
 * the pair legible in the first place, so leaving `report.html.md` beside a renamed `invoice.html` would
 * break the very convention that put it there.
 *
 * @param params - The parameters.
 * @returns The moves to perform.
 */
export function planBundleRename(params: PlanBundleRenameParams): BundleMemberMove[] {
  const {
    declaration,
    newPath,
    oldPath,
    shouldRenameDependents
  } = params;

  const oldName = basename(oldPath);
  const newName = basename(newPath);
  if (oldName === newName) {
    return [];
  }

  const moves: BundleMemberMove[] = [];

  const otherOwnPath = getOtherOwnPath(declaration, oldPath);
  if (otherOwnPath !== null && basename(otherOwnPath).startsWith(oldName)) {
    const suffix = basename(otherOwnPath).slice(oldName.length);
    moves.push({
      newPath: join(dirname(otherOwnPath), `${newName}${suffix}`),
      oldPath: otherOwnPath
    });
  }

  if (!shouldRenameDependents) {
    return moves;
  }

  const oldBasename = toBasenameWithoutExtension(oldPath);
  const newBasename = toBasenameWithoutExtension(newPath);

  for (const member of declaration.members) {
    if (toBasenameWithoutExtension(member.path) !== oldBasename) {
      continue;
    }

    const extension = member.kind === BundleMemberKind.Folder ? '' : extname(member.path);
    moves.push({
      newPath: join(dirname(member.path), `${newBasename}${extension}`),
      oldPath: member.path
    });
  }

  return moves;
}

/**
 * Writes a declaration back into its note, restoring each entry's anchoring and syntax.
 *
 * This is what heals a declaration Obsidian has rewritten. Its rename bookkeeping puts every frontmatter
 * link into its own shortest-path style and strips the `./` or `/` the format requires — measured against
 * Obsidian 1.14.0 — so without this pass an ordinary drag in the File Explorer would leave a declaration
 * this plugin no longer accepts, and the bundle would quietly dissolve.
 *
 * @param params - The parameters.
 * @returns A {@link Promise} that resolves when the note has been written.
 */
export async function rewriteBundleDeclaration(params: RewriteBundleDeclarationParams): Promise<void> {
  const {
    app,
    declaration,
    frontmatterKey
  } = params;

  const value: Record<string, unknown> = {};

  if (declaration.mainPath !== declaration.declaringPath) {
    value['main'] = formatBundleMemberEntry({
      app,
      declaringPath: declaration.declaringPath,
      member: toMainMember(declaration)
    });
  }

  const fileEntries = toEntries(app, declaration, BundleMemberKind.File);
  if (fileEntries.length > 0) {
    value['files'] = fileEntries;
  }

  const folderEntries = toEntries(app, declaration, BundleMemberKind.Folder);
  if (folderEntries.length > 0) {
    value['folders'] = folderEntries;
  }

  if (declaration.renameDependents !== undefined) {
    value['renameDependents'] = declaration.renameDependents;
  }

  await using transaction = new VaultTransaction({ app });
  await transaction.process(declaration.declaringPath, (content) => {
    const frontmatter: Record<string, unknown> = parseFrontmatter(content);
    frontmatter[frontmatterKey] = value;
    return setFrontmatter(content, frontmatter);
  });
  await transaction.commit();
}

/**
 * Trashes a planned set of paths as ONE unit.
 *
 * The transaction soft-deletes into a dot-prefixed staging folder Obsidian's watcher ignores, so a failure
 * part-way puts everything back rather than leaving a bundle half-deleted.
 *
 * @param params - The parameters.
 * @returns A {@link Promise} that resolves when everything has been trashed.
 */
export async function trashBundlePaths(params: TrashBundlePathsParams): Promise<void> {
  const { app, paths } = params;

  if (paths.length === 0) {
    return;
  }

  await using transaction = new VaultTransaction({ app });
  for (const path of paths) {
    await transaction.trash(path);
  }
  await transaction.commit();
}

function byPathDepth(left: BundleMember, right: BundleMember): number {
  return left.path.length - right.path.length;
}

/**
 * Answers the bundle's own path that is NOT the one that just moved — the sidecar when the main moved, and
 * the main when the sidecar did. `null` for a bundle declared inline, where the two are the same file.
 */
function getOtherOwnPath(declaration: BundleDeclaration, movedPath: string): null | string {
  if (declaration.mainPath === declaration.declaringPath) {
    return null;
  }

  if (movedPath === declaration.mainPath) {
    return declaration.declaringPath;
  }

  return movedPath === declaration.declaringPath ? declaration.mainPath : null;
}

function isUnder(folderPath: string, path: string): boolean {
  return path.startsWith(`${folderPath}/`);
}

function rebase(path: string, oldFolderPath: string, newFolderPath: string): string {
  return join(newFolderPath, path.slice(`${oldFolderPath}/`.length));
}

function toBasenameWithoutExtension(path: string): string {
  const name = basename(path);
  const extension = extname(name);
  return extension === '' ? name : name.slice(0, -extension.length);
}

function toEntries(app: App, declaration: BundleDeclaration, kind: BundleMemberKind): string[] {
  return declaration.members
    .filter((member) => member.kind === kind)
    .map((member) =>
      formatBundleMemberEntry({
        app,
        declaringPath: declaration.declaringPath,
        member
      })
    );
}

function toMainMember(declaration: BundleDeclaration): BundleMember {
  const isUnderDeclaringFolder = isUnder(dirname(declaration.declaringPath), declaration.mainPath)
    || dirname(declaration.mainPath) === dirname(declaration.declaringPath);

  return {
    anchoring: isUnderDeclaringFolder ? BundleMemberAnchoring.Relative : BundleMemberAnchoring.Rooted,
    isAnchorPrefixMissing: false,
    isWikilink: true,
    kind: BundleMemberKind.File,
    path: declaration.mainPath
  };
}
