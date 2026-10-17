// What the runner needs to know about each product, as data.
//
// The runner used to hardcode one behaviour for every gate: ask --version,
// read JSON from stdout, read exit 0 as clean and 1 as blocked, give up after
// two minutes. That was true of the three npm gates and it is not true of the
// external tools, so the behaviour lives here per product and the runner
// consults it. The three npm profiles below restate exactly what the runner
// did before profiles existed; changing one of them changes a gate that
// adopters already run.

import type { GateRole, Product } from './policy.js';

/** The first half of every timed-out remedy: where the limit is raised. */
function raiseTheLimit(role: GateRole): string {
  return (
    `Raise the limit with gates.${role}.timeout-seconds in .guardrails.yaml (on a pull request, on ` +
    'the base branch).'
  );
}

export type OutputSource =
  | { kind: 'stdout' }
  | { kind: 'report-file'; flag: string; extension: string };

export interface ExitSemantics {
  clean: readonly number[];
  blocked: readonly number[];
  /** Exits that mean "there was nothing here to scan": clean, with a diagnostic. */
  nothingToScan: readonly number[];
}

export interface VersionProbeSpec {
  argv: readonly string[];
  /**
   * Applied to the trimmed first line of the probe's stdout. Capture group 1
   * is the version when the pattern has one; otherwise the whole match is.
   */
  pattern: RegExp;
}

export interface ProductProfile {
  product: Product;
  /** Installed by the Action from npm and covered by npm audit signatures. */
  managed: boolean;
  versionProbe: VersionProbeSpec | null;
  output: OutputSource;
  exit: ExitSemantics;
  /** The time limit when the policy sets no timeout-seconds for this gate. */
  timeoutMs: number;
  /**
   * What to do about a gate stopped at its limit: the sentence the timed-out
   * detail carries. Never a bounded history window or a default size cap,
   * which would narrow coverage without anybody deciding to.
   */
  timeoutRemedies: (role: GateRole) => string;
  /** Oldest version whose command line this runner speaks; null means any. */
  minVersion: string | null;
  /** Config file the tool auto-loads from the scanned tree; read from the base ref on a pull request. */
  configFile: string | null;
  /** What to pass as the config when the base ref has none, so the head's cannot be auto-loaded. */
  neutralConfig: string | null;
  /**
   * A second file the tool auto-loads from the scanned tree that suppresses
   * findings, and the flag that points it elsewhere. Read from the base ref
   * on a pull request, like the config.
   */
  ignoreFile: {
    name: string;
    flag: string;
    /**
     * The tool ALSO loads `<scan root>/<name>` whatever the flag says, so on
     * a pull request the scan root must be somewhere the head cannot write.
     */
    alsoLoadedFromScanRoot: boolean;
  } | null;
  /** How to install the tool, for a missing-binary finding. */
  remedy: (skipNodeModules: boolean) => string;
  /**
   * A stderr line (ANSI colour stripped) that turns a clean exit into an
   * error. Null for a tool whose exit code can be taken at its word.
   */
  stderrError: RegExp | null;
  /**
   * Which tracked files the tool is handed one by one, by base name, instead
   * of being pointed at a directory to walk, and how: `bare` as the path
   * itself, `requirements` as a pip requirements file that must first pass
   * the pin check (src/requirements-pin.ts). Null for a tool that is not
   * handed files.
   */
  lockfileMatcher: ((file: string) => LockfileKind | null) | null;
  /**
   * The config can name another file (`[extend] path`) that the tool reads
   * relative to its working directory. On a pull request every such file is
   * materialised from the base ref and the tool is run from that directory.
   */
  followsConfigExtend: boolean;
  /**
   * Whether this gate's INPUT is git history rather than the tree being
   * judged.
   *
   * True only for gitleaks. Every other gate here reads the tree (vault-guard
   * and dep-guard scan files, intent-guard reads a diff of paths) or a
   * lockfile in it (osv-scanner), so when the head tree is byte-identical to
   * the trust base's -- issue #69's shape, a value committed and then backed
   * out inside one pull request -- those gates have nothing to judge that the
   * base ref did not already judge, and the umbrella skips them rather than
   * reporting a clean scan of a change that is not there. gitleaks' report is
   * about commits between the base and HEAD, not about either tree, so it is
   * the one gate an equal tree does not blind: see `decideTrustBase` and the
   * equal-tree branch in `runAll` (src/run.ts).
   */
  readsHistory: boolean;
}

/** How a matched file is handed over: as its own path, or as a requirements file. */
export type LockfileKind = 'bare' | 'requirements';

