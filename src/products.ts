// What the runner needs to know about each product, as data.
//
// The runner used to hardcode one behaviour for every gate: ask --version,
// read JSON from stdout, read exit 0 as clean and 1 as blocked, give up after
// two minutes. That was true of the three npm gates and it is not true of the
// external tools, so the behaviour lives here per product and the runner
// consults it. The three npm profiles below restate exactly what the runner
// did before profiles existed; changing one of them changes a gate that
// adopters already run.

import type { Product } from './policy.js';

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
  timeoutMs: number;
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
   * File names the tool is handed one by one, from the repository's tracked
   * files, instead of being pointed at a directory to walk. Null for a tool
   * that is not handed files.
   */
  lockfileNames: readonly string[] | null;
  /**
   * The config can name another file (`[extend] path`) that the tool reads
   * relative to its working directory. On a pull request every such file is
   * materialised from the base ref and the tool is run from that directory.
   */
  followsConfigExtend: boolean;
}

/**
 * The lockfiles osv-scanner is handed, matched by base name at any depth
 * among the repository's TRACKED files (`git ls-files`).
 *
 * By name, not by walking the tree, for three reasons: osv-scanner's own walk
 * skips anything .gitignore matches, tracked or not, so a pull request could
 * hide a committed lockfile from it with one ignore line; the walk can reach
 * into node_modules; and an untracked lockfile is not part of what is being
 * judged. Only the npm family is listed, because that is the ecosystem this
 * family's own dependency gate knows (npm, pnpm, yarn, bun); osv-scanner
 * supports more, and a repository whose only lockfile is another ecosystem's
 * gets nothing-to-scan until a name is added here.
 */
export const OSV_LOCKFILE_NAMES: readonly string[] = [
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
];

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
      : `Install it with npm install -g @vaultcompass/${product}, or add it to the repository's devDependencies.`;
}

function managedProfile(product: Product): ProductProfile {
  return {
    product,
    managed: true,
    versionProbe: { argv: ['--version'], pattern: NPM_VERSION_PATTERN },
    output: { kind: 'stdout' },
    exit: NPM_EXIT,
    timeoutMs: 120_000,
    minVersion: null,
    configFile: null,
    neutralConfig: null,
    ignoreFile: null,
    remedy: managedRemedy(product),
    stderrError: null,
    lockfileNames: null,
    followsConfigExtend: false,
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
    timeoutMs: 600_000,
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
    lockfileNames: null,
    followsConfigExtend: true,
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
    lockfileNames: OSV_LOCKFILE_NAMES,
    followsConfigExtend: false,
  },
};

export function profileFor(product: Product): ProductProfile {
  return PROFILES[product];
}
