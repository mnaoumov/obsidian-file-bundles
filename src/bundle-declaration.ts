import type {
  App,
  TFile,
  TFolder
} from 'obsidian';

import { normalizeOptionalProperties } from 'obsidian-dev-utils/object-utils';
import { getFolderOrNull } from 'obsidian-dev-utils/obsidian/file-system';
import {
  resolveFolderNote,
  resolveFolderNoteConfig
} from 'obsidian-dev-utils/obsidian/folder-note';
import {
  generateMarkdownLink,
  hasLeadingDot,
  hasLeadingSlash,
  LinkPathStyle,
  LinkStyle,
  splitSubpath
} from 'obsidian-dev-utils/obsidian/link';
import { parseLink } from 'obsidian-dev-utils/obsidian/parse-link';
import {
  dirname,
  join,
  normalizePath,
  relative
} from 'obsidian-dev-utils/path';

/**
 * Why an entry was rejected.
 */
export enum BundleDeclarationProblemReason {
  /**
   * The value under the declaration key was not a mapping.
   */
  DeclarationIsNotAnObject = 'DeclarationIsNotAnObject',

  /**
   * The entry was a URL rather than a path inside the vault.
   */
  EntryIsExternal = 'EntryIsExternal',

  /**
   * The entry was not a string — a number, a nested list, a mapping.
   */
  EntryIsNotAString = 'EntryIsNotAString',

  /**
   * The entry climbed past the vault root, so it names a path the vault does not contain — `/../shared`, or
   * a `../..` from a note one folder deep.
   */
  EntryIsOutsideTheVault = 'EntryIsOutsideTheVault',

  /**
   * The entry resolved to the vault root itself — written `/`, or `./` from a note at the top of the vault.
   * A bundle is a file plus what travels with it, so the whole vault is never one of its members, and an
   * entry that names it is rejected rather than carried into an operation that would act on every file.
   */
  EntryIsTheVaultRoot = 'EntryIsTheVaultRoot',

  /**
   * A `folders` entry was a link, but the note it names is not the folder note of any folder. Resolving one
   * never creates it, so a folder without a folder note simply cannot be named this way.
   */
  FolderIsNotNamedByItsFolderNote = 'FolderIsNotNamedByItsFolderNote',

  /**
   * The entry carried neither the `./` nor the `/` prefix the format requires.
   */
  MissingAnchorPrefix = 'MissingAnchorPrefix'
}

/**
 * Whether a declared path is anchored to the declaring file or to the vault root.
 */
export enum BundleMemberAnchoring {
  /**
   * Written as `./…`, so it names a path relative to the declaring file and moves with the main file.
   */
  Relative = 'Relative',

  /**
   * Written as `/…`, so it names a path from the vault root and stays where it is when the main file moves.
   */
  Rooted = 'Rooted'
}

/**
 * Whether a member names a file or a folder.
 */
export enum BundleMemberKind {
  /**
   * A single file, declared under `files`.
   */
  File = 'File',

  /**
   * A folder and everything under it, declared under `folders`.
   */
  Folder = 'Folder'
}

/**
 * A parsed `file-bundles` declaration: which file the bundle is built around, and what travels with it.
 *
 * The declaring note and {@link BundleDeclaration.mainPath} are implicit members and are deliberately NOT
 * in {@link BundleDeclaration.members} — that list holds exactly what the declaration spells out, so
 * writing it back never invents entries the user did not type.
 */
export interface BundleDeclaration {
  /**
   * The note carrying the declaration. The same as {@link BundleDeclaration.mainPath} unless the
   * declaration names a `main` of its own, which is how a binary main file gets a sidecar note.
   */
  readonly declaringPath: string;

  /**
   * The file the bundle is built around.
   */
  readonly mainPath: string;

  /**
   * The declared dependents, in declaration order.
   */
  readonly members: readonly BundleMember[];

  /**
   * The bundle's own answer to whether dependents follow the main file's name, overriding the
   * plugin-level setting. Absent when the declaration does not say.
   */
  readonly renameDependents?: boolean;
}

