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
//     the candidate list, and only the inner loop is location.
//
//  1b. Within one name, the REPOSITORY'S OWN COPY wins over a global
//     install. This was the other way round until a dogfood run found a
//     global vault-guard 1.4.3 running over the repository's pinned 1.4.1,
//     silently, with the report naming a version that repository had
//     deliberately not chosen. `pnpm exec` in the same repository runs the
//     pin, so PATH-first meant the umbrella and the package manager
//     disagreed about which copy of a gate a repository means, and the
//     package manager is the one the repository's lockfile agrees with.
//     Note that this is the opposite ordering from rule 1, and deliberately
//     so: a NAME is a statement about which product, and the repository has
//     no say in that; a LOCATION is a statement about which build, and the
//     repository does.
//
//  1c. ON A PULL-REQUEST RUN node_modules/.bin IS NOT A LOCATION AT ALL.
//     Rule 1b says a LOCATION is a statement about which build and the
//     repository gets to make it. On a pull request the repository making
//     that statement IS the pull request: what is under node_modules was
//     chosen by the head's own manifest and lockfile, installed by a step
//     that runs before the gates, and git has no record of those bytes at
//     either ref. 0.3.0 let resolution take it and then refused the program,
//     which was safe and made every ordinary pull request in a
//     devDependency-installed repository exit 2 with three refusals. Not
//     trying that location at all is the same safety with the gate still
//     running, from a build the base branch pinned. The skip is never
//     silent: the caller reports the candidate it declined.
//
//  2. Only a unified binary is asked for its version. `intent-guard`
//     answers --version; a per-command binary once did not parse the flag at
//     all and RAN THE GATE against the current directory instead, and a
//     version probe that runs a gate is not a probe.
//
//     That is fixed, and NO PUBLISHED VERSION OF THE NAMES RESOLVED HERE
//     has the bug: the fix is the commit v1.2.0 points at, only 1.2.0 and
//     1.2.1 were ever published under these names, and the releases that
//     had it were the pre-rename packages this file already refuses to
//     resolve at all. So this is belt and braces against a class of bug
//     rather than a live hazard. It is kept because it costs one field on a
//     candidate and a fallback nobody exercises, and because the failure it
//     prevents is silent and happens in the user's own repository: when the
//     resolved binary is a per-command one, the unified binary of the same
//     product is resolved separately and asked instead, and when that is not
//     installed either the version is reported unknown rather than guessed.
//
//  3. There is no npx fallback. The draft proposed `npx --no-install` as a
//     last resort, and it is dropped here on purpose: it makes what ran
//     depend on a package cache the report cannot describe, and a gate that
//     "ran" from an unknown version is worse than one that is honestly
//     reported missing.

import { accessSync, constants, lstatSync, statSync } from 'node:fs';
import path from 'node:path';

import type { GatePolicy, Product } from './policy.js';
import { profileFor } from './products.js';

export type ResolutionSource = 'policy' | 'path' | 'node_modules';

export interface Candidate {
  /** Executable name. */
  name: string;
  /** Arguments this binary needs before the umbrella's own. */
  prefix: string[];
  /**
   * Whether `<name> --version` can be relied on to print a version instead
   * of doing work. False for the per-command binaries, per rule 2 above: no
   * published version under the names resolved here ignores the flag, so
   * this is a guard against the class of bug rather than against a release
   * anybody can install.
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
  /**
   * The FILE whose contents decide what this gate does.
   *
   * Usually the same as `command`, and deliberately not the same when a
   * `.js` build is run through this Node: there `command` is the Node
   * executable and the program is the script after it. Carried explicitly
   * rather than reconstructed from `argvPrefix[0]` by every caller, because
   * getting that wrong means vetting the wrong file, and the one caller that
   * vets it is the pull-request provenance check.
   */
  program: string;
  /** Arguments placed before the ones the umbrella adds. */
  argvPrefix: string[];
  /**
   * Every file or directory the policy's own `args:` names on disk, as an
   * absolute path, with every loadable sibling of each (`argumentCandidates`),
   * in args order. Empty when the policy has no `args:`.
   *
   * Carried because an interpreter `command:` hands the program to run as an
   * ARGUMENT: with `command: /usr/bin/node` and `args: [tools/gate/run.mjs]`
   * the script is what judges, not Node, and the pull-request provenance check
   * has to vet it the way it vets `program` (audit 2026-10-27, B1). Only the
   * policy's args, never a candidate's built-in prefix (`scan`, `source`):
   * those are subcommands this package wrote, and a directory of the same
   * name in somebody's repository is not a program.
   */
  argumentPaths: string[];
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
  // The two external tools. Each has one name, and both version probes
  // (gitleaks version, osv-scanner --version) print and exit without scanning.
  gitleaks: [{ name: 'gitleaks', prefix: ['git'], versionSafe: true }],
  'osv-scanner': [{ name: 'osv-scanner', prefix: ['scan', 'source'], versionSafe: true }],
};

