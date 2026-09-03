// Finding each gate's binary.
//
// Three rules, each of which came out of the products rather than out of a
// preference:
//
//  1. The CURRENT name wins over an older one wherever each is installed.
//     The obvious loop is location-major (search all of PATH, then all of
//     node_modules) but that pins a repository to whatever name happens to
//     be global: a machine with a leftover pre-rename install on PATH would
//     beat the repository's own current-name dev dependency, silently and
//     for as long as the old package stayed installed. So the outer loop is
//     the candidate list and the inner loop is PATH then node_modules.
//
//  2. Only a unified binary is asked for its version. `intent-guard`
//     answers --version; the per-command binaries shipped before 1.2.0 did
//     not parse the flag at all and RAN THE GATE against the current
//     directory instead. A version probe that runs a gate is not a probe.
//     The fix for that is merged upstream but unpublished, and an installed
//     copy is whatever the user has, so probing stays on the unified binary:
//     when the resolved binary is a per-command one, the unified binary of
//     the same product is resolved separately and asked instead, and when
//     that is not installed either the version is reported unknown rather
//     than guessed. This can be relaxed once the floor is a release that
//     has the fix, and not before.
//
//  3. There is no npx fallback. The draft proposed `npx --no-install` as a
//     last resort, and it is dropped here on purpose: it makes what ran
//     depend on a package cache the report cannot describe, and a gate that
//     "ran" from an unknown version is worse than one that is honestly
//     reported missing.

import { accessSync, constants, statSync } from 'node:fs';
import path from 'node:path';

import type { GatePolicy, Product } from './policy.js';

export type ResolutionSource = 'policy' | 'path' | 'node_modules';

export interface Candidate {
  /** Executable name. */
  name: string;
  /** Arguments this binary needs before the umbrella's own. */
  prefix: string[];
  /**
   * Whether `<name> --version` can be relied on to print a version instead
   * of doing work. False for the per-command binaries: those shipped before
   * 1.2.0 ignore the flag and run the gate, and an installed copy is
   * whatever the user has rather than whatever is on a branch.
   */
  versionSafe: boolean;
}

export interface VersionProbe {
  command: string;
  argv: string[];
}

export interface ResolvedBinary {
  /** What to spawn. */
  command: string;
  /** Arguments placed before the ones the umbrella adds. */
  argvPrefix: string[];
  source: ResolutionSource;
  /** The candidate name this matched, for the report's gate header. */
  candidate: string;
  /** A safe way to ask this product its version, or null when there is none. */
  versionProbe: VersionProbe | null;
}

export const CANDIDATES: Record<Product, Candidate[]> = {
  'dep-guard': [{ name: 'dep-guard', prefix: ['scan'], versionSafe: true }],
  'vault-guard': [{ name: 'vault-guard', prefix: ['scan'], versionSafe: true }],
  // intent-guard-check is a per-command binary intent-guard shipped before
  // 1.2.0, marked unsafe to ask for a version, per rule 2 above. The
  // pre-rename conductor and conductor-check names are not resolved here:
  // those packages are deprecated and had no users, so a pre-rename install
  // is not a supported target, and the umbrella's own binary now carries
  // the name conductor.
  'intent-guard': [
    { name: 'intent-guard', prefix: ['check'], versionSafe: true },
    { name: 'intent-guard-check', prefix: [], versionSafe: false },
  ],
};

export class ResolveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResolveError';
  }
}