/**
 * Something the parser could not make sense of. Reported rather than thrown: one malformed entry must not
 * void the whole bundle, and the user needs to be told which entry it was.
 */
export interface BundleDeclarationProblem {
  /**
   * The offending entry, as written.
   */
  readonly entry: string;

  /**
   * Where it sits under the declaration key, in the same dotted form Obsidian uses for nested frontmatter
   * links — `files.1`, `folders.0`, `main`.
   */
  readonly key: string;

  /**
   * Why it was rejected.
   */
  readonly reason: BundleDeclarationProblemReason;
}

/**
 * A single declared dependent, resolved to a vault-relative path.
 */
export interface BundleMember {
  /**
   * Whether the entry is anchored to the declaring file or to the vault root. This is what decides whether
   * the member travels with the main file on a move.
   */
  readonly anchoring: BundleMemberAnchoring;

  /**
   * Whether the entry reached us without the mandatory `./` or `/` prefix, in which case
   * {@link BundleMember.anchoring} was inferred rather than read.
   *
   * This is not merely a diagnostic. Obsidian's own rename bookkeeping rewrites a frontmatter link into its
   * shortest-path style and strips the prefix, so an entry in this state is usually one Obsidian has just
   * rewritten — the thing the re-anchoring pass exists to heal. An entry a user typed this way has the same
   * shape, which is why the parser reports it as a problem AND still resolves it, leaving the policy to the
   * caller that knows whether this member was already known.
   */
  readonly isAnchorPrefixMissing: boolean;

  /**
   * Whether the entry was written as a wikilink rather than a markdown link.
   *
   * Recorded because the writer has to put back what the user wrote: a declaration this plugin re-anchors
   * would otherwise silently convert every entry to one syntax. Meaningless for a folder member written as
   * a path, which has no link syntax at all.
   */
  readonly isWikilink: boolean;

  /**
   * Whether the entry named a file or a folder. A folder member covers its whole subtree.
   */
  readonly kind: BundleMemberKind;

  /**
   * The vault-relative path the entry resolved to.
   */
  readonly path: string;
}

/**
 * Parameters for {@link formatBundleMemberEntry}.
 */
export interface FormatBundleMemberEntryParams {
  /**
   * The Obsidian application instance.
   */
  readonly app: App;

  /**
   * The note the entry will be written into.
   */
  readonly declaringPath: string;

  /**
   * The member to render, whose own recorded syntax and anchoring the entry preserves.
   */
  readonly member: BundleMember;
}

/**
 * Parameters for {@link parseBundleDeclaration}.
 */
export interface ParseBundleDeclarationParams {
  /**
   * The Obsidian application instance. Read from only — resolving a folder note never creates one.
   */
  readonly app: App;

  /**
   * The path of the note the frontmatter came from.
   */
  readonly declaringPath: string;

  /**
   * The note's frontmatter, as the metadata cache reports it.
   */
  readonly frontmatter: unknown;

  /**
   * The frontmatter key that marks a declaration.
   */
  readonly frontmatterKey: string;
}

/**
 * The result of parsing one note's frontmatter.
 */
export interface ParseBundleDeclarationResult {
  /**
   * The declaration, or `null` when the note does not declare a bundle at all.
   */
  readonly declaration: BundleDeclaration | null;

  /**
   * Everything the parser could not make sense of.
   */
  readonly problems: readonly BundleDeclarationProblem[];
}

const FILES_KEY = 'files';
const FOLDERS_KEY = 'folders';
const MAIN_KEY = 'main';
const PARENT_FOLDER_PATH = '..';
const PARENT_PREFIX = '../';
const RELATIVE_PREFIX = './';
const RENAME_DEPENDENTS_KEY = 'renameDependents';
const ROOTED_PREFIX = '/';
const TRAILING_SLASHES_REG_EXP = /\/+$/;
const VAULT_ROOT_FOLDER_PATH = '.';

