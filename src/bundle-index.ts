import { dirname } from 'obsidian-dev-utils/path';

import type {
  BundleDeclaration,
  BundleMember
} from './bundle-declaration.ts';

import { BundleMemberKind } from './bundle-declaration.ts';

/**
 * Parameters for the {@link BundleIndex} constructor.
 */
export interface BundleIndexConstructorOptions {
  /**
   * Answers whether a path is excluded from bundling altogether, whether it declares a bundle or is
   * declared by one. Read live, so a settings change takes effect on the next rebuild.
   *
   * @param path - The vault-relative path to test.
   * @returns Whether the path is excluded.
   */
  shouldExcludePath?(this: void, path: string): boolean;
}

/**
 * Every path one bundle covers, in the order an operation should act on them.
 */
export interface BundlePaths {
  /**
   * The declared dependents — the files and folders that travel with the main file.
   */
  readonly memberPaths: readonly string[];

  /**
   * The main file, and the note that declares the bundle when that is a different file.
   */
  readonly ownPaths: readonly string[];
}

const VAULT_ROOT_FOLDER_PATH = '.';

/**
 * The in-memory answer to "what travels with this file", and its reverse, "who claims this file".
 *
 * Pure on purpose — no `App`, no events, no I/O — so every propagation rule can be unit-tested without a
 * vault. {@link BundleIndexComponent} is what keeps it current.
 *
 * A declaration is keyed by the note that DECLARES it, not by the main file it names: the declaring note is
 * the thing that exists, is edited, and is deleted, and two notes naming the same main is a user error the
 * index reports rather than one it silently collapses.
 */
export class BundleIndex {
  private readonly declarationsByDeclaringPath = new Map<string, BundleDeclaration>();
  private readonly declaringPathsByFolderMemberPath = new Map<string, Set<string>>();
  private readonly declaringPathsByMainPath = new Map<string, Set<string>>();
  private readonly declaringPathsByMemberPath = new Map<string, Set<string>>();
  private readonly shouldExcludePath: (this: void, path: string) => boolean;

  /**
   * Creates an index.
   *
   * @param params - The parameters.
   */
  public constructor(params: BundleIndexConstructorOptions = {}) {
    this.shouldExcludePath = params.shouldExcludePath ?? ((): boolean => false);
  }

  /**
   * Forgets every declaration, for a full rebuild.
   */
  public clear(): void {
    this.declarationsByDeclaringPath.clear();
    this.declaringPathsByMainPath.clear();
    this.declaringPathsByFolderMemberPath.clear();
    this.declaringPathsByMemberPath.clear();
  }

  /**
   * Answers the declaration a note carries.
   *
   * @param declaringPath - The note's path.
   * @returns The declaration, or `null` when that note declares nothing.
   */
  public getDeclaration(declaringPath: string): BundleDeclaration | null {
    return this.declarationsByDeclaringPath.get(declaringPath) ?? null;
  }

  /**
   * Answers every declaration currently indexed.
   *
   * @returns The declarations.
   */
  public getDeclarations(): BundleDeclaration[] {
    return [...this.declarationsByDeclaringPath.values()];
  }

  /**
   * Answers the bundles a path is the MAIN file of — the ones an operation on that path propagates to.
   *
   * A path is also the main file of the bundle a note declares inline, since `main` defaults to the
   * declaring note.
   *
   * @param mainPath - The path to look up.
   * @returns The declarations, empty when the path is nobody's main file.
   */
  public getDeclarationsOfMain(mainPath: string): BundleDeclaration[] {
    return this.toDeclarations(this.declaringPathsByMainPath.get(mainPath));
  }

  /**
   * Answers the bundles that declare a path as a dependent, directly or by covering a folder above it.
   *
   * This is the reverse lookup the delete rule turns on: a member two bundles declare must survive the
   * deletion of either.
   *
   * @param memberPath - The path to look up.
   * @returns The declarations, empty when nothing claims the path.
   */
  public getDeclarationsOfMember(memberPath: string): BundleDeclaration[] {
    const declaringPaths = new Set<string>(this.declaringPathsByMemberPath.get(memberPath));

    for (const ancestorPath of toAncestorPaths(memberPath)) {
      for (const declaringPath of this.declaringPathsByFolderMemberPath.get(ancestorPath) ?? []) {
        declaringPaths.add(declaringPath);
      }
    }

    return this.toDeclarations(declaringPaths);
  }