/**
 * The lockfiles osv-scanner is handed as a bare path, matched by base name at
 * any depth among the repository's TRACKED files (`git ls-files`).
 *
 * By name, not by walking the tree, for three reasons: osv-scanner's own walk
 * skips anything .gitignore matches, tracked or not, so a pull request could
 * hide a committed lockfile from it with one ignore line; the walk can reach
 * into node_modules; and an untracked lockfile is not part of what is being
 * judged.
 *
 * Every name here was handed to osv-scanner 2.4.0 with --lockfile and read
 * (the 2026-10-11 osv design under docs/superpowers/specs, section 2.1). go.sum is deliberately absent: 2.4.0
 * rejects it ("could not determine extractor", exit 127), which would make
 * every Go pull request could-not-run, and go.mod is what it reads for Go.
 *
 * The second group was added on 2026-10-13 (audit finding F3: a tracked
 * mix.lock was neither scanned nor named), each measured the same way
 * against 2.4.0 and read with one or more packages. Measured and NOT added,
 * because 2.4.0 exits 127 on them: Podfile.lock and deno.lock (both are
 * named by the unread-manifests note instead). gradle's
 * verification-metadata.xml is read only inside a `gradle` directory and is
 * matched by `osvLockfileKind` rather than listed here.
 */
export const OSV_LOCKFILE_NAMES: readonly string[] = [
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'go.mod',
  'poetry.lock',
  'Pipfile.lock',
  'uv.lock',
  'pdm.lock',
  'Cargo.lock',
  'Gemfile.lock',
  'composer.lock',
  'gradle.lockfile',
  'packages.lock.json',
  'mix.lock',
  'pubspec.lock',
  'Package.resolved',
  'conan.lock',
  'renv.lock',
  'packages.config',
  'buildscript-gradle.lockfile',
  'gems.locked',
  'pylock.toml',
  'cabal.project.freeze',
  'stack.yaml.lock',
];

/** gradle's dependency verification file, which 2.4.0 reads only under a `gradle` directory. */
const GRADLE_VERIFICATION_METADATA = 'verification-metadata.xml';

/**
 * pip requirements files, by base name: requirements.txt itself,
 * requirements-dev.txt and its _ and . spellings, and dev-requirements.txt.
 * Not requirements.in (pip-tools input, unpinned by design), not constraints
 * files, and not a file under a requirements/ directory whose own name does
 * not match. A requirements file is handed over only when every requirement
 * in it, and in every file it includes, is pinned with == (the pin check).
 */
const REQUIREMENTS_PATTERNS: readonly RegExp[] = [
  /^requirements\.txt$/,
  /^requirements[-_.][A-Za-z0-9._-]+\.txt$/,
  /^[A-Za-z0-9._-]+[-_]requirements\.txt$/,
];

/**
 * What osv-scanner is handed for a tracked file, or null. Takes the
 * repository-relative path (a bare base name works for every name but one):
 * gradle's verification-metadata.xml is read by osv-scanner 2.4.0 only when
 * its parent directory is `gradle`, and anywhere else it exits 127, so the
 * parent is part of the match for that one file.
 */
export function osvLockfileKind(file: string): LockfileKind | null {
  const segments = file.split('/');
  const basename = segments[segments.length - 1] ?? '';
  if (basename === GRADLE_VERIFICATION_METADATA) {
    return segments[segments.length - 2] === 'gradle' ? 'bare' : null;
  }
  if (OSV_LOCKFILE_NAMES.includes(basename)) {
    return 'bare';
  }
  return REQUIREMENTS_PATTERNS.some((pattern) => pattern.test(basename)) ? 'requirements' : null;
}

/**
 * The npm gates print a bare version. No capture group on purpose: the runner
 * has always reported the whole first line minus a leading v, prerelease
 * suffix included, and the trust-base floor compares that value.
 */
export const NPM_VERSION_PATTERN = /^v?\d+\.\d+\.\d+.*/;

const NPM_EXIT: ExitSemantics = { clean: [0], blocked: [1], nothingToScan: [] };

function managedRemedy(product: Product): (skipNodeModules: boolean) => string {
  return (skipNodeModules) =>
    skipNodeModules
      ? `Install the gate outside the tree with npm install -g @vaultcompass/${product}. The ` +
        `conductor Action does exactly that, at the version its ${product}-version input pins, and ` +
        'that pin lives in the workflow file on the base branch.'
      : `The package is @vaultcompass/${product}, never the unscoped name: install it with npm install -g @vaultcompass/${product}, or add @vaultcompass/${product} to the repository's devDependencies.`;
}