interface CollectMembersParams {
  readonly app: App;
  readonly declaringPath: string;
  readonly members: BundleMember[];
  readonly problems: BundleDeclarationProblem[];
  readonly rawValue: unknown;
}

interface ResolvedEntry {
  readonly anchoring: BundleMemberAnchoring;
  readonly isAnchorPrefixMissing: boolean;
  readonly isWikilink: boolean;
  readonly path: string;
}

interface ResolveEntryParams {
  readonly app: App;
  readonly declaringPath: string;
  readonly entry: string;
  readonly key: string;
  readonly problems: BundleDeclarationProblem[];
}

interface ResolveMainPathParams {
  readonly app: App;
  readonly declaringPath: string;
  readonly problems: BundleDeclarationProblem[];
  readonly rawMain: unknown;
}

/**
 * Renders a member back into the entry text a declaration carries, preserving its anchoring.
 *
 * A file member becomes a link, because that is the form Obsidian's cache indexes and the form the user
 * writes. A folder member becomes a plain path: Obsidian has no folder link, so a path is the only form
 * that always works, and this plugin maintains it itself.
 *
 * @param params - The parameters.
 * @returns The entry text.
 */
export function formatBundleMemberEntry(params: FormatBundleMemberEntryParams): string {
  const {
    app,
    declaringPath,
    member
  } = params;

  if (member.kind === BundleMemberKind.Folder) {
    if (member.anchoring === BundleMemberAnchoring.Rooted) {
      return `${ROOTED_PREFIX}${member.path}`;
    }

    // A path that has to climb out of the declaring note's folder is already explicitly relative.
    const relativePath = relative(dirname(declaringPath), member.path);
    return relativePath.startsWith(PARENT_PREFIX) ? relativePath : `${RELATIVE_PREFIX}${relativePath}`;
  }

  return generateMarkdownLink({
    app,
    isEmbed: false,
    isNonExistingFileAllowed: true,
    linkPathStyle: member.anchoring === BundleMemberAnchoring.Relative
      ? LinkPathStyle.RelativePathToTheSource
      : LinkPathStyle.AbsolutePathInVault,
    linkStyle: member.isWikilink ? LinkStyle.Wikilink : LinkStyle.Markdown,
    shouldUseLeadingDotForRelativePaths: true,
    shouldUseLeadingSlashForAbsolutePaths: true,
    sourcePathOrFile: declaringPath,
    targetPathOrFile: member.path
  });
}

/**
 * Parses one note's frontmatter into a bundle declaration.
 *
 * Never throws on bad input: an entry it cannot make sense of becomes a
 * {@link BundleDeclarationProblem} and the rest of the declaration still parses.
 *
 * @param params - The parameters.
 * @returns The declaration and the problems found.
 */
export function parseBundleDeclaration(params: ParseBundleDeclarationParams): ParseBundleDeclarationResult {
  const {
    app,
    declaringPath,
    frontmatter,
    frontmatterKey
  } = params;

  const problems: BundleDeclarationProblem[] = [];

  if (!isRecord(frontmatter)) {
    return { declaration: null, problems };
  }

  const rawDeclaration = frontmatter[frontmatterKey];
  if (rawDeclaration === undefined || rawDeclaration === null) {
    return { declaration: null, problems };
  }

  if (!isRecord(rawDeclaration)) {
    problems.push({
      entry: describeEntry(rawDeclaration),
      key: '',
      reason: BundleDeclarationProblemReason.DeclarationIsNotAnObject
    });
    return { declaration: null, problems };
  }

  const mainPath = resolveMainPath({
    app,
    declaringPath,
    problems,
    rawMain: rawDeclaration[MAIN_KEY]
  });

  const members: BundleMember[] = [];
  collectFileMembers({
    app,
    declaringPath,
    members,
    problems,
    rawValue: rawDeclaration[FILES_KEY]
  });
  collectFolderMembers({
    app,
    declaringPath,
    members,
    problems,
    rawValue: rawDeclaration[FOLDERS_KEY]
  });

  const rawRenameDependents = rawDeclaration[RENAME_DEPENDENTS_KEY];

  return {
    declaration: {
      declaringPath,
      mainPath,
      members,
      ...normalizeOptionalProperties<Pick<BundleDeclaration, 'renameDependents'>>({
        renameDependents: typeof rawRenameDependents === 'boolean' ? rawRenameDependents : undefined
      })
    },
    problems
  };
}