  /**
   * Answers every path one bundle covers.
   *
   * @param declaration - The declaration.
   * @returns The bundle's own paths and its declared members.
   */
  public getPaths(declaration: BundleDeclaration): BundlePaths {
    const ownPaths = declaration.mainPath === declaration.declaringPath
      ? [declaration.mainPath]
      : [declaration.mainPath, declaration.declaringPath];

    return {
      memberPaths: declaration.members.map((member) => member.path),
      ownPaths
    };
  }

  /**
   * Answers whether a path is a bundle DEPENDENT — declared by some bundle, and not itself the main file or
   * declaring note of any.
   *
   * This is the question the File Explorer asks: a dependent is what gets hidden, and a main file is what
   * stays visible with the bundle marker on it.
   *
   * @param path - The path to test.
   * @returns Whether the path is a dependent.
   */
  public isDependent(path: string): boolean {
    if (this.declarationsByDeclaringPath.has(path) || this.declaringPathsByMainPath.has(path)) {
      return false;
    }

    return this.getDeclarationsOfMember(path).length > 0;
  }

  /**
   * Drops the declaration a note carried, if any.
   *
   * @param declaringPath - The note's path.
   */
  public removeDeclaration(declaringPath: string): void {
    const existing = this.declarationsByDeclaringPath.get(declaringPath);
    if (!existing) {
      return;
    }

    this.declarationsByDeclaringPath.delete(declaringPath);
    removeFromSetMap(this.declaringPathsByMainPath, existing.mainPath, declaringPath);

    for (const member of existing.members) {
      removeFromSetMap(this.declaringPathsByMemberPath, member.path, declaringPath);
      if (member.kind === BundleMemberKind.Folder) {
        removeFromSetMap(this.declaringPathsByFolderMemberPath, member.path, declaringPath);
      }
    }
  }

  /**
   * Records a declaration, replacing whatever that note declared before.
   *
   * An excluded declaring note declares nothing, and an excluded member is dropped from the bundle rather
   * than dropping the bundle.
   *
   * @param declaration - The declaration to record.
   */
  public setDeclaration(declaration: BundleDeclaration): void {
    this.removeDeclaration(declaration.declaringPath);

    if (this.shouldExcludePath(declaration.declaringPath) || this.shouldExcludePath(declaration.mainPath)) {
      return;
    }

    const members = declaration.members.filter((member: BundleMember) => !this.shouldExcludePath(member.path));
    const indexedDeclaration: BundleDeclaration = { ...declaration, members };

    this.declarationsByDeclaringPath.set(declaration.declaringPath, indexedDeclaration);
    addToSetMap(this.declaringPathsByMainPath, declaration.mainPath, declaration.declaringPath);

    for (const member of members) {
      addToSetMap(this.declaringPathsByMemberPath, member.path, declaration.declaringPath);
      if (member.kind === BundleMemberKind.Folder) {
        addToSetMap(this.declaringPathsByFolderMemberPath, member.path, declaration.declaringPath);
      }
    }
  }

  private toDeclarations(declaringPaths: Set<string> | undefined): BundleDeclaration[] {
    return [...declaringPaths ?? []]
      .map((declaringPath) => this.declarationsByDeclaringPath.get(declaringPath))
      .filter((declaration) => declaration !== undefined);
  }
}

function addToSetMap(map: Map<string, Set<string>>, key: string, value: string): void {
  const existing = map.get(key);
  if (existing) {
    existing.add(value);
    return;
  }

  map.set(key, new Set([value]));
}

function removeFromSetMap(map: Map<string, Set<string>>, key: string, value: string): void {
  const existing = map.get(key);
  if (!existing) {
    return;
  }

  existing.delete(value);
  if (existing.size === 0) {
    map.delete(key);
  }
}

function toAncestorPaths(path: string): string[] {
  const ancestorPaths: string[] = [];
  let currentPath = dirname(path);

  while (currentPath !== VAULT_ROOT_FOLDER_PATH && currentPath !== '') {
    ancestorPaths.push(currentPath);
    currentPath = dirname(currentPath);
  }

  return ancestorPaths;
}