export interface ResolveOptions {
  /**
   * Leave `node_modules/.bin` out of the search entirely.
   *
   * True on a pull-request run and false everywhere else, decided by the
   * caller from whether a trust base is set rather than re-derived here: this
   * module knows nothing about refs, and there must be exactly one place that
   * says what pull-request mode is.
   */
  skipNodeModules?: boolean;
}

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

export function findOnPath(name: string, pathValue: string): string | null {
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
  pathValue: string,
  skipNodeModules: boolean
): { command: string; source: ResolutionSource } | null {
  // The repository's own copy first: a project pin beats a global install,
  // which is what "pnpm exec <name>" does in the same repository. Unless this
  // is a pull-request run, where the repository saying which build to use is
  // the pull request itself (rule 1c at the top of this file).
  if (!skipNodeModules) {
    const local = findInNodeModules(name, repoRoot);
    if (local !== null) {
      return { command: local, source: 'node_modules' };
    }
  }
  const onPath = findOnPath(name, pathValue);
  if (onPath !== null) {
    return { command: onPath, source: 'path' };
  }
  return null;
}

/**
 * The node_modules/.bin candidate a pull-request run declined to take.
 *
 * Repository-relative, because it goes into a report and a published SARIF
 * log, where an absolute path is somebody's machine layout.
 *
 * Returns null when the policy names a `command:`: that overrides resolution
 * entirely, so no candidate was skipped, and saying one was would send a
 * reader to fix a file that decided nothing.
 *
 * Separate from `resolveGateBinary` rather than a field on its result,
 * because the case that most needs reporting is the one where resolution
 * returns NOTHING: a repository with the gates only as devDependencies, which
 * is the shape this whole change exists for.
 */
export function nodeModulesCandidate(gate: GatePolicy, repoRoot: string): string | null {
  if (gate.command !== undefined) {
    return null;
  }
  for (const candidate of CANDIDATES[gate.product]) {
    if (findInNodeModules(candidate.name, repoRoot) !== null) {
      return `node_modules/.bin/${candidate.name}`;
    }
  }
  return null;
}