function isExecutableFile(candidate: string): boolean {
  try {
    if (!statSync(candidate).isFile()) {
      return false;
    }
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function existsAsFile(candidate: string): boolean {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function findOnPath(name: string, pathValue: string): string | null {
  for (const dir of pathValue.split(path.delimiter)) {
    if (dir.length === 0) {
      continue;
    }
    const full = path.join(dir, name);
    if (isExecutableFile(full)) {
      return full;
    }
  }
  return null;
}

function findInNodeModules(name: string, repoRoot: string): string | null {
  const full = path.join(repoRoot, 'node_modules', '.bin', name);
  return isExecutableFile(full) ? full : null;
}

function locate(
  name: string,
  repoRoot: string,
  pathValue: string
): { command: string; source: ResolutionSource } | null {
  const onPath = findOnPath(name, pathValue);
  if (onPath !== null) {
    return { command: onPath, source: 'path' };
  }
  const local = findInNodeModules(name, repoRoot);
  if (local !== null) {
    return { command: local, source: 'node_modules' };
  }
  return null;
}

/** The candidate whose --version can be asked without running anything. */
function versionProbeFor(
  product: Product,
  resolvedCandidate: Candidate,
  resolvedCommand: string,
  repoRoot: string,
  pathValue: string
): VersionProbe | null {
  if (resolvedCandidate.versionSafe) {
    return { command: resolvedCommand, argv: ['--version'] };
  }
  for (const candidate of CANDIDATES[product]) {
    if (!candidate.versionSafe) {
      continue;
    }
    const found = locate(candidate.name, repoRoot, pathValue);
    if (found !== null) {
      return { command: found.command, argv: ['--version'] };
    }
  }
  return null;
}

/** Strips a script extension so "intent-guard.js" matches the candidate table. */
function baseName(file: string): string {
  return path.basename(file).replace(/\.(?:js|mjs|cjs)$/, '');
}

/**
 * Resolves the binary for one gate.
 *
 * `pathValue` is passed in rather than read from the environment so tests
 * can put a shim directory in front of whatever the machine has installed,
 * without mutating process.env for every other test in the file.
 *
 * Returns null when nothing resolves. That is not an error here: the caller
 * turns it into the umbrella's own blocking finding, which is a better
 * failure than a thrown exception that takes the other gates' reports with
 * it. A CONFIGURED command that does not exist does throw, because the user
 * named one specific file and falling back to something else would run a
 * different tool than the one they asked for.
 */
export function resolveGateBinary(
  gate: GatePolicy,
  repoRoot: string,
  pathValue: string
): ResolvedBinary | null {
  const table = CANDIDATES[gate.product];

  if (gate.command !== undefined) {
    if (!existsAsFile(gate.command)) {
      throw new ResolveError(
        `gates.${gate.role}.command points at "${gate.command}", which is not a file. ` +
          'Fix the path or remove the override; the umbrella will not quietly run something else.'
      );
    }

    const inferred = table.find((candidate) => candidate.name === baseName(gate.command as string));
    const prefix = gate.args ?? inferred?.prefix ?? table[0].prefix;
    const candidateName = inferred?.name ?? baseName(gate.command);
    const candidate = inferred ?? table[0];

    // A build directory holds plain .js files with a shebang but no
    // executable bit surprisingly often (a fresh tsc output, a file copied
    // out of a tarball). Running it through this same Node is exactly what
    // the shebang asks for and keeps the override usable for the case it
    // exists to serve: pointing at a build that is not installed anywhere.
    if (!isExecutableFile(gate.command) && /\.(?:js|mjs|cjs)$/.test(gate.command)) {
      return {
        command: process.execPath,
        argvPrefix: [gate.command, ...prefix],
        source: 'policy',
        candidate: candidateName,
        versionProbe: candidate.versionSafe
          ? { command: process.execPath, argv: [gate.command, '--version'] }
          : versionProbeFor(gate.product, candidate, gate.command, repoRoot, pathValue),
      };
    }

    return {
      command: gate.command,
      argvPrefix: prefix,
      source: 'policy',
      candidate: candidateName,
      versionProbe: versionProbeFor(gate.product, candidate, gate.command, repoRoot, pathValue),
    };
  }

  for (const candidate of table) {
    const found = locate(candidate.name, repoRoot, pathValue);
    if (found === null) {
      continue;
    }
    return {
      command: found.command,
      argvPrefix: [...candidate.prefix],
      source: found.source,
      candidate: candidate.name,
      versionProbe: versionProbeFor(gate.product, candidate, found.command, repoRoot, pathValue),
    };
  }

  return null;
}

/** Every name resolution would try, for the missing-gate finding's message. */
export function candidateNames(product: Product): string[] {
  return CANDIDATES[product].map((candidate) => candidate.name);
}
