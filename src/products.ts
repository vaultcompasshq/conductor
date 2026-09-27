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
  /** How to install the tool, for a missing-binary finding. */
  remedy: (skipNodeModules: boolean) => string;
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
    remedy: managedRemedy(product),
  };
}

const PROFILES: Record<Product, ProductProfile> = {
  'dep-guard': managedProfile('dep-guard'),
  'vault-guard': managedProfile('vault-guard'),
  'intent-guard': managedProfile('intent-guard'),
};

export function profileFor(product: Product): ProductProfile {
  return PROFILES[product];
}
