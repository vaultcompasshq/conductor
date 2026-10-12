import { statSync } from 'node:fs';
import path from 'node:path';

import { NATIVE_CONTRACT_PATH } from './intent-prepare.js';
import { DEFAULT_STAGE_FOR_ROLE, GATE_ROLES, POLICY_FILE_NAME, PRODUCT_FOR_ROLE } from './policy.js';
import type { GateRole } from './policy.js';
import { installName } from './normalize.js';
import { CANDIDATES } from './resolve.js';

export { POLICY_FILE_NAME };

/** Names of the gates whose binary resolves right now. */
export function detectGates(root: string, pathValue: string): Set<GateRole> {
  const found = new Set<GateRole>();
  for (const role of GATE_ROLES) {
    const product = PRODUCT_FOR_ROLE[role];
    for (const candidate of CANDIDATES[product]) {
      // Same order as resolve.ts, though only the answer matters here:
      // detection asks whether a gate is installed at all, not which copy
      // of it would run.
      const local = isExecutable(path.join(root, 'node_modules', '.bin', candidate.name));
      const onPath = pathValue
        .split(path.delimiter)
        .filter((dir) => dir.length > 0)
        .some((dir) => isExecutable(path.join(dir, candidate.name)));
      if (local || onPath) {
        found.add(role);
        break;
      }
    }
  }
  return found;
}