/** The candidate whose --version can be asked without running anything. */
function versionProbeFor(
  product: Product,
  resolvedCandidate: Candidate,
  resolvedCommand: string,
  repoRoot: string,
  pathValue: string,
  skipNodeModules: boolean
): VersionProbe | null {
  // How to ask is the product's (src/products.ts); whether this particular
  // binary can be asked safely is the candidate's, per rule 2 above.
  const spec = profileFor(product).versionProbe;
  if (spec === null) {
    return null;
  }
  if (resolvedCandidate.versionSafe) {
    return { command: resolvedCommand, argv: [...spec.argv] };
  }
  for (const candidate of CANDIDATES[product]) {
    if (!candidate.versionSafe) {
      continue;
    }
    // The skip reaches here too, and it has to: a probe RUNS the binary, so
    // resolving the version-safe sibling out of node_modules would execute a
    // head-chosen program in order to answer a question about it.
    const found = locate(candidate.name, repoRoot, pathValue, skipNodeModules);
    if (found !== null) {
      return { command: found.command, argv: [...spec.argv] };
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
  pathValue: string,
  options: ResolveOptions = {}
): ResolvedBinary | null {
  const table = CANDIDATES[gate.product];
  const skipNodeModules = options.skipNodeModules ?? false;

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
    const argumentPaths = argumentPathsOf(gate, repoRoot);

    // A build directory holds plain .js files with a shebang but no
    // executable bit surprisingly often (a fresh tsc output, a file copied
    // out of a tarball). Running it through this same Node is exactly what
    // the shebang asks for and keeps the override usable for the case it
    // exists to serve: pointing at a build that is not installed anywhere.
    if (!isExecutableFile(gate.command) && /\.(?:js|mjs|cjs)$/.test(gate.command)) {
      return {
        command: process.execPath,
        // Node is the command; the script is what actually decides anything.
        program: gate.command,
        argvPrefix: [gate.command, ...prefix],
        argumentPaths,
        source: 'policy',
        candidate: candidateName,
        versionProbe:
          candidate.versionSafe && profileFor(gate.product).versionProbe !== null
            ? {
                command: process.execPath,
                argv: [gate.command, ...(profileFor(gate.product).versionProbe?.argv ?? [])],
              }
          : versionProbeFor(
              gate.product,
              candidate,
              gate.command,
              repoRoot,
              pathValue,
              skipNodeModules
            ),
      };
    }

    // A command that is not itself a gate name (an interpreter, typically)
    // and whose args hand it a script is asked through the script, or the
    // version reported is the interpreter's (audit 2026-10-27, N4). A
    // version-unsafe candidate keeps its sibling lookup: rule 2 above.
    const viaScript =
      inferred === undefined && candidate.versionSafe ? scriptVersionProbe(gate, repoRoot) : null;
    return {
      command: gate.command,
      program: gate.command,
      argvPrefix: prefix,
      argumentPaths,
      source: 'policy',
      candidate: candidateName,
      versionProbe:
        viaScript ??
        versionProbeFor(gate.product, candidate, gate.command, repoRoot, pathValue, skipNodeModules),
    };
  }

  for (const candidate of table) {
    const found = locate(candidate.name, repoRoot, pathValue, skipNodeModules);
    if (found === null) {
      continue;
    }
    return {
      command: found.command,
      program: found.command,
      argvPrefix: [...candidate.prefix],
      argumentPaths: [],
      source: found.source,
      candidate: candidate.name,
      versionProbe: versionProbeFor(
        gate.product,
        candidate,
        found.command,
        repoRoot,
        pathValue,
        skipNodeModules
      ),
    };
  }

  return null;
}

/** Every name resolution would try, for the missing-gate finding's message. */
export function candidateNames(product: Product): string[] {
  return CANDIDATES[product].map((candidate) => candidate.name);
}

/**
 * The extensions an interpreter can add to an entry before it looks at the
 * entry as written: Node's main-entry resolution tries `.js`, `.json` and
 * `.node` BEFORE a directory of the same name (`node tools/gate` runs
 * `tools/gate.js` over `tools/gate/index.js`, measured on Node 22), and the
 * ES module forms are listed too, so a sibling a loader might take is vetted
 * whether or not this Node takes it (audit 2026-10-27 fix round, MB1 and
 * MB2).
 */
const LOADABLE_EXTENSIONS = ['.js', '.mjs', '.cjs', '.json', '.node'];

function existsAtAll(candidate: string): boolean {
  try {
    lstatSync(candidate);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether the policy's `command:` is itself the gate program, so its `args:`
 * are that gate's own argv rather than something an interpreter will load.
 *
 * True when the command's name is a candidate name (`vault-guard`,
 * `intent-guard.js`), and for a non-executable `.js` command, which this
 * package runs through its own Node with the script as the program. False
 * for anything else, an interpreter such as `node` or `python3` above all.
 * Only then are the product's subcommand words (`scan`, `source`) exempt
 * from being read as paths: an interpreter handed `scan` runs `scan.js` or
 * `scan/index.js`, so for it the word is a path like any other (audit
 * 2026-10-27 fix round, MB3).
 */
export function commandIsGateProgram(gate: GatePolicy): boolean {
  if (gate.command === undefined) {
    return true;
  }
  if (!isExecutableFile(gate.command) && /\.(?:js|mjs|cjs)$/.test(gate.command)) {
    return true;
  }
  const name = baseName(gate.command);
  return CANDIDATES[gate.product].some((candidate) => candidate.name === name);
}

/**
 * Every path an interpreter could load for one `args:` entry, as absolute
 * paths, in the order checked; empty when the entry names nothing on disk
 * (audit 2026-10-27, B1, and its fix round).
 *
 * Relative entries are resolved against `repoRoot`. That is the working
 * directory of the version probe and of the gate's own spawn for every
 * product except one whose base config can name further files
 * (`followsConfigExtend`): on a pull request that gate runs from a temporary
 * directory holding the base ref's copies (src/gate-runner.ts, spawnCwd), so
 * a relative script there resolves against base copies or not at all, never
 * against the head tree. The rules, in order:
 *
 *  - An option with no `=` (`--json`, `-r`) names nothing. An option with one
 *    (`--config=tools/cfg.json`, `--import=./hook.mjs`) is read for the value
 *    after the first `=`, since that is where an interpreter takes a file to
 *    load and a gate takes a file to read its rules from.
 *  - When `exemptSubcommands` is true (the command is the gate program
 *    itself, commandIsGateProgram), a bare word that is one of the product's
 *    own subcommands (`scan`, `git`, `source`, `check`) names nothing, even
 *    when a directory of that name exists. For an interpreter nothing is
 *    exempt.
 *  - The entry as written, when it exists as a file, a directory or a
 *    symlink, without following the symlink, so the caller can refuse an
 *    in-tree link on its own entry.
 *  - Then every `<entry>.js`, `.mjs`, `.cjs`, `.json` and `.node` that exists,
 *    slash or not, and whether or not the entry itself exists: Node tries
 *    those before a directory of the same name, and a bare `run` runs
 *    `run.js`. A sibling the head ADDED is listed too, which is what refuses
 *    it: the base does not track it.
 *
 * A directory's contents are covered by the caller's tree comparison, so
 * `index.js` and `package.json` inside it are not listed separately; a
 * `main` that points outside the directory is not vetted, the same limit as
 * a program's directory. Everything else, a Python `-m` module name, a bare
 * package specifier an interpreter resolves for itself, code passed as a
 * string (`node -e`, `bash -c`), is not recognised as a path. The README says
 * so.
 */
export function argumentCandidates(
  arg: string,
  repoRoot: string,
  product: Product,
  exemptSubcommands: boolean
): string[] {
  let value = arg;
  if (arg.startsWith('-')) {
    const equals = arg.indexOf('=');
    if (equals < 0) {
      return [];
    }
    value = arg.slice(equals + 1);
  } else if (exemptSubcommands && CANDIDATES[product].some((candidate) => candidate.prefix.includes(arg))) {
    return [];
  }
  if (value === '') {
    return [];
  }
  const absolute = path.resolve(repoRoot, value);
  return [absolute, ...LOADABLE_EXTENSIONS.map((extension) => absolute + extension)].filter(existsAtAll);
}

/** `argumentCandidates` for every entry of a policy's `args:`, flattened. */
function argumentPathsOf(gate: GatePolicy, repoRoot: string): string[] {
  const exempt = commandIsGateProgram(gate);
  return (gate.args ?? []).flatMap((arg) => argumentCandidates(arg, repoRoot, gate.product, exempt));
}

/**
 * The version probe for a policy `command:` that is not itself a gate name,
 * when its `args:` hand it a script: the args up to and including the first
 * non-option entry, when that entry names something the interpreter can load
 * (argumentCandidates: a file, a directory, or a bare or extension-less name
 * with a loadable sibling), then the product's own probe argv. The entry is
 * passed as written, so the interpreter resolves it exactly as it will for
 * the scan. So `node tools/gate/run.mjs scan` is asked `node
 * tools/gate/run.mjs --version`, `node tools/gate` is asked `node tools/gate
 * --version`, and the version reported is the script's, not Node's (audit
 * 2026-10-27, N4). Null when the first non-option entry names nothing, or
 * there is none, and the caller keeps the probe it would have made anyway.
 *
 * Only the first: everything after the script is the script's own argv, and
 * carrying a subcommand or a target into a probe would make it do work,
 * which is the one thing a probe must not do.
 * An interpreter flag that takes a file as a separate entry (`-r
 * ./setup.js`) makes that file the first, so the probe asks the interpreter
 * and reports its version, as it did before; under an expected-version pin
 * that is could-not-run, the fail-closed direction.
 */
function scriptVersionProbe(gate: GatePolicy, repoRoot: string): VersionProbe | null {
  const spec = profileFor(gate.product).versionProbe;
  if (spec === null || gate.command === undefined || gate.args === undefined) {
    return null;
  }
  for (let index = 0; index < gate.args.length; index += 1) {
    const arg = gate.args[index]!;
    if (arg.startsWith('-')) {
      continue;
    }
    // Only the FIRST non-option entry can be the script. A later file is the
    // script's own argument (`my-build check rules.json`), and a probe that
    // carried the subcommand before it would make the gate do work.
    return argumentCandidates(arg, repoRoot, gate.product, false).length > 0
      ? { command: gate.command, argv: [...gate.args.slice(0, index + 1), ...spec.argv] }
      : null;
  }
  return null;
}
