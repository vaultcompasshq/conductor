# External Gates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** conductor runs two tools the adopter already installs, gitleaks in git-history mode and osv-scanner, as gates named in the policy file, with their findings in the combined report and SARIF, so one required check replaces a hand-rolled security job.

**Architecture:** Two new gate roles, `secrets-history` (product `gitleaks`) and `vulnerabilities` (product `osv-scanner`), keep the existing one-product-per-role model. A new `src/products.ts` holds a per-product profile (how the version is read, where the JSON comes from, what each exit code means, the timeout, the remedy when missing, and which config file conductor reads from the base ref on a pull request). The runner consults the profile instead of hardcoding the behaviour of the three npm-installed gates. conductor never downloads or pins an external tool; the adopter's own workflow step does, and a missing binary is could-not-run.

**Tech Stack:** TypeScript (ESM), Node 20 or later, Jest with experimental VM modules, `spawnSync`, gitleaks 8.19 or later, osv-scanner 2.x.

**Spec:** `docs/superpowers/specs/2026-09-26-one-required-check-program-design.md`, section 3 decisions 2, 3 and 4, section 4 item 4, section 10 open questions.

## Global Constraints

- Conductor downloads, pins or checksums no third-party binary (spec section 3 decision 2, section 7). No new Action inputs for the external tools.
- A missing external binary is could-not-run, exit 2, never a silent pass (spec section 3 decision 1: could-not-run stays red).
- The three existing gates keep byte-identical argv, exit interpretation, timeout and version probe. Every existing test stays green unchanged except where it pins the list of roles or products, and those tests are extended, never loosened.
- No U+2014 or U+2013 in any file; `pnpm lint` fails on them and on private names.
- Fixtures are literal captured stdout or report files from the real binaries, never hand-written, with the capture command recorded in `tests/fixtures/README.md` (existing repo rule).
- Every change to a claim in `docs/INVARIANTS.md` cites file:line and is verified by reading the line.
- File changes through Edit/Write tools only. Never `cd dir && cmd`. Commit messages plain ASCII, no backticks, no angle brackets, no arrows.

## Review Focus

Inputs the spec implies but no task's tests would otherwise exercise, most likely to bite first. Each has a test added to the owning task below.

1. gitleaks exits 1 for both leaks and errors by default. If `--exit-code` were left at 1, a crashed gitleaks would read as a block and a person would hunt a leak that does not exist. Task 5 moves the leak code to 3 and treats 1 as error; Task 6 tests the report-missing case.
2. osv-scanner exits 128 when it finds no packages, for example a docs-only repo. Read as an error it would redden every pull request in a repo with no lockfile. Task 5 treats 128 as clean with a diagnostic and tests it.
3. A pull request adds a `.gitleaks.toml` or `osv-scanner.toml` that allowlists what it is smuggling in. Both tools auto-load a config from the scanned tree. Task 7 always passes `--config` on a pull-request run, from the base ref or a neutral default, and reports a head-side change as a proposal.
4. A full-history gitleaks run on a large repo exceeds the umbrella's 120 second default timeout and reports could-not-run on every pull request. Task 5 gives external products their own default timeout and tests that the profile value is what reaches `spawnSync`.
5. gitleaks in history mode with default `git log --all` scans every branch, so one branch's planted secret reddens every other pull request (found building the proof repo). Task 4 always passes `--log-opts` scoped to `HEAD` or `base..HEAD` and tests both forms.

---

## File Structure

| File | Responsibility |
|---|---|
| Create `src/products.ts` | `ProductProfile` per product: version probe argv and pattern, output source (stdout or report file), exit semantics, default timeout, remedy text, base-ref config file name, `managed` flag. Pure data plus `profileFor`. |
| Modify `src/policy.ts` | Add roles `secrets-history`, `vulnerabilities`; products `gitleaks`, `osv-scanner`; default stage `ci`; `PRODUCT_FOR_ROLE`; `RESERVED_OPTIONS`; `reservedReason`. |
| Modify `schema/guardrails.schema.json` | New gate keys and product enum values. |
| Modify `src/init-policy.ts` | `ROLE_DESCRIPTION` for the new roles; the rendered policy shows them found or not found. |
| Modify `src/resolve.ts` | `CANDIDATES` entries; `versionProbeFor` reads the profile. |
| Modify `src/gate-runner.ts` | `gateArgs` cases; `probeVersion` uses the profile pattern; `runGateInner` classifies exit codes through the profile, reads a report file when the profile says so, applies the profile timeout, and hands the blocked flag to normalisation; `TRUST_BASE_MIN_VERSION` entries; `missingGateRemedy` from the profile; a version floor per external product. |
| Create `src/external-config.ts` | On a pull-request run, materialise the tool's config from the base ref (or a neutral default) into the temp root and return the `--config` path plus a proposal when the head differs. |
| Modify `src/normalize.ts` | `normalizeGitleaks`, `normalizeOsvScanner`, `normalizeFor` with a `blocked` flag. |
| Modify `src/run.ts` | Pass `tempRoot` and `trustBase` details the runner needs for external config; nothing else. |
| Modify `tests/helpers/stub-gate.ts` | Stubs that answer a `version` subcommand, write a report file to the path given after a flag, and exit with a chosen code. |
| Create `tests/fixtures/gitleaks-<ver>-history-blocking.json`, `-clean.json`, `tests/fixtures/osv-scanner-<ver>-blocking.json`, `-clean.json` | Captured real output. |
| Modify `tests/fixtures/README.md` | Capture commands and versions. |
| Modify `tests/policy.test.ts`, `tests/resolve.test.ts`, `tests/gate-runner.test.ts`, `tests/normalize.test.ts`, `tests/run.test.ts`, `tests/output-sarif.test.ts`, `tests/output-text.test.ts`, `tests/init.test.ts` | Extend the pinned sets and add the new behaviour. |
| Modify `README.md`, `docs/INVARIANTS.md`, `CHANGELOG.md`, code comments | "three gates" wording, the recipe's adopter install steps, the new roles, the remedy. |

The `guardrails-family` shared README block (README.md lines 32 to 46) is kept byte-identical across four repos and is NOT edited in this plan; a cross-repo sweep handles it later.

---

### Task 1: Product profiles, wired to the existing three gates without behaviour change

**Files:**
- Create: `src/products.ts`
- Modify: `src/resolve.ts:236-260` (`versionProbeFor`)
- Modify: `src/gate-runner.ts:514-531` (`probeVersion`), `:572-588` (`missingGateRemedy`), `:665` (timeout default)
- Test: `tests/products.test.ts` (new), `tests/gate-runner.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type OutputSource = { kind: 'stdout' } | { kind: 'report-file'; flag: string; extension: string };
  export interface ExitSemantics { clean: readonly number[]; blocked: readonly number[]; nothingToScan: readonly number[]; }
  export interface VersionProbeSpec { argv: readonly string[]; pattern: RegExp; }
  export interface ProductProfile {
    product: Product;
    managed: boolean;
    versionProbe: VersionProbeSpec | null;
    output: OutputSource;
    exit: ExitSemantics;
    timeoutMs: number;
    minVersion: string | null;
    configFile: string | null;
    neutralConfig: string | null;
    remedy: (skipNodeModules: boolean) => string;
  }
  export function profileFor(product: Product): ProductProfile;
  export const NPM_VERSION_PATTERN: RegExp; // /^v?(\d+\.\d+\.\d+)/
  ```
- Consumes: `Product` from `src/policy.ts`.

- [x] **Step 1: Write the failing tests**

```ts
// tests/products.test.ts
import { describe, expect, it } from '@jest/globals';
import { PRODUCTS } from '../src/policy.js';
import { NPM_VERSION_PATTERN, profileFor } from '../src/products.js';

describe('product profiles', () => {
  it('has a profile for every product', () => {
    for (const product of PRODUCTS) {
      expect(profileFor(product).product).toBe(product);
    }
  });

  it('keeps the three npm gates on the behaviour the runner had before profiles existed', () => {
    for (const product of ['dep-guard', 'vault-guard', 'intent-guard'] as const) {
      const p = profileFor(product);
      expect(p.managed).toBe(true);
      expect(p.output).toEqual({ kind: 'stdout' });
      expect(p.exit).toEqual({ clean: [0], blocked: [1], nothingToScan: [] });
      expect(p.timeoutMs).toBe(120_000);
      expect(p.configFile).toBeNull();
    }
    expect(profileFor('dep-guard').versionProbe).toEqual({ argv: ['--version'], pattern: NPM_VERSION_PATTERN });
    expect(profileFor('vault-guard').versionProbe).toEqual({ argv: ['--version'], pattern: NPM_VERSION_PATTERN });
    expect(profileFor('intent-guard').versionProbe).toBeNull();
  });

  it('names the npm install and the action input in the remedy for a managed product', () => {
    expect(profileFor('dep-guard').remedy(false)).toContain('npm install -g @vaultcompass/dep-guard');
    expect(profileFor('dep-guard').remedy(true)).toContain('dep-guard-version');
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm --dir <worktree> test -- tests/products.test.ts 2>&1 | tail -20`
Expected: FAIL, cannot find module `../src/products.js`.

- [x] **Step 3: Write `src/products.ts`**

Read `missingGateRemedy` at `src/gate-runner.ts:572-588` first and move its two sentences verbatim into the managed remedy so the wording does not drift.

```ts
// src/products.ts
import type { Product } from './policy.js';

export type OutputSource = { kind: 'stdout' } | { kind: 'report-file'; flag: string; extension: string };

export interface ExitSemantics {
  clean: readonly number[];
  blocked: readonly number[];
  nothingToScan: readonly number[];
}

export interface VersionProbeSpec {
  argv: readonly string[];
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
  remedy: (skipNodeModules: boolean) => string;
}

export const NPM_VERSION_PATTERN = /^v?(\d+\.\d+\.\d+)/;

const NPM_EXIT: ExitSemantics = { clean: [0], blocked: [1], nothingToScan: [] };

function managedRemedy(product: Product): (skipNodeModules: boolean) => string {
  return (skipNodeModules) =>
    skipNodeModules
      ? `Install it with npm install -g @vaultcompass/${product}, or set the ${product}-version input on the action; a pull-request run does not read node_modules/.bin.`
      : `Install it with npm install -g @vaultcompass/${product}, or add it to the repository's devDependencies.`;
}