function isExecutable(file: string): boolean {
  try {
    const stats = statSync(file);
    return stats.isFile() && (stats.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

const ROLE_DESCRIPTION: Record<GateRole, string> = {
  dependencies: 'what comes in: hallucinated names, typosquats, tampered lockfile entries',
  secrets: 'what goes out: credentials about to be committed',
  intent: 'what was approved: drift from a frozen intent contract, and change budgets',
  'secrets-history':
    'credentials anywhere in git history, by gitleaks (installed by you, not by conductor)',
  vulnerabilities:
    'known vulnerabilities in the resolved dependency tree, by osv-scanner (installed by you, not by conductor)',
};

/**
 * The policy file, written by hand rather than serialised, because the
 * comments are half the point: a first-run policy file that explains what
 * each key is for is most of a first-run experience, and a YAML emitter
 * cannot carry them.
 *
 * `frozenContractPath` decides the intent gate's `enforce` default (issue
 * #57): non-null when this repository already has a frozen contract at init
 * time, so the ramp init would otherwise produce is already climbed, and
 * leaving it unenforced would silently drop the one protection a contract
 * with protected paths exists to give -- exactly what a frozen contract's
 * findings NOT failing the check let happen on the public demo repository.
 * False is still the default with no contract, for the same ramp reasoning
 * as before: a fresh intent gate with nothing frozen yet has nothing to
 * enforce against.
 *
 * The caller passes intent-prepare.ts's own `frozenNativeContractPath(root)`
 * directly, not a boolean, so the comment below can name the path a frozen
 * contract was ACTUALLY found at -- the canonical
 * `.intent-guard/intent-contract.yaml` or the legacy
 * `.conductor/intent-contract.yaml` -- rather than always naming the
 * canonical one even when the frozen contract that triggered enforcement
 * lives at the legacy path.
 */
export function renderPolicy(
  detected: Set<GateRole>,
  frozenContractPath: string | null
): string {
  const lines: string[] = [
    '# Guardrail policy. One file for every gate this repository runs.',
    '#',
    '# Gates are keyed by the ROLE they fill, and the product filling that role',
    '# is one line inside it. Swapping or renaming a product is a one-line edit',
    '# rather than a rename of the key your CI reads.',
    '#',
    '# There is deliberately no shared severity threshold. Each gate keeps its',
    '# own, spelled the way that gate spells it, inside its own options block.',
    '#',
    '# stage says when a gate runs: commit, push, or ci. Stages are cumulative,',
    '# so a gate runs at its own stage and at every later one, and a run at ci',
    '# runs everything enabled. The values below are the defaults.',
    '#',
    '# enforce says whether a gate can change the exit code. A gate with',
    '# enforce: false runs and reports exactly as an enforced one does and',
    '# never fails the run, which is how a gate is adopted before anybody is',
    '# ready to have it refuse a commit. It is written out below for every',
    '# gate, for the same reason stage is: a default that lives only in the',
    '# parser is a default nobody can find.',
    'version: 1',
    '',
    'gates:',
  ];

  for (const role of GATE_ROLES) {
    const product = PRODUCT_FOR_ROLE[role];
    const enabled = detected.has(role);
    lines.push(`  # ${ROLE_DESCRIPTION[role]}`);
    if (!enabled) {
      lines.push(
        `  # not found in node_modules/.bin or on PATH. Install ${installName(product)}, then set enabled: true.`
      );
    }
    lines.push(`  ${role}:`);
    lines.push(`    product: ${product}`);
    lines.push(`    enabled: ${enabled ? 'true' : 'false'}`);
    lines.push(`    stage: ${DEFAULT_STAGE_FOR_ROLE[role]}`);
    // The intent gate is the one with ceremony, and the ramp is what makes
    // that ceremony adoptable: with no frozen contract yet, it reports for a
    // few pull requests before it is allowed to refuse anybody's merge.
    // Writing that here rather than describing it in a comment is the
    // difference between a fresh init producing the ramp and three
    // repositories being hand-edited into it. Once a contract IS frozen, the
    // ramp is already climbed and enforcing from the start is what stops a
    // frozen contract's protected paths from producing findings that never
    // fail the check (issue #57).
    let unfrozenIntent = false;
    if (role === 'intent') {
      if (frozenContractPath !== null) {
        lines.push(
          `    # A frozen contract already exists at ${frozenContractPath}, so this gate`
        );
        lines.push('    # enforces from the start rather than only reporting.');
        lines.push('    enforce: true');
      } else {
        unfrozenIntent = true;
        lines.push(`    # No frozen contract yet (${NATIVE_CONTRACT_PATH}), so this gate runs`);
        lines.push('    # and reports without failing the run. Once a contract is frozen,');
        lines.push('    # set this to true by hand: conductor init never rewrites this file');
        lines.push('    # once it exists.');
        lines.push('    enforce: false');
      }
    } else {
      lines.push('    enforce: true');
    }
    // Only the vulnerabilities gate compares a pull request with its base.
    // Written as report for a fresh repository, so an existing backlog does
    // not block every pull request from the first one; a parser default of
    // block keeps every policy written before the key existed as strict as
    // it was.
    if (role === 'vulnerabilities') {
      lines.push('    # On a pull request, findings already on the base branch are reported');
      lines.push('    # and do not block; only advisories the pull request introduces do.');
      lines.push('    # Set present-on-base: block to block on every known vulnerability.');
      lines.push('    present-on-base: report');
    }
    lines.push('    # Handed to this gate unchanged. Keys are its own long flags,');
    lines.push('    # without the leading dashes.');
    if (role === 'secrets-history') {
      lines.push('    # gitleaks has no severity floor. Tune its rules in .gitleaks.toml and');
      lines.push('    # accept an old finding in .gitleaksignore, not here.');
    } else if (role === 'vulnerabilities') {
      lines.push('    # osv-scanner has no severity floor. Tune what it reports in');
      lines.push('    # osv-scanner.toml, not here.');
    } else if (role === 'intent') {
      lines.push('    # require-frozen: false lets the gate run and not block when no contract exists.');
    } else {
      lines.push('    # Example: fail-on: high');
    }
    if (unfrozenIntent) {
      // intent-guard blocks on a missing contract when require-frozen is true,
      // its default. Without this key a full run prints a BLOCKING critical
      // finding for the very state the unenforced ramp above exists for.
      lines.push('    options:');
      lines.push('      require-frozen: false');
    } else {
      lines.push('    options: {}');
    }
  }

  lines.push('', 'report:', '  format: text', '');
  return lines.join('\n');
}