function collectFileMembers(params: CollectMembersParams): void {
  const {
    app,
    declaringPath,
    members,
    problems,
    rawValue
  } = params;

  for (const [index, rawEntry] of toEntryList(rawValue).entries()) {
    const key = `${FILES_KEY}.${String(index)}`;
    if (typeof rawEntry !== 'string') {
      problems.push({
        entry: describeEntry(rawEntry),
        key,
        reason: BundleDeclarationProblemReason.EntryIsNotAString
      });
      continue;
    }

    const resolved = resolveLinkEntry({
      app,
      declaringPath,
      entry: rawEntry,
      key,
      problems
    });
    if (!resolved) {
      continue;
    }

    members.push({
      anchoring: resolved.anchoring,
      isAnchorPrefixMissing: resolved.isAnchorPrefixMissing,
      isWikilink: resolved.isWikilink,
      kind: BundleMemberKind.File,
      path: resolved.path
    });
  }
}

function collectFolderMembers(params: CollectMembersParams): void {
  const {
    app,
    declaringPath,
    members,
    problems,
    rawValue
  } = params;

  for (const [index, rawEntry] of toEntryList(rawValue).entries()) {
    const key = `${FOLDERS_KEY}.${String(index)}`;
    if (typeof rawEntry !== 'string') {
      problems.push({
        entry: describeEntry(rawEntry),
        key,
        reason: BundleDeclarationProblemReason.EntryIsNotAString
      });
      continue;
    }

    const resolveEntryParams: ResolveEntryParams = {
      app,
      declaringPath,
      entry: rawEntry,
      key,
      problems
    };
    const resolved = parseLink(rawEntry)
      ? resolveFolderNoteEntry(resolveEntryParams)
      : resolvePathEntry(resolveEntryParams);
    if (!resolved) {
      continue;
    }

    members.push({
      anchoring: resolved.anchoring,
      isAnchorPrefixMissing: resolved.isAnchorPrefixMissing,
      isWikilink: resolved.isWikilink,
      kind: BundleMemberKind.Folder,
      path: resolved.path
    });
  }
}

/**
 * Renders a rejected value for a problem report.
 *
 * `String()` is not usable here: the value is whatever the frontmatter held, so a mapping would stringify to
 * a useless `[object Object]` and tell the user nothing about which entry to go and fix.
 */
function describeEntry(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value) ?? '';
}