const PROFILES: Record<Product, ProductProfile> = {
  'dep-guard': {
    product: 'dep-guard', managed: true,
    versionProbe: { argv: ['--version'], pattern: NPM_VERSION_PATTERN },
    output: { kind: 'stdout' }, exit: NPM_EXIT, timeoutMs: 120_000,
    minVersion: null, configFile: null, neutralConfig: null, remedy: managedRemedy('dep-guard'),
  },
  'vault-guard': {
    product: 'vault-guard', managed: true,
    versionProbe: { argv: ['--version'], pattern: NPM_VERSION_PATTERN },
    output: { kind: 'stdout' }, exit: NPM_EXIT, timeoutMs: 120_000,
    minVersion: null, configFile: null, neutralConfig: null, remedy: managedRemedy('vault-guard'),
  },
  'intent-guard': {
    product: 'intent-guard', managed: true,
    versionProbe: null,
    output: { kind: 'stdout' }, exit: NPM_EXIT, timeoutMs: 120_000,
    minVersion: null, configFile: null, neutralConfig: null, remedy: managedRemedy('intent-guard'),
  },
};

export function profileFor(product: Product): ProductProfile {
  return PROFILES[product];
}
```

If the existing `missingGateRemedy` wording differs from the two sentences above, use the existing wording; the test asserts substrings only.

- [x] **Step 4: Point `versionProbeFor` and `probeVersion` at the profile**

In `src/resolve.ts` `versionProbeFor` (lines 236-260): keep the `versionSafe` guard for the candidate, and when it is safe return `{ command, argv: [...profileFor(gate.product).versionProbe!.argv] }`. If the profile probe is null, return null.

In `src/gate-runner.ts` `probeVersion` (lines 514-531): replace the fixed `/^v?\d+\.\d+\.\d+/` test with the profile pattern:

```ts
const spec = profileFor(binary.product).versionProbe;
if (binary.versionProbe === null || spec === null) return null;
const first = (child.stdout ?? '').split('\n')[0] ?? '';
const match = spec.pattern.exec(first.trim());
return match === null ? null : (match[1] ?? match[0]).replace(/^v/, '');
```

`ResolvedBinary` has no `product` field today; add `product: Product` to the interface in `src/resolve.ts` and set it in `resolveGateBinary`, or pass `gate.product` into `probeVersion` as a parameter. Prefer the parameter: `probeVersion(binary, gate.product, repoRoot, timeoutMs)`; update its one call site at `:752`.

Replace the body of `missingGateRemedy(product, skipNodeModules, skipped)` with `return profileFor(product).remedy(skipNodeModules);` keeping any `skipped` handling that exists today (read it first; if `skipped` adds a sentence, keep that sentence in the runner, not the profile).

Replace `options.timeoutMs ?? 120_000` at `:665` with `options.timeoutMs ?? profileFor(gate.product).timeoutMs`.

- [x] **Step 5: Run the whole suite to prove no behaviour changed**

Run: `pnpm --dir <worktree> test 2>&1 | tail -8`
Expected: all previously passing suites pass; `tests/products.test.ts` passes.

- [x] **Step 6: Commit**

```
git -C <worktree> add src/products.ts src/resolve.ts src/gate-runner.ts tests/products.test.ts
git -C <worktree> commit -m "Add per-product profiles and route version probe, timeout and remedy through them (no behaviour change)"
```

---

### Task 2: Two new roles and products in the policy model

**Files:**
- Modify: `src/policy.ts:41-45, 69-73, 90-94, 102-128, 239-278`
- Modify: `schema/guardrails.schema.json`
- Modify: `src/init-policy.ts:42-46`
- Modify: `src/products.ts` (two profiles)
- Test: `tests/policy.test.ts:36, :115-125, :288-371`, `tests/products.test.ts`, `tests/init.test.ts`

**Interfaces:**
- Produces: `GATE_ROLES = ['dependencies', 'secrets', 'intent', 'secrets-history', 'vulnerabilities']`, `PRODUCTS = ['dep-guard', 'vault-guard', 'intent-guard', 'gitleaks', 'osv-scanner']`, `PRODUCT_FOR_ROLE['secrets-history'] === 'gitleaks'`, `PRODUCT_FOR_ROLE['vulnerabilities'] === 'osv-scanner'`, default stage `ci` for both.
- Consumes: `ProductProfile` from Task 1.

- [x] **Step 1: Extend the pinned-set tests so they fail**

In `tests/policy.test.ts` at the test "keys gates by role, not by product" (line 36) change the expected array to `['dependencies', 'secrets', 'intent', 'secrets-history', 'vulnerabilities']`. Add next to it:

```ts
it('maps the two external roles to their tools and defaults them to the ci stage', () => {
  expect(PRODUCT_FOR_ROLE['secrets-history']).toBe('gitleaks');
  expect(PRODUCT_FOR_ROLE['vulnerabilities']).toBe('osv-scanner');
  expect(DEFAULT_STAGE_FOR_ROLE['secrets-history']).toBe('ci');
  expect(DEFAULT_STAGE_FOR_ROLE['vulnerabilities']).toBe('ci');
});

it('parses a policy that names both external gates', () => {
  const policy = parsePolicy(
    ['version: 1', 'gates:', '  secrets-history:', '    product: gitleaks', '  vulnerabilities:', '    product: osv-scanner', ''].join('\n'),
    POLICY_FILE_NAME
  );
  expect(policy.gates['secrets-history']?.product).toBe('gitleaks');
  expect(policy.gates['secrets-history']?.stage).toBe('ci');
  expect(policy.gates.vulnerabilities?.product).toBe('osv-scanner');
});

