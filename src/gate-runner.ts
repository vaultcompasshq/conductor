// Running one gate as a child process.
//
// Wrapper, not library: nothing here imports any gate's own package. That
// is what keeps the umbrella from taking three exact version pins and
// needing a release of its own every time one of the three ships, and it is
// what makes "this gate ran and exited N, output unparsed" an available
// outcome instead of a build error.
//
// The one non-obvious constraint, and it came from running the tools rather
// than from reading them: the CHILD'S WORKING DIRECTORY MUST BE THE
// REPOSITORY ROOT. vault-guard resolves both its config file and its
// baseline from process.cwd() rather than from the path argument, so a
// child spawned from anywhere else scans the right files with the wrong
// configuration and the wrong baseline, and says nothing about it.
// dep-guard resolves from its path argument and intent-guard from
// --project, so setting cwd correctly is the single approach that is right
// for all three.

import { spawnSync } from 'node:child_process';

import type { Diagnostic, Finding, RunSummary } from './envelope.js';
import { NormalizeError } from './envelope.js';
import {
  normalizeDepGuard,
  normalizeIntentGuard,
  normalizeMissingGate,
  normalizeVaultGuard,
} from './normalize.js';
import type { GatePolicy, GateRole, Product } from './policy.js';
import { renderOptionFlags } from './policy.js';
import { ResolveError, candidateNames, resolveGateBinary } from './resolve.js';
import type { ResolvedBinary } from './resolve.js';

export type CouldNotRunReason =
  | 'binary-missing'
  | 'configured-command-missing'
  | 'spawn-failed'
  | 'gate-error'
  | 'unparseable-output';

export interface CouldNotRun {
  reason: CouldNotRunReason;
  detail: string;
}

export interface GateOutcome {
  role: GateRole;
  product: Product;
  /** From the binary's --version, or null when there was no safe way to ask. */
  productVersion: string | null;
  /** The command line actually run, for the report header. */
  argv: string[];
  binary: ResolvedBinary | null;
  exitCode: number | null;
  durationMs: number;
  couldNotRun: CouldNotRun | null;
  findings: Finding[];
  run: RunSummary;
  /** Problems with the run or the normalization, not with the scanned code. */
  diagnostics: Diagnostic[];
  /** Kept so the report can show why a gate that could not run said no. */
  stderr: string;
}

export interface RunGateOptions {
  repoRoot: string;
  staged: boolean;
  /** PATH to search. Injected so tests never depend on the machine. */
  pathValue: string;
  /** Wall-clock limit per gate. */
  timeoutMs?: number;
}

const EMPTY_RUN: RunSummary = {
  failOn: null,
  suppressed: 0,
  ignored: 0,
  diagnostics: [],
  details: {},
};

/**
 * The arguments the umbrella adds, per product.
 *
 * These are the reserved options the policy schema refuses to let a user
 * set, and this is the only place they are written. The passthrough block
 * goes last so a gate's own flags are visible at the end of the command
 * line in the report, where they read as the user's own additions.
 */
function gateArgs(gate: GatePolicy, staged: boolean): string[] {
  const passthrough = renderOptionFlags(gate.options);
  switch (gate.product) {
    case 'dep-guard':
      return [...(staged ? ['--staged'] : []), '--format', 'json', ...passthrough];
    case 'vault-guard':
      // No path argument: the CLI defaults it to "." and the umbrella runs
      // with cwd at the repository root anyway. Passing one would also risk
      // a passthrough value being read as the positional.
      return [...(staged ? ['--staged'] : []), '-f', 'json', ...passthrough];
    case 'intent-guard':
      return [
        '--project',
        '.',
        ...(staged ? ['--staged'] : []),
        '--json',
        ...passthrough,
      ];
  }
}

/**
 * Asks a binary for its version.
 *
 * Never called for a binary the candidate table marks unsafe to ask: the
 * per-command binaries ignore --version and run the gate instead, so a
 * probe there would have side effects on the user's repository.
 */
function probeVersion(binary: ResolvedBinary, repoRoot: string, timeoutMs: number): string | null {
  if (binary.versionProbe === null) {
    return null;
  }
  const probe = spawnSync(binary.versionProbe.command, binary.versionProbe.argv, {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: timeoutMs,
  });
  if (probe.status !== 0 || typeof probe.stdout !== 'string') {
    return null;
  }
  // All three print a bare version string. Take the first line and accept
  // it only if it looks like one, so a future help banner does not end up
  // in a SARIF driver's version field.
  const first = probe.stdout.trim().split('\n')[0]?.trim() ?? '';
  return /^v?\d+\.\d+\.\d+/.test(first) ? first.replace(/^v/, '') : null;
}