function inferAnchoring(declaringPath: string, path: string): BundleMemberAnchoring {
  const declaringFolderPath = dirname(declaringPath);
  return declaringFolderPath === VAULT_ROOT_FOLDER_PATH || path.startsWith(`${declaringFolderPath}/`)
    ? BundleMemberAnchoring.Relative
    : BundleMemberAnchoring.Rooted;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Canonicalizes a resolved entry path, and rejects the two forms that name nothing a bundle can hold.
 *
 * Both exist because `normalizePath()` leaves a folder path exactly as written: it keeps a trailing slash,
 * so `/Shared/brand/` stays `Shared/brand/` and names no folder the vault has; and it answers `.` for an
 * empty remainder and `..` for a climb past the top, so `/` reaches the rest of the plugin as the VAULT
 * ROOT and `../..` as a path outside the vault altogether. Neither is caught anywhere downstream — the
 * index would hold the root as an ordinary member and a deletion would hand it straight to the trash.
 *
 * So the canonical form is settled here, once, for every key: a trailing slash is not part of a path, an
 * empty path is the root, and the root and anything above it are reported like any other malformed entry.
 *
 * @param params - The parameters of the entry being resolved, for the problem report.
 * @param path - The resolved path, as the path math left it.
 * @returns The canonical path, or `null` when the entry was rejected.
 */
function normalizeResolvedPath(params: ResolveEntryParams, path: string): null | string {
  const {
    entry,
    key,
    problems
  } = params;

  const trimmedPath = path.replace(TRAILING_SLASHES_REG_EXP, '');
  const normalizedPath = trimmedPath === '' ? VAULT_ROOT_FOLDER_PATH : trimmedPath;

  if (normalizedPath === VAULT_ROOT_FOLDER_PATH) {
    problems.push({
      entry,
      key,
      reason: BundleDeclarationProblemReason.EntryIsTheVaultRoot
    });
    return null;
  }

  if (normalizedPath === PARENT_FOLDER_PATH || normalizedPath.startsWith(PARENT_PREFIX)) {
    problems.push({
      entry,
      key,
      reason: BundleDeclarationProblemReason.EntryIsOutsideTheVault
    });
    return null;
  }

  return normalizedPath;
}

function resolveFolderNoteEntry(params: ResolveEntryParams): null | ResolvedEntry {
  const {
    app,
    declaringPath,
    entry,
    key,
    problems
  } = params;

  const resolved = resolveLinkEntry(params);
  if (!resolved) {
    return null;
  }

  const noteFile = app.metadataCache.getFirstLinkpathDest(resolved.path, declaringPath);
  const folder = noteFile ? resolveFolderOfFolderNote(app, noteFile) : null;
  if (!folder) {
    problems.push({
      entry,
      key,
      reason: BundleDeclarationProblemReason.FolderIsNotNamedByItsFolderNote
    });
    return null;
  }

  return {
    anchoring: resolved.anchoring,
    isAnchorPrefixMissing: resolved.isAnchorPrefixMissing,
    isWikilink: resolved.isWikilink,
    path: folder.path
  };
}

/**
 * Resolves the FOLDER a `folders` link names, by asking which folder that note is the folder note of.
 *
 * Both folder-note layouts are covered without branching on the location: the note's own parent answers for
 * a note inside its folder, and the same-named sibling folder answers for a note beside it. Whichever
 * candidate the resolved configuration agrees with is the folder; when neither does, the note is nobody's
 * folder note and the entry is rejected.
 */
function resolveFolderOfFolderNote(app: App, noteFile: TFile): null | TFolder {
  const config = resolveFolderNoteConfig({ app });
  const candidates: (null | TFolder)[] = [
    noteFile.parent,
    getFolderOrNull({
      app,
      pathOrFolder: join(dirname(noteFile.path), noteFile.basename)
    })
  ];

  for (const folder of candidates) {
    if (folder && resolveFolderNote({ app, config, folder })?.path === noteFile.path) {
      return folder;
    }
  }

  return null;
}

/**
 * Resolves a link entry — `main`, any `files` entry, and the folder-note form of a `folders` entry.
 *
 * Obsidian's own resolution does the work, because the probes confirmed it honours both prefixes and it is
 * the only thing that can resolve an extension-less link or the shortest-path form Obsidian itself rewrites
 * a declaration into. Path math is the fallback, for a member that does not exist yet.
 */
function resolveLinkEntry(params: ResolveEntryParams): null | ResolvedEntry {
  const {
    app,
    declaringPath,
    entry,
    key,
    problems
  } = params;

  const parseLinkResult = parseLink(entry);
  if (parseLinkResult && (parseLinkResult.isExternal || parseLinkResult.isFileUrl)) {
    problems.push({
      entry,
      key,
      reason: BundleDeclarationProblemReason.EntryIsExternal
    });
    return null;
  }

  const target = parseLinkResult?.url ?? entry;
  const { linkPath } = splitSubpath(target);
  //  Is explicitly relative too, and the library's helper only answers for the  form.
  const isRelative = (parseLinkResult ? hasLeadingDot(entry) : linkPath.startsWith(RELATIVE_PREFIX))
    || linkPath.startsWith(PARENT_PREFIX);
  const isRooted = parseLinkResult ? hasLeadingSlash(entry) : linkPath.startsWith(ROOTED_PREFIX);

  // A bare path carries no syntax, so it is written back as a wikilink — the form Obsidian's cache indexes.
  const isWikilink = parseLinkResult?.isWikilink ?? true;
  const resolvedFile = app.metadataCache.getFirstLinkpathDest(linkPath, declaringPath);
  const path = normalizeResolvedPath(params, resolvedFile?.path ?? resolvePathAgainst(declaringPath, linkPath));

  // Asked BEFORE the prefix check, because naming the vault root is fatal and a missing prefix is not: an
  // entry that does both — a bare `..` — has to be rejected rather than resolved with a problem attached.
  if (path === null) {
    return null;
  }

  if (!isRelative && !isRooted) {
    problems.push({
      entry,
      key,
      reason: BundleDeclarationProblemReason.MissingAnchorPrefix
    });
    return {
      anchoring: inferAnchoring(declaringPath, path),
      isAnchorPrefixMissing: true,
      isWikilink,
      path
    };
  }

  return {
    anchoring: isRelative ? BundleMemberAnchoring.Relative : BundleMemberAnchoring.Rooted,
    isAnchorPrefixMissing: false,
    isWikilink,
    path
  };
}

function resolveMainPath(params: ResolveMainPathParams): string {
  const {
    app,
    declaringPath,
    problems,
    rawMain
  } = params;

  if (rawMain === undefined || rawMain === null) {
    return declaringPath;
  }

  if (typeof rawMain !== 'string') {
    problems.push({
      entry: describeEntry(rawMain),
      key: MAIN_KEY,
      reason: BundleDeclarationProblemReason.EntryIsNotAString
    });
    return declaringPath;
  }

  const resolved = resolveLinkEntry({
    app,
    declaringPath,
    entry: rawMain,
    key: MAIN_KEY,
    problems
  });
  return resolved?.path ?? declaringPath;
}

function resolvePathAgainst(declaringPath: string, linkPath: string): string {
  return normalizePath(linkPath.startsWith(ROOTED_PREFIX) ? linkPath.slice(ROOTED_PREFIX.length) : join(dirname(declaringPath), linkPath));
}

/**
 * Resolves a raw path entry — the form only `folders` accepts, since Obsidian has no folder link.
 *
 * The `./` and `/` check here is a plain string comparison rather than the library's `hasLeadingDot()` /
 * `hasLeadingSlash()`, because those parse their argument as a LINK and answer `false` for anything that is
 * not one. A bare path is exactly that, so asking them would reject every folder path.
 */
function resolvePathEntry(params: ResolveEntryParams): null | ResolvedEntry {
  const {
    declaringPath,
    entry,
    key,
    problems
  } = params;

  if (entry.startsWith(RELATIVE_PREFIX) || entry.startsWith(PARENT_PREFIX)) {
    const path = normalizeResolvedPath(params, resolvePathAgainst(declaringPath, entry));
    if (path === null) {
      return null;
    }

    return {
      anchoring: BundleMemberAnchoring.Relative,
      isAnchorPrefixMissing: false,
      isWikilink: false,
      path
    };
  }

  if (entry.startsWith(ROOTED_PREFIX)) {
    const path = normalizeResolvedPath(params, normalizePath(entry.slice(ROOTED_PREFIX.length)));
    if (path === null) {
      return null;
    }

    return {
      anchoring: BundleMemberAnchoring.Rooted,
      isAnchorPrefixMissing: false,
      isWikilink: false,
      path
    };
  }

  problems.push({
    entry,
    key,
    reason: BundleDeclarationProblemReason.MissingAnchorPrefix
  });
  return null;
}

function toEntryList(rawValue: unknown): unknown[] {
  if (rawValue === undefined || rawValue === null) {
    return [];
  }

  return Array.isArray(rawValue) ? rawValue : [rawValue];
}