it('still rejects a product in the wrong role for the new roles', () => {
  expect(() =>
    parsePolicy(['version: 1', 'gates:', '  secrets-history:', '    product: vault-guard', ''].join('\n'), POLICY_FILE_NAME)
  ).toThrow(/secrets-history/);
});
```

Import `PRODUCT_FOR_ROLE` and `DEFAULT_STAGE_FOR_ROLE` if the test file does not already.

In the reserved-flag drift guard (lines 288-371), extend `RESERVED_WITHOUT_WRITING` with `gitleaks: []` and `'osv-scanner': []` (the umbrella writes every reserved flag for them; Task 4 makes that true).

In `tests/products.test.ts` add:

```ts
it('marks the two external tools as not managed, with their own output, exit and config rules', () => {
  const g = profileFor('gitleaks');
  expect(g.managed).toBe(false);
  expect(g.versionProbe).toEqual({ argv: ['version'], pattern: /(\d+\.\d+\.\d+)/ });
  expect(g.output).toEqual({ kind: 'report-file', flag: '--report-path', extension: '.json' });
  expect(g.exit).toEqual({ clean: [0], blocked: [3], nothingToScan: [] });
  expect(g.timeoutMs).toBe(600_000);
  expect(g.minVersion).toBe('8.19.0');
  expect(g.configFile).toBe('.gitleaks.toml');
  expect(g.neutralConfig).toBe('[extend]\nuseDefault = true\n');
  expect(g.remedy(true)).toMatch(/install gitleaks/i);
  expect(g.remedy(true)).not.toContain('npm install');

  const o = profileFor('osv-scanner');
  expect(o.managed).toBe(false);
  expect(o.versionProbe).toEqual({ argv: ['--version'], pattern: /(\d+\.\d+\.\d+)/ });
  expect(o.output).toEqual({ kind: 'stdout' });
  expect(o.exit).toEqual({ clean: [0], blocked: [1], nothingToScan: [128] });
  expect(o.timeoutMs).toBe(300_000);
  expect(o.minVersion).toBe('2.0.0');
  expect(o.configFile).toBe('osv-scanner.toml');
  expect(o.neutralConfig).toBe('');
  expect(o.remedy(false)).toMatch(/install osv-scanner/i);
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `pnpm --dir <worktree> test -- tests/policy.test.ts tests/products.test.ts 2>&1 | tail -30`
Expected: FAIL on the role list, the unknown role, and the missing profiles (TypeScript will also fail to compile `PROFILES` once `PRODUCTS` grows; that is the next step).

- [x] **Step 3: Extend the policy model**

`src/policy.ts`:

```ts
export const GATE_ROLES = ['dependencies', 'secrets', 'intent', 'secrets-history', 'vulnerabilities'] as const;
export const PRODUCTS = ['dep-guard', 'vault-guard', 'intent-guard', 'gitleaks', 'osv-scanner'] as const;
```

`DEFAULT_STAGE_FOR_ROLE`: add `'secrets-history': 'ci'` and `vulnerabilities: 'ci'` with a comment: a history scan and a registry lookup are pull-request work, not commit-time work.

`PRODUCT_FOR_ROLE`: add `'secrets-history': 'gitleaks'` and `vulnerabilities: 'osv-scanner'`.

`RESERVED_OPTIONS`: add

```ts
// The umbrella writes every one of these for gitleaks: the report goes to a
// file it owns, the exit code for a leak is moved off 1 so an error and a
// leak stop sharing a number, history is scoped by --log-opts so one
// branch's secret cannot redden every other pull request, and the config
// is read from the base ref on a pull request.
gitleaks: ['report-format', 'report-path', 'exit-code', 'log-opts', 'config', 'redact', 'no-banner'],
// osv-scanner: the umbrella owns the format (json to stdout), the config on
// a pull-request run, and the scan root.
'osv-scanner': ['format', 'config', 'recursive'],
```

`reservedReason`: add a branch per product returning a sentence per key in the same voice as the existing branches (read lines 239-278 first and match the style). Every key above must have a reason; the test at :360 requires it.

Update the module comment at `src/policy.ts:3-27` ("Two of the three products", "three CLIs") to say five products, two of them external.

`schema/guardrails.schema.json`: add `secrets-history` and `vulnerabilities` under `gates.properties` with the same `$ref` as the existing three; add `"gitleaks"` and `"osv-scanner"` to `$defs.gate.product.enum`; update any description string that says "the three products".

`src/init-policy.ts` `ROLE_DESCRIPTION`: add
```ts
'secrets-history': 'credentials anywhere in git history, by gitleaks (installed by you, not by conductor)',
vulnerabilities: 'known vulnerabilities in the resolved dependency tree, by osv-scanner (installed by you, not by conductor)',
```

`src/products.ts`: add the two profiles exactly as the test pins them:

```ts
gitleaks: {
  product: 'gitleaks', managed: false,
  versionProbe: { argv: ['version'], pattern: /(\d+\.\d+\.\d+)/ },
  output: { kind: 'report-file', flag: '--report-path', extension: '.json' },
  exit: { clean: [0], blocked: [3], nothingToScan: [] },
  timeoutMs: 600_000, minVersion: '8.19.0',
  configFile: '.gitleaks.toml', neutralConfig: '[extend]\nuseDefault = true\n',
  remedy: () => 'Install gitleaks 8.19 or later on the machine or runner before conductor runs (a pinned release download with a checksum is the usual step), or disable the secrets-history gate in .guardrails.yaml. conductor does not download it.',
},
'osv-scanner': {
  product: 'osv-scanner', managed: false,
  versionProbe: { argv: ['--version'], pattern: /(\d+\.\d+\.\d+)/ },
  output: { kind: 'stdout' },
  exit: { clean: [0], blocked: [1], nothingToScan: [128] },
  timeoutMs: 300_000, minVersion: '2.0.0',
  configFile: 'osv-scanner.toml', neutralConfig: '',
  remedy: () => 'Install osv-scanner 2.x on the machine or runner before conductor runs, or disable the vulnerabilities gate in .guardrails.yaml. conductor does not download it.',
},
```

- [x] **Step 4: Fix every exhaustive switch the compiler now flags**

Run `pnpm --dir <worktree> typecheck 2>&1 | tail -30`. Expected errors: `gateArgs` (gate-runner.ts:423), `normalizeFor` (gate-runner.ts:533), `CANDIDATES` (resolve.ts:113), `reservedReason` if written as a Record. For THIS task add only what compiles with today's behaviour: in `gateArgs` and `normalizeFor` add `case 'gitleaks': case 'osv-scanner': throw new Error('external gates are wired in a later task');` (Tasks 4 and 6 replace these). In `CANDIDATES` add:

```ts
gitleaks: [{ name: 'gitleaks', prefix: ['git'], versionSafe: true }],
'osv-scanner': [{ name: 'osv-scanner', prefix: ['scan', 'source'], versionSafe: true }],
```

Note for `versionSafe`: gitleaks `version` and osv-scanner `--version` both print and exit without scanning; the implementer confirms this in Task 6 against the real binaries and records it in `tests/fixtures/README.md`.

- [x] **Step 5: Run the tests**

Run: `pnpm --dir <worktree> test -- tests/policy.test.ts tests/products.test.ts tests/resolve.test.ts tests/init.test.ts 2>&1 | tail -30`
Expected: policy and products PASS. `tests/resolve.test.ts:231-243` ("has exactly one candidate for the two gates that were never renamed") may still pass; if a test asserts the candidate table has exactly three keys, extend it to five with the two new single-candidate entries. `tests/init.test.ts`: the rendered policy now has two more roles; update the expected rendering to include them as "not found" lines when the test environment has no gitleaks or osv-scanner on PATH, and add one case with a stubbed `gitleaks` on PATH showing the role rendered as found.

- [x] **Step 6: Commit**

```
git -C <worktree> add src/policy.ts src/products.ts src/init-policy.ts src/resolve.ts src/gate-runner.ts schema/guardrails.schema.json tests/policy.test.ts tests/products.test.ts tests/resolve.test.ts tests/init.test.ts
git -C <worktree> commit -m "Add the secrets-history and vulnerabilities roles for gitleaks and osv-scanner to the policy model"
```

### Task 3: Stub binaries and captured fixtures for both tools

**Files:**
- Modify: `tests/helpers/stub-gate.ts`
- Create: `tests/fixtures/gitleaks-<ver>-history-blocking.json`, `tests/fixtures/gitleaks-<ver>-history-clean.json`, `tests/fixtures/osv-scanner-<ver>-blocking.json`, `tests/fixtures/osv-scanner-<ver>-clean.json`
- Modify: `tests/fixtures/README.md`
- Test: `tests/stub-gate.test.ts` (new, small)

**Interfaces:**
- Produces:
  ```ts
  export interface StubOptions { stdout?: string; stderr?: string; exit?: number; argvLog?: string; version?: string;
    /** Answer `<name> version` (a subcommand) as well as --version. */ versionSubcommand?: boolean;
    /** Print this line for the version probe instead of the bare version. */ versionLine?: string;
    /** When the argv contains this flag, write `reportBody` to the path that follows it. */ reportFlag?: string; reportBody?: string; }
  export const CLEAN_GITLEAKS: string;      // '[]'
  export const CLEAN_OSV_SCANNER: string;   // '{"results":[]}'
  ```
- Consumes: nothing new.

- [x] **Step 1: Obtain both real binaries into the worktree, not the system**

Download the pinned releases into `<worktree>/.local/bin` (gitignored). Use WebFetch on `https://api.github.com/repos/gitleaks/gitleaks/releases/latest` and `https://api.github.com/repos/google/osv-scanner/releases/latest` for the tag, then `curl -sSL` the darwin arm64 (or the host's) asset and its checksum file into that directory, verify with `shasum -a 256 -c`, `chmod +x`. Record the exact versions; they become `<ver>` in the fixture names. If a download is refused by the harness, stop and report; do not install with a package manager.

- [x] **Step 2: Capture gitleaks fixtures from a throwaway git repo**

In the scratchpad create a git repo with two commits: the first adds `config.json` containing a synthetic Doppler-shaped token (the shape the proof repository used, since GitHub push protection is irrelevant here and gitleaks' generic rule catches it); the second removes the file. Run:

```
<bin>/gitleaks git --report-format json --report-path <scratch>/gitleaks-blocking.json --exit-code 3 --redact --no-banner --log-opts HEAD <repo>
```

Record the exit code (expected 3). Copy the report to `tests/fixtures/gitleaks-<ver>-history-blocking.json`. Run the same against a repo with one clean commit; record exit 0 and copy the report (expected `[]`) to `-clean.json`. Run once more against a path that is not a git repo and record the exit code and whether a report file was written; this is the error case Task 5 depends on. Also run `<bin>/gitleaks version` and record the exact stdout line.

- [x] **Step 3: Capture osv-scanner fixtures**

In the scratchpad create a directory with a `package-lock.json` (or `pnpm-lock.yaml`) resolving `nanoid@5.0.9`, which had open advisories on 2026-09-26 (the proof repository hit them). Run:

```
<bin>/osv-scanner scan source --format json --recursive <dir> > <scratch>/osv-blocking.json
```

Record the exit code (expected 1); copy stdout to `tests/fixtures/osv-scanner-<ver>-blocking.json`. Repeat with a lockfile resolving only a clean package (expected 0) into `-clean.json`. Repeat against an empty directory and record the exit code (expected 128) and stdout. Run `<bin>/osv-scanner --version` and record the exact stdout line.

- [x] **Step 4: Record every capture in `tests/fixtures/README.md`**

Add `## gitleaks <ver>` and `## osv-scanner <ver>` sections in the existing style: the command, the input, the exit code observed, the version-probe line observed, and the error-case observations.

- [x] **Step 5: Write the failing stub test**

```ts
// tests/stub-gate.test.ts
import { describe, expect, it } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { stubGate } from './helpers/stub-gate.js';

describe('stubGate for external tools', () => {
  it('answers a version subcommand with a custom line', () => {
    const bin = mkdtempSync(path.join(tmpdir(), 'stub-'));
    const cmd = stubGate(bin, 'gitleaks', { versionSubcommand: true, versionLine: '8.30.1', exit: 0, stdout: '' });
    const out = spawnSync(cmd, ['version'], { encoding: 'utf8' });
    expect(out.stdout.trim()).toBe('8.30.1');
  });

  it('writes the report body to the path after the report flag and exits with the chosen code', () => {
    const bin = mkdtempSync(path.join(tmpdir(), 'stub-'));
    const report = path.join(bin, 'out.json');
    const cmd = stubGate(bin, 'gitleaks', { reportFlag: '--report-path', reportBody: '[{"RuleID":"x"}]', exit: 3, stdout: '' });
    const out = spawnSync(cmd, ['git', '--report-path', report, '.'], { encoding: 'utf8' });
    expect(out.status).toBe(3);
    expect(readFileSync(report, 'utf8')).toBe('[{"RuleID":"x"}]');
  });
});
```

- [x] **Step 6: Run to verify it fails**

Run: `pnpm --dir <worktree> test -- tests/stub-gate.test.ts 2>&1 | tail -20`
Expected: FAIL, the stub prints the default version and ignores the report flag.

- [x] **Step 7: Extend the stub**

In `tests/helpers/stub-gate.ts`, extend `StubOptions` with the four fields above and change the generated sh script:

```sh
#!/bin/sh
if [ "$1" = "--version" ] || { [ "$VERSION_SUBCOMMAND" = "1" ] && [ "$1" = "version" ]; }; then
  echo "$VERSION_LINE"
  exit 0
fi
if [ -n "$REPORT_FLAG" ]; then
  prev=""
  for a in "$@"; do
    if [ "$prev" = "$REPORT_FLAG" ]; then cat "$SELF.report" > "$a"; fi
    prev="$a"
  done
fi
cat "$SELF.stdout"
cat "$SELF.stderr" >&2
exit "$EXIT"
```

Generate the script with the option values substituted as literals (the existing stub already substitutes `exit` and the sibling file paths; follow that mechanism rather than environment variables). Write `reportBody` to a `.report` sibling file. Export `CLEAN_GITLEAKS = '[]'` and `CLEAN_OSV_SCANNER = JSON.stringify({ results: [] })`.

- [x] **Step 8: Run and commit**

Run: `pnpm --dir <worktree> test -- tests/stub-gate.test.ts 2>&1 | tail -10`
Expected: PASS.

```
git -C <worktree> add tests/helpers/stub-gate.ts tests/stub-gate.test.ts tests/fixtures/README.md tests/fixtures/gitleaks-*.json tests/fixtures/osv-scanner-*.json
git -C <worktree> commit -m "Capture gitleaks and osv-scanner fixtures and teach the stub gate a version subcommand and a report file"
```

---

### Task 4: Argument building for the two external gates

**Files:**
- Modify: `src/gate-runner.ts:423-505` (`gateArgs`)
- Test: `tests/policy.test.ts` (the gateArgs block near :372-414)

**Interfaces:**
- Produces: `gateArgs(gate, staged, intent, trustBase?, external?: ExternalArgs): string[]` where
  ```ts
  export interface ExternalArgs { reportPath?: string; configPath?: string; }
  ```
  gitleaks argv (after the `git` prefix from CANDIDATES): `--report-format json --report-path <reportPath> --exit-code 3 --redact --no-banner --log-opts <scope> [--config <configPath>] . ...passthrough` where `<scope>` is `HEAD` with no trust base and `<trustBase>..HEAD` with one.
  osv-scanner argv (after `scan source`): `--format json --recursive [--config <configPath>] . ...passthrough`.
- Consumes: Task 2 roles.

- [x] **Step 1: Write the failing tests**

Add to `tests/policy.test.ts` in the gateArgs block:

```ts
describe('gateArgs for the external gates', () => {
  const gl = { role: 'secrets-history', product: 'gitleaks', enabled: true, stage: 'ci', enforce: true, excludedByCli: false, options: {} } as const;
  const osv = { role: 'vulnerabilities', product: 'osv-scanner', enabled: true, stage: 'ci', enforce: true, excludedByCli: false, options: {} } as const;

  it('scopes gitleaks to HEAD history on a local run and writes the report to the path the runner owns', () => {
    const argv = gateArgs(gl, false, undefined, undefined, { reportPath: '/tmp/r.json' });
    expect(argv).toEqual(['--report-format', 'json', '--report-path', '/tmp/r.json', '--exit-code', '3', '--redact', '--no-banner', '--log-opts', 'HEAD', '.']);
  });

  it('scopes gitleaks to base..HEAD and passes the base-ref config on a pull-request run', () => {
    const argv = gateArgs(gl, false, undefined, 'origin/main', { reportPath: '/tmp/r.json', configPath: '/tmp/c.toml' });
    expect(argv).toContain('--log-opts');
    expect(argv[argv.indexOf('--log-opts') + 1]).toBe('origin/main..HEAD');
    expect(argv[argv.indexOf('--config') + 1]).toBe('/tmp/c.toml');
    expect(argv).not.toContain('--trust-base');
    expect(argv).not.toContain('--staged');
  });

  it('never passes --staged to gitleaks even when the run is staged', () => {
    expect(gateArgs(gl, true, undefined, undefined, { reportPath: '/tmp/r.json' })).not.toContain('--staged');
  });

  it('throws when gitleaks is built without a report path, because its report cannot go to stdout', () => {
    expect(() => gateArgs(gl, false, undefined, undefined, {})).toThrow(/report path/);
  });

  it('asks osv-scanner for json on stdout over the whole tree, with the base-ref config on a pull request', () => {
    expect(gateArgs(osv, false, undefined, undefined, {})).toEqual(['--format', 'json', '--recursive', '.']);
    const pr = gateArgs(osv, false, undefined, 'origin/main', { configPath: '/tmp/o.toml' });
    expect(pr).toEqual(['--format', 'json', '--recursive', '--config', '/tmp/o.toml', '.']);
  });

  it('appends policy options after the umbrella flags and before the scan root', () => {
    const argv = gateArgs({ ...osv, options: { 'call-analysis': true } }, false, undefined, undefined, {});
    const i = argv.indexOf('--call-analysis');
    expect(i).toBeGreaterThan(argv.indexOf('--recursive'));
    expect(argv[argv.length - 1]).toBe('.');
  });
});
```

- [x] **Step 2: Run to verify they fail**

Run: `pnpm --dir <worktree> test -- tests/policy.test.ts 2>&1 | tail -30`
Expected: FAIL, the placeholder `throw` from Task 2 fires.

- [x] **Step 3: Implement the two cases**

In `src/gate-runner.ts`:

```ts
export interface ExternalArgs { reportPath?: string; configPath?: string; }

export function gateArgs(
  gate: GatePolicy, staged: boolean, intent: IntentPreparation | undefined, trustBase?: string, external: ExternalArgs = {}
): string[] {
  const passthrough = renderOptionFlags(gate.options);
  const trust = trustBase === undefined ? [] : ['--trust-base', trustBase];
  const config = external.configPath === undefined ? [] : ['--config', external.configPath];
  switch (gate.product) {
    // existing three cases unchanged
    case 'gitleaks': {
      if (external.reportPath === undefined) {
        throw new Error('gitleaks needs a report path: it cannot write its report to stdout');
      }
      // --exit-code 3 moves the leak code off 1, which gitleaks also uses for
      // errors, so a crash and a leak stop sharing a number. --log-opts is
      // always set: gitleaks' default is git log --all, which on a checkout
      // with fetch-depth 0 scans every branch, so one branch's secret would
      // redden every other pull request. --staged has no meaning here.
      const scope = trustBase === undefined ? 'HEAD' : `${trustBase}..HEAD`;
      return ['--report-format', 'json', '--report-path', external.reportPath, '--exit-code', '3', '--redact', '--no-banner', '--log-opts', scope, ...config, ...passthrough, '.'];
    }
    case 'osv-scanner':
      // json goes to stdout and everything else to stderr, so no report file.
      // The tree is scanned recursively from the repository root; the policy
      // may narrow it through options.
      return ['--format', 'json', '--recursive', ...config, ...passthrough, '.'];
  }
}
```

The `--trust-base` flag is never passed to an external tool; `trustBase` is used only to scope history and select the config, which is what Task 7 materialises.

- [x] **Step 4: Run, then run the reserved-flag drift guard**

Run: `pnpm --dir <worktree> test -- tests/policy.test.ts 2>&1 | tail -20`
Expected: PASS, including "reserves every flag the umbrella writes" for the two new products (the guard calls `gateArgs` with a trust base; make sure the guard passes an `ExternalArgs` with a `reportPath` for gitleaks, or it will hit the throw; adjust the guard's call site to pass `{ reportPath: '/dev/null', configPath: '/dev/null' }` for every product, which the three npm gates ignore).

- [x] **Step 5: Commit**

```
git -C <worktree> add src/gate-runner.ts tests/policy.test.ts
git -C <worktree> commit -m "Build gitleaks and osv-scanner argv: report file, moved leak exit code, scoped history, base-ref config"
```

---

### Task 5: Exit semantics, report file, timeout and version floor through the profile

**Files:**
- Modify: `src/gate-runner.ts:44-71` (`CouldNotRunReason`), `:600-660` (`runGate`, `RunGateOptions`), `:659-900` (`runGateInner`)
- Modify: `src/run.ts:385-512` (pass `tempRoot`)
- Test: `tests/gate-runner.test.ts`

**Interfaces:**
- Produces: `RunGateOptions.tempRoot?: string`; new `CouldNotRunReason` members `'gate-version-unsupported'` and `'report-missing'`; `runGate` classifies the child's exit through `profileFor(product).exit` before parsing; a `nothingToScan` exit yields `couldNotRun: null`, no findings, `exitCode: 0`, and a diagnostic `conductor/nothing-to-scan`.
- Consumes: Tasks 1 to 4.

- [x] **Step 1: Write the failing runner tests**

Add to `tests/gate-runner.test.ts` using the `gate(overrides)` helper and `stubGate`:

```ts
describe('external gate exit semantics', () => {
  const gl = () => gate({ role: 'secrets-history', product: 'gitleaks', stage: 'ci' });
  const osv = () => gate({ role: 'vulnerabilities', product: 'osv-scanner', stage: 'ci' });

  it('reads gitleaks findings from the report file and treats exit 3 as blocked', () => {
    const bin = tempDir();
    stubGate(bin, 'gitleaks', { versionSubcommand: true, versionLine: '8.30.1', reportFlag: '--report-path', reportBody: fixtureText('gitleaks-<ver>-history-blocking.json'), exit: 3, stdout: '' });
    const out = runGate(gl(), { repoRoot: tempGitRepo(), staged: false, pathValue: bin, tempRoot: tempDir() });
    expect(out.couldNotRun).toBeNull();
    expect(out.exitCode).toBe(3);
    expect(out.findings.length).toBeGreaterThan(0);
    expect(out.findings.every((f) => f.blocking)).toBe(true);
    expect(out.productVersion).toBe('8.30.1');
  });

  it('treats gitleaks exit 1 as an error, not a leak', () => {
    const bin = tempDir();
    stubGate(bin, 'gitleaks', { versionSubcommand: true, versionLine: '8.30.1', exit: 1, stdout: '', stderr: 'fatal: not a git repository' });
    const out = runGate(gl(), { repoRoot: tempGitRepo(), staged: false, pathValue: bin, tempRoot: tempDir() });
    expect(out.couldNotRun?.reason).toBe('gate-error');
    expect(out.findings.some((f) => f.ruleId === 'conductor/gate-failed')).toBe(true);
  });

  it('reports report-missing when gitleaks exits clean but wrote no report', () => {
    const bin = tempDir();
    stubGate(bin, 'gitleaks', { versionSubcommand: true, versionLine: '8.30.1', exit: 0, stdout: '' });
    const out = runGate(gl(), { repoRoot: tempGitRepo(), staged: false, pathValue: bin, tempRoot: tempDir() });
    expect(out.couldNotRun?.reason).toBe('report-missing');
  });

  it('treats osv-scanner exit 128 as nothing to scan: clean, with a diagnostic, never could-not-run', () => {
    const bin = tempDir();
    stubGate(bin, 'osv-scanner', { versionLine: 'osv-scanner version: 2.3.5', exit: 128, stdout: '', stderr: 'No package sources found' });
    const out = runGate(osv(), { repoRoot: tempGitRepo(), staged: false, pathValue: bin, tempRoot: tempDir() });
    expect(out.couldNotRun).toBeNull();
    expect(out.exitCode).toBe(0);
    expect(out.findings).toEqual([]);
    expect(out.diagnostics.some((d) => d.code === 'conductor/nothing-to-scan')).toBe(true);
  });

  it('treats osv-scanner exit 127 as an error', () => {
    const bin = tempDir();
    stubGate(bin, 'osv-scanner', { versionLine: 'osv-scanner version: 2.3.5', exit: 127, stdout: '' });
    const out = runGate(osv(), { repoRoot: tempGitRepo(), staged: false, pathValue: bin, tempRoot: tempDir() });
    expect(out.couldNotRun?.reason).toBe('gate-error');
  });

  it('reads the osv-scanner version from its prefixed version line', () => {
    const bin = tempDir();
    stubGate(bin, 'osv-scanner', { versionLine: 'osv-scanner version: 2.3.5', exit: 0, stdout: CLEAN_OSV_SCANNER });
    const out = runGate(osv(), { repoRoot: tempGitRepo(), staged: false, pathValue: bin, tempRoot: tempDir() });
    expect(out.productVersion).toBe('2.3.5');
  });

  it('refuses a gitleaks older than the floor as could-not-run, naming the floor', () => {
    const bin = tempDir();
    stubGate(bin, 'gitleaks', { versionSubcommand: true, versionLine: '8.18.4', exit: 0, stdout: '' });
    const out = runGate(gl(), { repoRoot: tempGitRepo(), staged: false, pathValue: bin, tempRoot: tempDir() });
    expect(out.couldNotRun?.reason).toBe('gate-version-unsupported');
    expect(out.couldNotRun?.detail).toContain('8.19.0');
  });

  it('gives an external gate the profile timeout when the caller sets none', () => {
    const bin = tempDir();
    const log = path.join(bin, 'argv.log');
    stubGate(bin, 'osv-scanner', { versionLine: 'osv-scanner version: 2.3.5', exit: 0, stdout: CLEAN_OSV_SCANNER, argvLog: log });
    const spy = jest.spyOn(childProcess, 'spawnSync');
    runGate(osv(), { repoRoot: tempGitRepo(), staged: false, pathValue: bin, tempRoot: tempDir() });
    const scanCall = spy.mock.calls.find((c) => Array.isArray(c[1]) && (c[1] as string[]).includes('--format'));
    expect((scanCall?.[2] as { timeout?: number }).timeout).toBe(300_000);
    spy.mockRestore();
  });

  it('keeps the npm gates on the old exit reading: exit 2 is gate-error', () => {
    const bin = tempDir();
    stubGate(bin, 'vault-guard', { exit: 2, stdout: '' });
    const out = runGate(gate({ role: 'secrets', product: 'vault-guard' }), { repoRoot: tempGitRepo(), staged: false, pathValue: bin });
    expect(out.couldNotRun?.reason).toBe('gate-error');
  });
});
```

`tempGitRepo()` is a helper that returns a fresh `git init` directory with one commit; if `tests/gate-runner.test.ts` already has one under another name, use it. `fixtureText(name)` reads `tests/fixtures/<name>` as a string. If the module mocks `node:child_process` differently, adapt the spy to the pattern the file already uses for `spawnSync`.

- [x] **Step 2: Run to verify they fail**

Run: `pnpm --dir <worktree> test -- tests/gate-runner.test.ts 2>&1 | tail -40`
Expected: FAIL for every new test.

- [x] **Step 3: Implement in `runGateInner`**

Order inside `runGateInner`, after the binary is resolved and the version probed (around :752) and before the trust-base decision:

```ts
const profile = profileFor(gate.product);
if (profile.minVersion !== null && productVersion !== null && compareVersions(productVersion, profile.minVersion) < 0) {
  return couldNotRun('gate-version-unsupported',
    `${gate.product} ${productVersion} is older than ${profile.minVersion}, the oldest version whose command line this umbrella speaks.`);
}
```

Use the existing semver comparison helper the trust-base floor logic uses (find it near :789; it compares against `TRUST_BASE_MIN_VERSION`). If `productVersion` is null for an external product, fall through: the trust-base logic's `refused` path only applies to products in `TRUST_BASE_MIN_VERSION`; Task 8 puts both there, so a null version becomes `trust-base-unverified` on a pull request and runs unverified locally, matching the npm gates.

Before building argv:

```ts
const external: ExternalArgs = {};
if (profile.output.kind === 'report-file') {
  const root = options.tempRoot ?? mkdtempSync(path.join(tmpdir(), 'conductor-'));
  external.reportPath = path.join(root, `${gate.product}-report${profile.output.extension}`);
}
// external.configPath is set by Task 7.
const argv = [...binary.argvPrefix, ...gateArgs(gate, options.staged, options.intent, effectiveTrustBase, external)];
```

After `spawnSync` (:799-804), replace the fixed `exitCode === null || exitCode > 1` test with:

```ts
if (child.error) { /* unchanged: spawn-failed */ }
const exitCode = child.status;
if (exitCode === null) { /* unchanged: gate-error with the signal in the detail */ }
if (profile.exit.nothingToScan.includes(exitCode)) {
  return finish({ exitCode: 0, couldNotRun: null, findings: [], run: emptyRun(),
    diagnostics: [{ code: 'conductor/nothing-to-scan', message: `${gate.product} found nothing to scan (exit ${exitCode}); treated as clean.` }] });
}
const blocked = profile.exit.blocked.includes(exitCode);
if (!blocked && !profile.exit.clean.includes(exitCode)) {
  return couldNotRun('gate-error', `exit ${exitCode}`, child.stderr);   // existing gate-error path
}
let rawText: string;
if (profile.output.kind === 'report-file') {
  if (!existsSync(external.reportPath!)) {
    return couldNotRun('report-missing', `${gate.product} exited ${exitCode} but wrote no report at ${external.reportPath}.`, child.stderr);
  }
  rawText = readFileSync(external.reportPath!, 'utf8');
} else {
  rawText = child.stdout ?? '';
}
// existing JSON.parse into unparseable-output on throw, then:
const normalized = normalizeFor(gate.product, parsed, productVersion, { blocked });
```

`finish`, `couldNotRun` and `emptyRun` name whatever local helpers `runGateInner` already uses to build a `GateOutcome`; read the function and reuse them rather than adding parallel ones. Add `'gate-version-unsupported' | 'report-missing'` to `CouldNotRunReason` and give each a `conductor/gate-failed` finding through `normalizeFailedGate` like `gate-error` does today. `normalizeFor` gains the fourth parameter; for the three npm gates it is ignored (Task 6 uses it).

Delete the report file after reading it, inside a `try/finally`, unless `options.tempRoot` was supplied (then the caller owns cleanup).

In `src/run.ts` pass `tempRoot: options.tempRoot` into each `runGate` call (search for `runGate(` in run.ts).

- [x] **Step 4: Run the runner tests and the whole suite**

Run: `pnpm --dir <worktree> test -- tests/gate-runner.test.ts 2>&1 | tail -30` then `pnpm --dir <worktree> test 2>&1 | tail -8`
Expected: PASS. The npm-gate exit-2 test proves the old reading survived.

- [x] **Step 5: Mutation check**

Change `profile.exit.blocked.includes(exitCode)` to `exitCode === 1` and run the runner tests: the gitleaks exit-3 test must go RED. Restore. Change the `nothingToScan` branch to fall through and run: the osv exit-128 test must go RED. Restore. Record both in the commit message.

- [x] **Step 6: Commit**

```
git -C <worktree> add src/gate-runner.ts src/run.ts tests/gate-runner.test.ts
git -C <worktree> commit -m "Classify external gate exits, read report files, apply profile timeouts and version floors (mutation: exit-3 and exit-128 tests go red when the profile is bypassed)"
```

### Task 6: Normalise gitleaks output

**Files:**
- Modify: `src/normalize.ts` (new `normalizeGitleaks`), `src/gate-runner.ts:533-542` (`normalizeFor`)
- Test: `tests/normalize.test.ts`

**Interfaces:**
- Produces: `export function normalizeGitleaks(raw: unknown, version: string | null, blocked: boolean): NormalizedGateOutput` and `normalizeFor(product, raw, version, context: { blocked: boolean })`.
- Consumes: gitleaks report fields `RuleID, Description, File, StartLine, StartColumn, EndColumn, Commit, Author, Email, Date, Fingerprint, Entropy, Tags` (per the gitleaks README; verify against the captured fixture before writing assertions, and if a field name differs in the capture, the capture wins).

- [x] **Step 1: Write the failing tests**

```ts
// tests/normalize.test.ts, new describe in the existing per-product style
describe('gitleaks <ver> normalization', () => {
  const blocking = fixture('gitleaks-<ver>-history-blocking.json');
  const clean = fixture('gitleaks-<ver>-history-clean.json');

  it('turns each report entry into a high, blocking finding at the leaked line with the rule as the id', () => {
    const out = normalizeGitleaks(blocking, '8.30.1', true);
    expect(out.findings.length).toBe((blocking as unknown[]).length);
    const f = out.findings[0]!;
    expect(f.product).toBe('gitleaks');
    expect(f.productVersion).toBe('8.30.1');
    expect(f.ruleId).toMatch(/^gitleaks\//);
    expect(f.severity).toBe('high');
    expect(f.severityIsDerived).toBe(true);
    expect(f.blocking).toBe(true);
    expect(f.subject.kind).toBe('location');
    if (f.subject.kind === 'location') {
      expect(f.subject.file).toBe((blocking as Array<{ File: string }>)[0]!.File);
      expect(f.subject.line).toBe((blocking as Array<{ StartLine: number }>)[0]!.StartLine);
    }
    expect(f.fingerprint?.stability).toBe('stable');
    expect(f.details.commit).toBe((blocking as Array<{ Commit: string }>)[0]!.Commit);
    expect(JSON.stringify(f)).not.toContain((blocking as Array<{ Secret: string }>)[0]!.Secret.slice(0, 8));
  });

  it('marks findings non-blocking when the exit code did not say blocked', () => {
    expect(normalizeGitleaks(blocking, '8.30.1', false).findings.every((f) => !f.blocking)).toBe(true);
  });

  it('returns no findings for an empty report', () => {
    expect(normalizeGitleaks(clean, '8.30.1', false).findings).toEqual([]);
  });

  it('rejects a report that is not an array', () => {
    expect(() => normalizeGitleaks({ findings: [] }, '8.30.1', false)).toThrow(NormalizeError);
  });

  it('rejects an entry without a RuleID or a File', () => {
    expect(() => normalizeGitleaks([{ File: 'a' }], '8.30.1', false)).toThrow(NormalizeError);
  });
});
```

The `Secret` assertion holds only when the fixture was captured with `--redact` (Task 3 did); the redacted value is `REDACTED`, so assert the original planted token prefix is absent instead: keep the planted token in `tests/fixtures/README.md` and assert its first 8 characters never appear in any finding.

- [x] **Step 2: Run to verify they fail**

Run: `pnpm --dir <worktree> test -- tests/normalize.test.ts 2>&1 | tail -20`
Expected: FAIL, `normalizeGitleaks` is not exported.

- [x] **Step 3: Implement**

```ts
// src/normalize.ts
export function normalizeGitleaks(raw: unknown, version: string | null, blocked: boolean): NormalizedGateOutput {
  const entries = needArray(raw, 'gitleaks report');
  const diagnostics: Diagnostic[] = [];
  const findings: Finding[] = entries.map((entry, index) => {
    const e = needRecord(entry, `gitleaks report[${index}]`);
    const ruleId = needString(e.RuleID, `report[${index}].RuleID`);
    const file = needString(e.File, `report[${index}].File`);
    const line = needNumber(e.StartLine, `report[${index}].StartLine`);
    const column = typeof e.StartColumn === 'number' ? e.StartColumn : 1;
    const endColumn = typeof e.EndColumn === 'number' ? e.EndColumn : undefined;
    const commit = optionalString(e.Commit);
    const fingerprintValue = optionalString(e.Fingerprint) ?? `${commit ?? ''}:${file}:${ruleId}:${line}`;
    return {
      schemaVersion: 1,
      product: 'gitleaks',
      productVersion: version,
      ruleId: `gitleaks/${ruleId}`,
      severity: 'high',
      severityIsDerived: true,
      blocking: blocked,
      message: optionalString(e.Description) ?? `${ruleId} matched`,
      subject: { kind: 'location', file, line, column, ...(endColumn === undefined ? {} : { endColumn }) },
      fingerprint: { value: fingerprintValue, scope: 'gitleaks', stability: 'stable' },
      details: {
        ...(commit === undefined ? {} : { commit }),
        ...(optionalString(e.Author) === undefined ? {} : { author: optionalString(e.Author) }),
        ...(optionalString(e.Date) === undefined ? {} : { date: optionalString(e.Date) }),
        ...(typeof e.Entropy === 'number' ? { entropy: e.Entropy } : {}),
        ...(Array.isArray(e.Tags) ? { tags: e.Tags } : {}),
      },
    };
  });
  return {
    findings,
    run: { failOn: 'any', suppressed: 0, ignored: 0, diagnostics: [], details: { entries: entries.length } },
    diagnostics,
  };
}
```

Never copy `Secret`, `Match` or `Line` into a finding; the report may be unredacted if a policy option removed `--redact`, and the umbrella's report is posted to a pull request. gitleaks' `Fingerprint` field is already `commit:file:rule:line`, so stability is `stable` across runs.

In `src/gate-runner.ts` `normalizeFor`:

```ts
function normalizeFor(product: Product, raw: unknown, version: string | null, context: { blocked: boolean }): NormalizedGateOutput {
  switch (product) {
    case 'dep-guard': return normalizeDepGuard(raw, version);
    case 'vault-guard': return normalizeVaultGuard(raw, version);
    case 'intent-guard': return normalizeIntentGuard(raw, version);
    case 'gitleaks': return normalizeGitleaks(raw, version, context.blocked);
    case 'osv-scanner': return normalizeOsvScanner(raw, version, context.blocked);   // Task 7
  }
}
```

Until Task 7 lands, keep the `osv-scanner` case as the Task 2 throw so the file compiles.

- [x] **Step 4: Run and commit**

Run: `pnpm --dir <worktree> test -- tests/normalize.test.ts tests/gate-runner.test.ts 2>&1 | tail -20`
Expected: PASS.

```
git -C <worktree> add src/normalize.ts src/gate-runner.ts tests/normalize.test.ts
git -C <worktree> commit -m "Normalize gitleaks history reports into location findings, never carrying the secret"
```

---

### Task 7: Normalise osv-scanner output

**Files:**
- Modify: `src/normalize.ts` (new `normalizeOsvScanner`, `cvssToSeverity`), `src/gate-runner.ts` (`normalizeFor` case)
- Test: `tests/normalize.test.ts`

**Interfaces:**
- Produces: `export function normalizeOsvScanner(raw: unknown, version: string | null, blocked: boolean): NormalizedGateOutput`, `export function cvssToSeverity(score: number | null): Severity`.
- Consumes: osv-scanner JSON `results[].source.{path,type}`, `results[].packages[].package.{name,version,ecosystem}`, `packages[].vulnerabilities[].{id,aliases,summary,severity,affected,database_specific}`, `packages[].groups[].{ids,aliases,max_severity}` (verify every name against the captured fixture; the capture wins).

- [x] **Step 1: Write the failing tests**

```ts
describe('osv-scanner <ver> normalization', () => {
  const blocking = fixture('osv-scanner-<ver>-blocking.json');
  const clean = fixture('osv-scanner-<ver>-clean.json');

  it('emits one finding per vulnerability id on a package, keyed by the OSV id', () => {
    const out = normalizeOsvScanner(blocking, '2.3.5', true);
    const raw = blocking as { results: Array<{ source: { path: string }; packages: Array<{ package: { name: string; version: string }; vulnerabilities: Array<{ id: string }> }> }> };
    const expectedCount = raw.results.flatMap((r) => r.packages.flatMap((p) => p.vulnerabilities)).length;
    expect(out.findings.length).toBe(expectedCount);
    const first = out.findings[0]!;
    const rawFirst = raw.results[0]!.packages[0]!;
    expect(first.product).toBe('osv-scanner');
    expect(first.ruleId).toBe(`osv-scanner/${rawFirst.vulnerabilities[0]!.id}`);
    expect(first.subject).toEqual({ kind: 'package', name: rawFirst.package.name, manifest: raw.results[0]!.source.path });
    expect(first.blocking).toBe(true);
    expect(first.severityIsDerived).toBe(true);
    expect(['critical', 'high', 'medium', 'low']).toContain(first.severity);
    expect(first.fingerprint?.stability).toBe('stable');
    expect(first.details.version).toBe(rawFirst.package.version);
  });

  it('carries aliases and the fixed version when the advisory names one', () => {
    const out = normalizeOsvScanner(blocking, '2.3.5', true);
    const withFix = out.findings.find((f) => f.details.fixedVersion !== undefined);
    expect(withFix).toBeDefined();
    expect(Array.isArray(out.findings[0]!.details.aliases)).toBe(true);
  });

  it('gives no findings for an empty results array', () => {
    expect(normalizeOsvScanner(clean, '2.3.5', false).findings).toEqual([]);
  });

  it('rejects output without a results array', () => {
    expect(() => normalizeOsvScanner({ packages: [] }, '2.3.5', false)).toThrow(NormalizeError);
  });

  it('maps CVSS scores onto the shared ladder', () => {
    expect(cvssToSeverity(9.8)).toBe('critical');
    expect(cvssToSeverity(7.5)).toBe('high');
    expect(cvssToSeverity(5.0)).toBe('medium');
    expect(cvssToSeverity(2.1)).toBe('low');
    expect(cvssToSeverity(null)).toBe('medium');
  });
});
```

If the captured blocking fixture has no vulnerability with a `fixed` event, drop the `withFix` assertion and record that in the fixture README; do not hand-edit the fixture.

- [x] **Step 2: Run to verify they fail**

Run: `pnpm --dir <worktree> test -- tests/normalize.test.ts 2>&1 | tail -20`
Expected: FAIL, not exported.

- [x] **Step 3: Implement**

```ts
export function cvssToSeverity(score: number | null): Severity {
  if (score === null || Number.isNaN(score)) return 'medium';
  if (score >= 9) return 'critical';
  if (score >= 7) return 'high';
  if (score >= 4) return 'medium';
  return 'low';
}

function osvScore(vuln: Record<string, unknown>, groups: Array<Record<string, unknown>>): number | null {
  const id = typeof vuln.id === 'string' ? vuln.id : '';
  for (const g of groups) {
    const ids = Array.isArray(g.ids) ? (g.ids as unknown[]) : [];
    if (ids.includes(id) && typeof g.max_severity === 'string' && g.max_severity !== '') {
      const n = Number(g.max_severity);
      if (!Number.isNaN(n)) return n;
    }
  }
  const ds = vuln.database_specific;
  if (ds && typeof ds === 'object' && typeof (ds as Record<string, unknown>).severity === 'string') {
    const word = ((ds as Record<string, unknown>).severity as string).toUpperCase();
    if (word === 'CRITICAL') return 9.5;
    if (word === 'HIGH') return 7.5;
    if (word === 'MODERATE' || word === 'MEDIUM') return 5;
    if (word === 'LOW') return 2;
  }
  return null;
}

function osvFixedVersion(vuln: Record<string, unknown>, pkgName: string): string | undefined {
  const affected = Array.isArray(vuln.affected) ? (vuln.affected as Array<Record<string, unknown>>) : [];
  for (const a of affected) {
    const p = a.package as Record<string, unknown> | undefined;
    if (p && p.name !== pkgName) continue;
    const ranges = Array.isArray(a.ranges) ? (a.ranges as Array<Record<string, unknown>>) : [];
    for (const r of ranges) {
      const events = Array.isArray(r.events) ? (r.events as Array<Record<string, unknown>>) : [];
      for (const ev of events) {
        if (typeof ev.fixed === 'string') return ev.fixed;
      }
    }
  }
  return undefined;
}

export function normalizeOsvScanner(raw: unknown, version: string | null, blocked: boolean): NormalizedGateOutput {
  const top = needRecord(raw, 'osv-scanner output');
  const results = needArray(top.results, 'osv-scanner output.results');
  const findings: Finding[] = [];
  results.forEach((result, ri) => {
    const r = needRecord(result, `results[${ri}]`);
    const source = needRecord(r.source, `results[${ri}].source`);
    const manifest = needString(source.path, `results[${ri}].source.path`);
    const packages = needArray(r.packages, `results[${ri}].packages`);
    packages.forEach((pkgEntry, pi) => {
      const p = needRecord(pkgEntry, `results[${ri}].packages[${pi}]`);
      const pkg = needRecord(p.package, `results[${ri}].packages[${pi}].package`);
      const name = needString(pkg.name, `packages[${pi}].package.name`);
      const pkgVersion = optionalString(pkg.version) ?? '';
      const ecosystem = optionalString(pkg.ecosystem);
      const groups = Array.isArray(p.groups) ? (p.groups as Array<Record<string, unknown>>) : [];
      const vulns = Array.isArray(p.vulnerabilities) ? (p.vulnerabilities as unknown[]) : [];
      vulns.forEach((vEntry, vi) => {
        const v = needRecord(vEntry, `packages[${pi}].vulnerabilities[${vi}]`);
        const id = needString(v.id, `vulnerabilities[${vi}].id`);
        const score = osvScore(v, groups);
        const fixedVersion = osvFixedVersion(v, name);
        findings.push({
          schemaVersion: 1,
          product: 'osv-scanner',
          productVersion: version,
          ruleId: `osv-scanner/${id}`,
          severity: cvssToSeverity(score),
          severityIsDerived: true,
          blocking: blocked,
          message: optionalString(v.summary) ?? `${id} affects ${name}@${pkgVersion}`,
          subject: { kind: 'package', name, manifest },
          fingerprint: { value: `${id}|${name}|${pkgVersion}|${manifest}`, scope: 'osv-scanner', stability: 'stable' },
          details: {
            version: pkgVersion,
            ...(ecosystem === undefined ? {} : { ecosystem }),
            aliases: Array.isArray(v.aliases) ? v.aliases : [],
            ...(score === null ? {} : { cvss: score }),
            ...(fixedVersion === undefined ? {} : { fixedVersion }),
          },
        });
      });
    });
  });
  return {
    findings,
    run: { failOn: 'any', suppressed: 0, ignored: 0, diagnostics: [], details: { sources: results.length } },
    diagnostics: [],
  };
}
```

Wire the `osv-scanner` case in `normalizeFor` (replacing the Task 2 throw).

- [x] **Step 4: Run and commit**

Run: `pnpm --dir <worktree> test -- tests/normalize.test.ts tests/gate-runner.test.ts 2>&1 | tail -20`
Expected: PASS.

```
git -C <worktree> add src/normalize.ts src/gate-runner.ts tests/normalize.test.ts
git -C <worktree> commit -m "Normalize osv-scanner results into package findings with CVSS-derived severity and fixed versions"
```

---

### Task 8: Config from the base ref on a pull request, and the trust-base table

**Files:**
- Create: `src/external-config.ts`
- Modify: `src/gate-runner.ts:96-104` (`TRUST_BASE_MIN_VERSION`), `runGateInner` (set `external.configPath`, add proposals)
- Test: `tests/external-config.test.ts` (new), `tests/gate-runner.test.ts:261+` (decideTrustBase)

**Interfaces:**
- Produces:
  ```ts
  export interface MaterializedConfig { path: string; proposal: string | null; source: 'base' | 'neutral'; }
  export function materializeExternalConfig(args: { repoRoot: string; trustBase: string; profile: ProductProfile; tempRoot: string }): MaterializedConfig | null;
  ```
  Returns null when the profile has no `configFile`. Otherwise reads `<configFile>` from the trust base with `git show <trustBase>:<configFile>`; if present writes it to `<tempRoot>/<product>-config<ext>` and returns `source: 'base'`; if absent writes `profile.neutralConfig` and returns `source: 'neutral'`. In both cases compares with the head's `<repoRoot>/<configFile>` (if any) and sets `proposal` to `"<configFile> differs from the base ref; the base's copy was used and this change takes effect after merge"` when they differ or when the head has one and the base does not.
- Consumes: Task 1 profiles.

- [x] **Step 1: Write the failing tests**

```ts
// tests/external-config.test.ts
describe('materializeExternalConfig', () => {
  it('returns null for a product with no config file', () => {
    expect(materializeExternalConfig({ repoRoot: tempGitRepo(), trustBase: 'HEAD', profile: profileFor('dep-guard'), tempRoot: tempDir() })).toBeNull();
  });

  it('uses the base copy when the base has one, and reports a head-side difference as a proposal', () => {
    const repo = tempGitRepo();                       // one commit on main
    writeFileSync(path.join(repo, '.gitleaks.toml'), '[allowlist]\npaths = ["docs/"]\n');
    git(repo, 'add', '.gitleaks.toml'); git(repo, 'commit', '-m', 'base config');
    git(repo, 'checkout', '-b', 'pr');
    writeFileSync(path.join(repo, '.gitleaks.toml'), '[allowlist]\npaths = ["docs/", "src/"]\n');
    const out = materializeExternalConfig({ repoRoot: repo, trustBase: 'main', profile: profileFor('gitleaks'), tempRoot: tempDir() })!;
    expect(out.source).toBe('base');
    expect(readFileSync(out.path, 'utf8')).toBe('[allowlist]\npaths = ["docs/"]\n');
    expect(out.proposal).toMatch(/\.gitleaks\.toml differs/);
  });

  it('uses the neutral config when the base has none, so a head-side file cannot be auto-loaded', () => {
    const repo = tempGitRepo();
    git(repo, 'checkout', '-b', 'pr');
    writeFileSync(path.join(repo, '.gitleaks.toml'), '[allowlist]\npaths = ["src/"]\n');
    const out = materializeExternalConfig({ repoRoot: repo, trustBase: 'main', profile: profileFor('gitleaks'), tempRoot: tempDir() })!;
    expect(out.source).toBe('neutral');
    expect(readFileSync(out.path, 'utf8')).toBe('[extend]\nuseDefault = true\n');
    expect(out.proposal).toMatch(/\.gitleaks\.toml/);
  });

  it('has no proposal when base and head agree', () => {
    const repo = tempGitRepo();
    writeFileSync(path.join(repo, 'osv-scanner.toml'), '');
    git(repo, 'add', 'osv-scanner.toml'); git(repo, 'commit', '-m', 'cfg');
    const out = materializeExternalConfig({ repoRoot: repo, trustBase: 'HEAD', profile: profileFor('osv-scanner'), tempRoot: tempDir() })!;
    expect(out.proposal).toBeNull();
  });
});
```

`git(repo, ...args)` is `spawnSync('git', args, { cwd: repo })` with a throw on nonzero; `tempGitRepo()` creates a repo whose default branch is `main` (`git init -b main`) with one commit. Reuse helpers from `tests/gate-runner.test.ts` if they exist.

Add to the `decideTrustBase` describe in `tests/gate-runner.test.ts`:

```ts
it('puts both external products in pull-request mode at their floors instead of withholding', () => {
  const gl = gate({ role: 'secrets-history', product: 'gitleaks' });
  expect(decideTrustBase(gl, undefined, 'origin/main', '8.30.1')?.withheld).toBeNull();
  expect(decideTrustBase(gl, undefined, 'origin/main', '8.18.4')?.withheld).toMatch(/8\.19\.0/);
  const osv = gate({ role: 'vulnerabilities', product: 'osv-scanner' });
  expect(decideTrustBase(osv, undefined, 'origin/main', '2.3.5')?.withheld).toBeNull();
  expect(decideTrustBase(osv, undefined, 'origin/main', null)?.refused).not.toBeNull();
});
```

- [x] **Step 2: Run to verify they fail**

Run: `pnpm --dir <worktree> test -- tests/external-config.test.ts tests/gate-runner.test.ts 2>&1 | tail -30`
Expected: FAIL.

- [x] **Step 3: Implement**

```ts
// src/external-config.ts
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ProductProfile } from './products.js';

export interface MaterializedConfig { path: string; proposal: string | null; source: 'base' | 'neutral'; }

function showAtRef(repoRoot: string, ref: string, file: string): string | null {
  const child = spawnSync('git', ['show', `${ref}:${file}`], { cwd: repoRoot, encoding: 'utf8' });
  return child.status === 0 ? child.stdout : null;
}

export function materializeExternalConfig(args: { repoRoot: string; trustBase: string; profile: ProductProfile; tempRoot: string }): MaterializedConfig | null {
  const { repoRoot, trustBase, profile, tempRoot } = args;
  if (profile.configFile === null) return null;
  const base = showAtRef(repoRoot, trustBase, profile.configFile);
  const headPath = path.join(repoRoot, profile.configFile);
  const head = existsSync(headPath) ? readFileSync(headPath, 'utf8') : null;
  const body = base ?? profile.neutralConfig ?? '';
  const ext = path.extname(profile.configFile) || '.toml';
  const out = path.join(tempRoot, `${profile.product}-config${ext}`);
  writeFileSync(out, body);
  let proposal: string | null = null;
  if (head !== null && head !== base) {
    proposal = `${profile.configFile} differs from the base ref; the base's copy was used and this change takes effect after merge.`;
  }
  return { path: out, proposal, source: base === null ? 'neutral' : 'base' };
}
```

In `src/gate-runner.ts`:
- `TRUST_BASE_MIN_VERSION`: add `gitleaks: '8.19.0'` and `'osv-scanner': '2.0.0'`, with a comment that for these two the umbrella itself provides pull-request mode by materialising the config from the base ref, so the floor is the command-line floor, not a flag floor.
- In `runGateInner`, when the trust base is decided and not withheld and the profile has a `configFile`, call `materializeExternalConfig` with `options.tempRoot ?? <the mkdtemp from Task 5>` and set `external.configPath = result.path`; push `result.proposal` (when not null) into the outcome's `trustBase.proposals` exactly where the policy proposal is pushed for the npm gates (read how `proposals` reaches `GateOutcome.trustBase` and reuse it).
- `TRUST_BASE_MIN_VERSION` is `Partial<Record<Product, string>>`, so the `decideTrustBase` "no pull-request mode yet" branch (:190-196) is no longer taken for these products.

- [x] **Step 4: Run, mutate, commit**

Run the two test files, then the full suite. Mutation: in `materializeExternalConfig` return the head's file when the base has none; the neutral-config test must go RED. Restore.

```
git -C <worktree> add src/external-config.ts src/gate-runner.ts tests/external-config.test.ts tests/gate-runner.test.ts
git -C <worktree> commit -m "Read gitleaks and osv-scanner config from the base ref on a pull request, neutral when absent, head-side changes as proposals"
```

---

### Task 9: Renderers, exit aggregation and end to end with stubs

**Files:**
- Modify: `tests/output-sarif.test.ts:553-570`, `tests/output-text.test.ts`, `tests/run.test.ts:29-41`, `tests/dogfood.e2e.test.ts:982`
- Modify (only if a test shows a gap): `src/output-text.ts:31-68`, `src/output-sarif.ts`

**Interfaces:**
- Consumes: everything above. Produces no new API.

- [ ] **Step 1: Write the failing tests**

`tests/output-sarif.test.ts`: extend "emits one run per gate, in gate order" with a five-gate result whose drivers are `['dep-guard', 'vault-guard', 'intent-guard', 'gitleaks', 'osv-scanner']`, and add:

```ts
it('places a gitleaks finding at its file and line and an osv-scanner finding on its manifest', () => {
  const result = fiveGateResult();   // build with normalizeGitleaks/normalizeOsvScanner over the fixtures
  const sarif = JSON.parse(renderSarif(result, '0.5.0'));
  const gl = sarif.runs.find((r: { tool: { driver: { name: string } } }) => r.tool.driver.name === 'gitleaks');
  expect(gl.results[0].locations[0].physicalLocation.region.startLine).toBeGreaterThan(0);
  const osv = sarif.runs.find((r: { tool: { driver: { name: string } } }) => r.tool.driver.name === 'osv-scanner');
  expect(osv.results[0].locations[0].physicalLocation.artifactLocation.uri).toMatch(/lock/);
  expect(osv.tool.driver.rules[0].id).not.toContain('osv-scanner/');
});
```

`tests/output-text.test.ts`: add a test that the text report for a five-gate run has a header line per gate containing `gitleaks 8.30.1` and `osv-scanner 2.3.5`, that a gitleaks finding line names `file:line` and never the secret, and that an osv-scanner finding line names the package and the OSV id.

`tests/run.test.ts`: add `ALL_FIVE` beside `ALL_THREE` and:

```ts
it('exits 1 when only an external gate blocks, and 2 when an external binary is missing', () => {
  const bin = tempDir();
  stubGate(bin, 'dep-guard', { stdout: CLEAN_DEP_GUARD, exit: 0 });
  stubGate(bin, 'vault-guard', { stdout: CLEAN_VAULT_GUARD, exit: 0 });
  stubGate(bin, 'intent-guard', { stdout: CLEAN_INTENT_GUARD, exit: 0 });
  stubGate(bin, 'osv-scanner', { versionLine: 'osv-scanner version: 2.3.5', stdout: CLEAN_OSV_SCANNER, exit: 0 });
  stubGate(bin, 'gitleaks', { versionSubcommand: true, versionLine: '8.30.1', reportFlag: '--report-path', reportBody: fixtureText('gitleaks-<ver>-history-blocking.json'), exit: 3, stdout: '' });
  expect(runWith(bin, ALL_FIVE).exitCode).toBe(1);
  rmSync(path.join(bin, 'gitleaks'));
  expect(runWith(bin, ALL_FIVE).exitCode).toBe(2);
});

it('does not count an unenforced external gate toward the exit code', () => {
  // same stubs, policy with secrets-history enforce: false, expect 0
});
```

`tests/dogfood.e2e.test.ts:982`: extend the shim list to five names if the e2e drives the policy through all roles; otherwise leave it and note why in the commit message.

- [ ] **Step 2: Run, fix only what fails**

Run each file. Expected: SARIF and text pass without source changes because both switch on `Subject.kind`; if `subjectLabel` or `locationsFor` turns out to special-case a product name, extend it. The run-level tests pass once Tasks 5 to 8 are in.

- [ ] **Step 3: Full suite, commit**

Run: `pnpm --dir <worktree> test 2>&1 | tail -8`

```
git -C <worktree> add tests/output-sarif.test.ts tests/output-text.test.ts tests/run.test.ts tests/dogfood.e2e.test.ts src/output-text.ts src/output-sarif.ts
git -C <worktree> commit -m "Pin the five-gate report, SARIF and exit aggregation with stubbed external gates"
```

---

### Task 10: Docs, Action recipe, invariants, changelog

**Files:**
- Modify: `README.md` (lines 9-13, 55-63, 180, 200-211, 228-256, 544-565, 692-700, 1147-1171; NOT 32-46), `action.yml:489-513` comments only, `docs/INVARIANTS.md` (9-15, 147-150, 166-177, 426-437, 861-866, 935-970, 1058-1066), `CHANGELOG.md`, `schema/guardrails.schema.json` descriptions, module comments in `policy.ts`, `exit-codes.ts`, `envelope.ts`, `normalize.ts`, `gate-runner.ts`, `resolve.ts`
- Test: `pnpm lint`, `tests/action-pr-comment.test.ts` (pins README strings; keep them byte-identical), `tests/action.test.ts` (must stay green: no new inputs)

- [ ] **Step 1: README**

- Lines 9-13: replace "running three gates ... nothing here is a fourth scanner, only the umbrella over the three that exist" with: conductor runs five gates over one policy file, three from this family and two the adopter already installs, gitleaks for git history and osv-scanner for known vulnerabilities; conductor scans nothing itself and installs nothing that is not its own.
- "Install the gates" (55-63): keep the npm line; add a paragraph: the two external gates are installed by you, on your machine and in your workflow, from their own releases; conductor finds them on PATH and reports could-not-run when they are missing. Show the two policy lines that enable them.
- The policy section (228-256): add `secrets-history` and `vulnerabilities` to the role list with their products and default stage `ci`; document that `--config`, `--log-opts`, `--report-path`, `--exit-code` and `--format` are reserved because the umbrella writes them.
- Pull-request trust boundary section: one paragraph on the base-ref config for `.gitleaks.toml` and `osv-scanner.toml`, the neutral config when the base has none, and the proposal line.
- Exit codes / "Which gates are covered" (544-565): five, and how gitleaks exit 3 and osv-scanner exit 128 are read.
- The Action section (692-700): the Action still installs exactly four npm packages; add a recipe step BEFORE the conductor step that installs gitleaks and osv-scanner by pinned release download with a checksum, in the shape the proof repository's security workflow uses (write it fresh, do not link to any private repo), and say that a missing tool fails the check with a remedy line.
- "What is in and what is out" (1147-1171): the gates are still the product; two of them are not this family's.
- Every place that says "three" in a claim about the gate count is updated; the shared `guardrails-family` block (32-46) is left byte-identical.

- [ ] **Step 2: INVARIANTS**

For each listed line range read the claim, then rewrite it to the five-gate truth with citations to the new code: `src/products.ts` for the profile, `src/external-config.ts` for base-ref config, `gate-runner.ts` for exit classification and the floor, `TRUST_BASE_MIN_VERSION` now holding five entries. Add a new entry: "conductor downloads no third-party binary; external gates are resolved from PATH only, `managed: false` in the profile, and the Action has no input for them" citing the profile and action.yml. Update 1058-1066 (`missingGateRemedy`) to say the remedy comes from the profile and differs for external tools.

- [ ] **Step 3: CHANGELOG and comments**

CHANGELOG Unreleased: "Added: two gate roles, secrets-history (gitleaks 8.19 or later, git history mode) and vulnerabilities (osv-scanner 2.x). Both are installed by the adopter, never by conductor; a missing binary is could-not-run. Findings appear in the report and SARIF like any gate. On a pull request their config files are read from the base ref. Unchanged: the three npm gates' behaviour, argv, exit reading and timeout." Note the minor version bump this implies (0.5.0).

Update the module comments listed in the map that say "three products" or "three CLIs".

- [ ] **Step 4: Gates and commit**

Run: `pnpm --dir <worktree> lint 2>&1 | tail -1`, `pnpm --dir <worktree> test -- tests/action-pr-comment.test.ts tests/action.test.ts 2>&1 | tail -6`, then the full suite once more.

```
git -C <worktree> add README.md docs/INVARIANTS.md CHANGELOG.md action.yml schema/guardrails.schema.json src/policy.ts src/exit-codes.ts src/envelope.ts src/normalize.ts src/gate-runner.ts src/resolve.ts
git -C <worktree> commit -m "Document the two external gates: five roles, adopter-installed tools, base-ref config, remedy"
```

---

## After the plan

- Independent Opus review of the whole branch before the PR (failure-direction change: a new exit reading and a new pull-request trust path).
- Package release conductor 0.5.0 (also carries the base-ref wiring from #53). Tag push is the operator's.
- Add both external gates to the proof repository's policy, re-run its four pull requests, and add the two rows the demo can now show (a secret only in history, a known vulnerability). Update the proof README table and conductor's README table from the live check conclusions.

## Self-review notes

- Spec coverage: decision 2 (downloads nothing) is Tasks 1 and 10; decision 3 and 4 (history via gitleaks, vulnerabilities via osv-scanner) are Tasks 2 to 9; section 10 open questions: severity model (Tasks 6 and 7, derived severities with `failOn: 'any'`), config from base or head (Task 8: base, neutral when absent), report format versions (Task 3 records the captured version; Task 5's `minVersion` floors the command line; a newer report format that breaks parsing surfaces as `unparseable-output`, which is could-not-run, never a silent pass).
- Review Focus items 1 to 5 each have a named test: Task 5 (items 1, 2, 4), Task 8 (item 3), Task 4 (item 5).
- Type consistency: `ExternalArgs`, `ProductProfile`, `MaterializedConfig`, `normalizeFor(product, raw, version, { blocked })` are used with the same names in every task that touches them.
- Not covered on purpose: SARIF upload of external findings to code scanning is the same path as today; the proof repository update is after the release; the shared README block is a cross-repo sweep.