function normalizeFor(product: Product, parsed: unknown, version: string | null) {
  switch (product) {
    case 'dep-guard':
      return normalizeDepGuard(parsed, version);
    case 'vault-guard':
      return normalizeVaultGuard(parsed, version);
    case 'intent-guard':
      return normalizeIntentGuard(parsed, version);
  }
}

export function runGate(gate: GatePolicy, options: RunGateOptions): GateOutcome {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const started = Date.now();

  const base: Omit<GateOutcome, 'couldNotRun' | 'findings' | 'run' | 'diagnostics'> = {
    role: gate.role,
    product: gate.product,
    productVersion: null,
    argv: [],
    binary: null,
    exitCode: null,
    durationMs: 0,
    stderr: '',
  };

  let binary: ResolvedBinary | null;
  try {
    binary = resolveGateBinary(gate, options.repoRoot, options.pathValue);
  } catch (err) {
    if (!(err instanceof ResolveError)) {
      throw err;
    }
    return {
      ...base,
      durationMs: Date.now() - started,
      couldNotRun: { reason: 'configured-command-missing', detail: err.message },
      findings: [normalizeMissingGate(gate.role, gate.product, candidateNames(gate.product))],
      run: EMPTY_RUN,
      diagnostics: [],
    };
  }

  if (binary === null) {
    return {
      ...base,
      durationMs: Date.now() - started,
      couldNotRun: {
        reason: 'binary-missing',
        detail: `no ${gate.product} binary on PATH or in node_modules/.bin`,
      },
      // A missing enabled gate is a finding of the umbrella's own, never a
      // silent skip. Skipping is how a gate ends up switched on in the
      // policy file and absent in reality for months.
      findings: [normalizeMissingGate(gate.role, gate.product, candidateNames(gate.product))],
      run: EMPTY_RUN,
      diagnostics: [],
    };
  }

  const version = probeVersion(binary, options.repoRoot, timeoutMs);
  const argv = [...binary.argvPrefix, ...gateArgs(gate, options.staged)];

  const child = spawnSync(binary.command, argv, {
    cwd: options.repoRoot,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });

  const withRun = {
    ...base,
    productVersion: version,
    argv,
    binary,
    durationMs: Date.now() - started,
    stderr: child.stderr ?? '',
  };

  if (child.error !== undefined) {
    return {
      ...withRun,
      exitCode: null,
      couldNotRun: { reason: 'spawn-failed', detail: child.error.message },
      findings: [],
      run: EMPTY_RUN,
      diagnostics: [],
    };
  }

  const exitCode = child.status;
  const stdout = child.stdout ?? '';

  // dep-guard's 2 means "could not run the checks at all" and it prints no
  // JSON. The other two have no such code, but a signal-killed child or a
  // timeout lands here too, and none of those are a clean result.
  if (exitCode === null || exitCode > 1) {
    return {
      ...withRun,
      exitCode,
      couldNotRun: {
        reason: 'gate-error',
        detail:
          exitCode === null
            ? 'the gate did not exit normally (killed, or timed out)'
            : `the gate exited ${exitCode}, which it uses for "could not run"`,
      },
      findings: [],
      run: EMPTY_RUN,
      diagnostics: [],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    // Exit 1 with unparseable stdout is what a rejected config looks like
    // from two of the three products, and it is could-not-run rather than
    // clean. Reporting it as a policy violation would tell the user their
    // code is at fault when their config is.
    return {
      ...withRun,
      exitCode,
      couldNotRun: {
        reason: 'unparseable-output',
        detail:
          `the gate exited ${exitCode} without valid JSON on stdout. ` +
          'A rejected config file looks exactly like this, and it is not a clean result.',
      },
      findings: [],
      run: EMPTY_RUN,
      diagnostics: [],
    };
  }

  try {
    const normalized = normalizeFor(gate.product, parsed, version);
    return {
      ...withRun,
      exitCode,
      couldNotRun: null,
      findings: normalized.findings,
      run: normalized.run,
      diagnostics: normalized.diagnostics,
    };
  } catch (err) {
    if (!(err instanceof NormalizeError)) {
      throw err;
    }
    // The gate ran and answered; the umbrella did not understand it. That
    // is could-not-run for the umbrella's purposes, and the message says
    // which side the problem is on so nobody debugs the wrong repository.
    return {
      ...withRun,
      exitCode,
      couldNotRun: { reason: 'unparseable-output', detail: err.message },
      findings: [],
      run: EMPTY_RUN,
      diagnostics: [],
    };
  }
}