function managedProfile(product: Product): ProductProfile {
  return {
    product,
    managed: true,
    versionProbe: { argv: ['--version'], pattern: NPM_VERSION_PATTERN },
    output: { kind: 'stdout' },
    exit: NPM_EXIT,
    timeoutMs: 120_000,
    timeoutRemedies: (role) =>
      `${raiseTheLimit(role)} A family gate that needs more than two minutes is unusual, so the ` +
      "gate's own output below is worth reading first.",
    minVersion: null,
    configFile: null,
    neutralConfig: null,
    ignoreFile: null,
    remedy: managedRemedy(product),
    stderrError: null,
    lockfileMatcher: null,
    followsConfigExtend: false,
    readsHistory: false,
  };
}

const PROFILES: Record<Product, ProductProfile> = {
  'dep-guard': managedProfile('dep-guard'),
  'vault-guard': managedProfile('vault-guard'),
  'intent-guard': managedProfile('intent-guard'),
  gitleaks: {
    product: 'gitleaks',
    managed: false,
    versionProbe: { argv: ['version'], pattern: /(\d+\.\d+\.\d+)/ },
    // gitleaks writes its JSON report to a file, never to stdout.
    output: { kind: 'report-file', flag: '--report-path', extension: '.json' },
    // gitleaks exits 1 for a leak AND for an error by default. The umbrella
    // passes --exit-code 3 (src/gate-runner.ts, gateArgs), so 3 is a leak and
    // 1 is left meaning an error.
    exit: { clean: [0], blocked: [3], nothingToScan: [] },
    // A full-history scan on a large repository outlives the npm gates' two
    // minutes; could-not-run on every pull request is the failure to avoid.
    // This is the default when the policy sets no timeout-seconds.
    timeoutMs: 600_000,
    timeoutRemedies: (role) =>
      `${raiseTheLimit(role)} A history scan grows with the repository's history and the size of ` +
      'what was committed: scan full history on a schedule and let pull requests scan only their ' +
      'own range, or pass max-target-megabytes under options, which skips every file larger than ' +
      'the cap without saying which, so a secret in such a file is not found.',
    minVersion: '8.19.0',
    configFile: '.gitleaks.toml',
    neutralConfig: '[extend]\nuseDefault = true\n',
    // .gitleaksignore lists fingerprints the scan skips: a pull request
    // adding its own leak's fingerprint there is the config hole through a
    // second file. gitleaks 8.30.1 loads the one at --gitleaks-ignore-path
    // AND the one at the root of the scanned source, whatever the flag says
    // (observed against the real binary, tests/fixtures/README.md), so the
    // flag alone does not close it.
    ignoreFile: { name: '.gitleaksignore', flag: '--gitleaks-ignore-path', alsoLoadedFromScanRoot: true },
    remedy: () =>
      'Install gitleaks 8.19 or later on the machine or runner before conductor runs (a pinned ' +
      'release download with a checksum is the usual step), or disable the secrets-history gate ' +
      'in .guardrails.yaml. conductor does not download it.',
    // gitleaks 8.30.1 swallows a git failure: it logs "<time> ERR [git]
    // fatal: ..." and exits 0 with an empty report (tests/fixtures/README.md).
    stderrError: /^\S+\s+ERR\s/,
    lockfileMatcher: null,
    followsConfigExtend: true,
    // gitleaks reads git history (--log-opts), never the tree, which is
    // exactly what makes it the one gate an equal-tree pull request does not
    // blind (issue #69): the history between the base and HEAD still holds
    // whatever was committed and backed out, even when the two trees match.
    readsHistory: true,
  },
  'osv-scanner': {
    product: 'osv-scanner',
    managed: false,
    versionProbe: { argv: ['--version'], pattern: /(\d+\.\d+\.\d+)/ },
    // JSON goes to stdout and everything else to stderr.
    output: { kind: 'stdout' },
    // 128 is osv-scanner's "no package sources found": a repository with no
    // lockfile has nothing to scan, which is clean, not an error.
    exit: { clean: [0], blocked: [1], nothingToScan: [128] },
    timeoutMs: 300_000,
    timeoutRemedies: (role) =>
      `${raiseTheLimit(role)} osv-scanner queries osv.dev over the network, so a slow or ` +
      'unreachable service shows up as a timeout too.',
    minVersion: '2.0.0',
    configFile: 'osv-scanner.toml',
    neutralConfig: '',
    ignoreFile: null,
    remedy: () =>
      'Install osv-scanner 2.x on the machine or runner before conductor runs, or disable the ' +
      'vulnerabilities gate in .guardrails.yaml. conductor does not download it.',
    // osv-scanner's exit codes separate an error (127) from a verdict, and
    // its stderr is progress chatter, so the exit is taken at its word.
    stderrError: null,
    lockfileMatcher: osvLockfileKind,
    followsConfigExtend: false,
    // osv-scanner reads the tracked lockfiles it is handed, which are the
    // tree being judged, not history.
    readsHistory: false,
  },
};

export function profileFor(product: Product): ProductProfile {
  return PROFILES[product];
}
