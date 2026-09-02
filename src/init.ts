// `compass init`: one policy file, one pre-commit hook, one manifest.
//
// The manifest is what makes --revert honest. Without one, "undo the init"
// means guessing which files were the tool's, and a tool that guesses about
// deletion in somebody's repository has to be wrong only once.
//
// Four properties are the whole point, and three of them are bugs some tool
// in this family has actually shipped:
//
//  1. FAIL CLOSED. A missing umbrella binary blocks the commit. The
//     tempting alternative, warning and letting the commit through so a
//     teammate without the tool is not stuck, means the gate is silently
//     absent exactly where it is most likely to be absent, and a guardrail
//     that is off when the tool is missing is a guardrail an attacker turns
//     off by making the tool missing.
//
//  2. PRESERVE THE EXIT CODE. 2 means a gate could not run; 1 means a gate
//     blocked. A hook written the natural way, `if compass run; then exit
//     0; fi; exit 1`, collapses 2 into 1 and reports findings that were
//     never looked for.
//
//  3. A RELATIVE core.hooksPath RESOLVES AGAINST THE WORKTREE ROOT, not
//     against the .git directory. A sibling tool resolved it against the
//     .git directory and the test that covered the case asserted the same
//     wrong location, so the two agreed with each other and neither was
//     checked against git. The test here drives a real commit instead.
//
//  4. NEVER STACK A SECOND HOOK. If a gate already installed its own
//     pre-commit hook, adding the umbrella's alongside it means that gate
//     runs twice and its findings appear twice. Init reports the collision
//     and stops, or replaces the gate's hook when told to adopt it.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { GATE_ROLES, POLICY_FILE_NAME, PRODUCT_FOR_ROLE } from './policy.js';
import type { GateRole, Product } from './policy.js';
import { CANDIDATES } from './resolve.js';

export { POLICY_FILE_NAME };

/** The one string that says "compass init wrote this". */
export const MANAGED_HOOK_MARKER = 'guardrails-managed-hook: v1';

export const MANIFEST_RELATIVE_PATH = '.guardrails/manifest.json';

/**
 * Markers each gate's own installer writes, so a collision is recognised
 * rather than clobbered. Two of these are literal marker comments the other
 * tools write on purpose; the third has no marker at all and is matched on
 * the two strings its hook always contains, which is exactly how that
 * tool's own installer recognises its own hook.
 */
export const DEP_GUARD_HOOK_MARKER = 'dep-guard-managed-hook: v1';
export const INTENT_GUARD_HOOK_MARKER = 'conductor-managed-pre-commit';

function detectGateHook(content: string): Product | null {
  if (content.includes(DEP_GUARD_HOOK_MARKER)) {
    return 'dep-guard';
  }
  // Deliberately still the pre-rename string: it is state already sitting
  // in users' repositories, and the tool that writes it did not rename it
  // either, precisely so an older hook stays recognisable.
  if (content.includes(INTENT_GUARD_HOOK_MARKER)) {
    return 'intent-guard';
  }
  if (content.includes('vault-guard') && content.includes('scan --staged')) {
    return 'vault-guard';
  }
  return null;
}

const HOOK = `#!/bin/sh
# Guardrail pre-commit hook. ${MANAGED_HOOK_MARKER}
# Installed by "compass init". Remove it with "compass init --revert".
#
# No "set -e" on purpose: under it the shell would exit at the failing
# command before the status could be captured, which loses the explanatory
# line, so a blocked commit would print nothing about why.
#
# "command -v" rather than "which": "which" is not in POSIX, is absent from
# some minimal images, and reports success in some shells for a builtin
# that is not an executable.

if ! command -v compass >/dev/null 2>&1; then
  echo "compass: command not found, so this commit was NOT checked by any guardrail gate. Install the umbrella, or run 'compass init --revert' to remove this hook." >&2
  exit 1
fi

compass run --staged
compass_status=$?

if [ "$compass_status" -ne 0 ]; then
  echo "compass: commit blocked (compass exit $compass_status). Review the report above; 'git commit --no-verify' bypasses this hook at your own risk." >&2
fi

# Passed straight through. 1 means a gate blocked; 2 means a gate could not
# run at all. Collapsing 2 into 1 would report findings never looked for.
exit "$compass_status"
`;

export type ConflictReason =
  | 'not-a-git-repository'
  | 'foreign-hook'
  | 'gate-hook'
  | 'hooks-path-outside-repository'
  | 'no-manifest'
  | 'write-failed';

export interface InitConflict {
  path: string;
  reason: ConflictReason;
  guidance: string;
}

export interface InitAction {
  kind: 'write' | 'skip' | 'remove' | 'restore';
  path: string;
  detail: string;
}

export interface AdoptedHook {
  product: Product;
  content: string;
}

export interface InitResult {
  ok: boolean;
  dryRun: boolean;
  alreadyInstalled: boolean;
  actions: InitAction[];
  conflicts: InitConflict[];
  /** Absolute path of the hook file, empty when there is nothing to write. */
  hookPath: string;
  repoRoot: string;
  adoptedFrom: AdoptedHook | null;
  /** Contents to write, keyed by absolute path. Empty on a dry run's apply. */
  writes: Array<{ path: string; content: string; executable: boolean }>;
}

export interface InitOptions {
  cwd: string;
  /** PATH used for gate detection. Injected so tests never depend on the machine. */
  pathValue: string;
  dryRun?: boolean;
  /** Replace a per-gate hook with the umbrella's. Never replaces a foreign one. */
  adopt?: boolean;
}

interface ManifestFile {
  path: string;
  sha256: string;
}

interface Manifest {
  version: 1;
  files: ManifestFile[];
  adopted: { path: string; content: string; product: Product } | null;
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function gitOutput(cwd: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * The working-tree root, or null when cwd is not inside a repository.
 *
 * Asked of git rather than probed for a `.git` entry, so init works from a
 * subdirectory and gets a worktree or a submodule right, where `.git` is a
 * file rather than a directory.
 */
function repoRootOf(cwd: string): string | null {
  return gitOutput(cwd, ['rev-parse', '--show-toplevel']);
}

interface HooksDir {
  dir: string;
  /** True when a configured hooksPath points outside the repository. */
  outside: boolean;
}

function effectiveHooksDir(cwd: string, root: string): HooksDir {
  const gitDir = gitOutput(cwd, ['rev-parse', '--git-dir']);
  const hooksPath = gitOutput(cwd, ['config', '--get', 'core.hooksPath']) ?? '';

  if (hooksPath.length === 0) {
    // With no core.hooksPath, hooks live in the git DIRECTORY, which is not
    // the working-tree root: for a linked worktree or a submodule it is
    // somewhere else entirely, so this one resolves against gitDir.
    return { dir: path.join(path.resolve(cwd, gitDir ?? '.git'), 'hooks'), outside: false };
  }

  // A RELATIVE core.hooksPath resolves against the WORKING-TREE ROOT.
  // Verified by experiment rather than by reading the documentation that
  // was misread the first time this was written in a sibling tool.
  const dir = path.isAbsolute(hooksPath) ? hooksPath : path.join(root, hooksPath);
  const relative = path.relative(root, dir);
  const outside = relative.startsWith('..') || path.isAbsolute(relative);
  return { dir, outside };
}

function readIfExists(file: string): string | undefined {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
}

/** Names of the gates whose binary resolves right now. */
function detectGates(root: string, pathValue: string): Set<GateRole> {
  const found = new Set<GateRole>();
  for (const role of GATE_ROLES) {
    const product = PRODUCT_FOR_ROLE[role];
    for (const candidate of CANDIDATES[product]) {
      const onPath = pathValue
        .split(path.delimiter)
        .filter((dir) => dir.length > 0)
        .some((dir) => isExecutable(path.join(dir, candidate.name)));
      const local = isExecutable(path.join(root, 'node_modules', '.bin', candidate.name));
      if (onPath || local) {
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
};

/**
 * The policy file, written by hand rather than serialised, because the
 * comments are half the point: a first-run policy file that explains what
 * each key is for is most of a first-run experience, and a YAML emitter
 * cannot carry them.
 */
export function renderPolicy(detected: Set<GateRole>): string {
  const lines: string[] = [
    '# Guardrail policy. One file for every gate this repository runs.',
    '#',
    '# Gates are keyed by the ROLE they fill, and the product filling that role',
    '# is one line inside it. Swapping or renaming a product is a one-line edit',
    '# rather than a rename of the key your CI reads.',
    '#',
    '# There is deliberately no shared severity threshold. Each gate keeps its',
    '# own, spelled the way that gate spells it, inside its own options block.',
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
        `  # not found on PATH or in node_modules/.bin. Install ${product}, then set enabled: true.`
      );
    }
    lines.push(`  ${role}:`);
    lines.push(`    product: ${product}`);
    lines.push(`    enabled: ${enabled ? 'true' : 'false'}`);
    lines.push('    # Handed to this gate unchanged. Keys are its own long flags,');
    lines.push('    # without the leading dashes. Example: fail-on: high');
    lines.push('    options: {}');
  }

  lines.push('', 'report:', '  format: text', '');
  return lines.join('\n');
}

function foreignGuidance(relPath: string): string {
  return (
    `${relPath} already exists and was not written by compass init. Merge "compass run --staged" ` +
    'into it yourself, or move it aside and re-run init. Init never replaces a hook it does not ' +
    'recognise, because that hook is somebody working setup.'
  );
}

function gateHookGuidance(product: Product, relPath: string): string {
  return (
    `${relPath} is ${product}'s own pre-commit hook. Adding the umbrella hook alongside it would ` +
    `run ${product} twice and report its findings twice. Re-run with --adopt to replace it with ` +
    'the umbrella hook, which runs every enabled gate including that one, or leave things as they ' +
    'are and do not run init here.'
  );
}

export function planInit(options: InitOptions): InitResult {
  const dryRun = Boolean(options.dryRun);
  const actions: InitAction[] = [];
  const conflicts: InitConflict[] = [];
  const writes: InitResult['writes'] = [];

  const base: InitResult = {
    ok: false,
    dryRun,
    alreadyInstalled: false,
    actions,
    conflicts,
    hookPath: '',
    repoRoot: '',
    adoptedFrom: null,
    writes,
  };

  const root = repoRootOf(options.cwd);
  if (root === null) {
    conflicts.push({
      path: '.git',
      reason: 'not-a-git-repository',
      guidance: 'Run "git init" first: a pre-commit hook has nothing to attach to otherwise.',
    });
    return base;
  }

  const hooks = effectiveHooksDir(options.cwd, root);
  if (hooks.outside) {
    conflicts.push({
      path: hooks.dir,
      reason: 'hooks-path-outside-repository',
      guidance:
        `core.hooksPath points at ${hooks.dir}, outside this repository. Writing there would ` +
        'install this repository hook on every repository on the machine. Set a repository-local ' +
        'core.hooksPath (git config core.hooksPath .git/hooks) and re-run init.',
    });
    return { ...base, repoRoot: root };
  }

  const hookPath = path.join(hooks.dir, 'pre-commit');
  const relHook = path.relative(root, hookPath).split(path.sep).join('/');
  const policyPath = path.join(root, POLICY_FILE_NAME);
  const manifestPath = path.join(root, MANIFEST_RELATIVE_PATH);

  const existingHook = readIfExists(hookPath);
  let adoptedFrom: AdoptedHook | null = null;

  if (existingHook !== undefined && existingHook.includes(MANAGED_HOOK_MARKER)) {
    // Nothing to do for the hook. The policy file is still checked below,
    // so a repository whose policy file was deleted can get it back.
    actions.push({ kind: 'skip', path: relHook, detail: 'already installed by compass init' });
  } else if (existingHook !== undefined && existingHook.trim().length > 0) {
    const gateProduct = detectGateHook(existingHook);
    if (gateProduct === null) {
      conflicts.push({ path: relHook, reason: 'foreign-hook', guidance: foreignGuidance(relHook) });
      return { ...base, repoRoot: root, hookPath };
    }
    if (!options.adopt) {
      conflicts.push({
        path: relHook,
        reason: 'gate-hook',
        guidance: gateHookGuidance(gateProduct, relHook),
      });
      return { ...base, repoRoot: root, hookPath };
    }
    adoptedFrom = { product: gateProduct, content: existingHook };
    actions.push({
      kind: 'write',
      path: relHook,
      detail: `adopt: replace ${gateProduct}'s own hook (restored by --revert)`,
    });
    writes.push({ path: hookPath, content: HOOK, executable: true });
  } else {
    actions.push({
      kind: 'write',
      path: relHook,
      detail: existingHook === undefined ? 'create' : 'replace an empty file',
    });
    writes.push({ path: hookPath, content: HOOK, executable: true });
  }

  const existingPolicy = readIfExists(policyPath);
  if (existingPolicy === undefined) {
    writes.push({
      path: policyPath,
      content: renderPolicy(detectGates(root, options.pathValue)),
      executable: false,
    });
    actions.push({ kind: 'write', path: POLICY_FILE_NAME, detail: 'create' });
  } else {
    // Never rewritten. The policy file is the one artifact a user edits by
    // hand, and re-running init must not have an opinion about their edits.
    actions.push({
      kind: 'skip',
      path: POLICY_FILE_NAME,
      detail: 'already present, left exactly as it is',
    });
  }

  const alreadyInstalled = writes.length === 0;
  if (!alreadyInstalled) {
    actions.push({ kind: 'write', path: MANIFEST_RELATIVE_PATH, detail: 'record what init wrote' });
  }

  return {
    ...base,
    ok: true,
    alreadyInstalled,
    hookPath,
    repoRoot: root,
    adoptedFrom,
    writes,
  };
}

export function applyInit(plan: InitResult, options: InitOptions): InitResult {
  if (!plan.ok || plan.dryRun || plan.alreadyInstalled) {
    return plan;
  }

  const manifest: Manifest = {
    version: 1,
    files: [],
    adopted:
      plan.adoptedFrom === null
        ? null
        : {
            path: plan.hookPath,
            content: plan.adoptedFrom.content,
            product: plan.adoptedFrom.product,
          },
  };

  try {
    for (const write of plan.writes) {
      mkdirSync(path.dirname(write.path), { recursive: true });
      writeFileSync(write.path, write.content, 'utf8');
      if (write.executable) {
        // Set after the write rather than through the write's mode option:
        // an existing file keeps its own mode when written through, and git
        // will not run a hook it cannot execute. A hook that silently never
        // runs is indistinguishable from no gate at all.
        chmodSync(write.path, (statSync(write.path).mode & 0o777) | 0o755);
      }
      manifest.files.push({ path: write.path, sha256: sha256(write.content) });
    }

    const manifestPath = path.join(plan.repoRoot, MANIFEST_RELATIVE_PATH);
    mkdirSync(path.dirname(manifestPath), { recursive: true });
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  } catch (err) {
    return {
      ...plan,
      ok: false,
      conflicts: [
        ...plan.conflicts,
        {
          path: plan.repoRoot,
          reason: 'write-failed',
          guidance: `Could not finish writing: ${(err as Error).message}`,
        },
      ],
    };
  }

  void options;
  return plan;
}

export interface RevertResult {
  ok: boolean;
  actions: InitAction[];
  conflicts: InitConflict[];
}

/**
 * Removes exactly what init wrote, and nothing else.
 *
 * A file whose contents no longer match what the manifest recorded is left
 * alone and reported. That file is now the user's, whatever it started as,
 * and a revert that deletes edited work is a revert nobody runs twice.
 */
export function revertInit(options: InitOptions): RevertResult {
  const actions: InitAction[] = [];
  const conflicts: InitConflict[] = [];

  const root = repoRootOf(options.cwd);
  if (root === null) {
    conflicts.push({
      path: '.git',
      reason: 'not-a-git-repository',
      guidance: 'Nothing to revert: this is not a git repository.',
    });
    return { ok: false, actions, conflicts };
  }

  const manifestPath = path.join(root, MANIFEST_RELATIVE_PATH);
  const raw = readIfExists(manifestPath);
  if (raw === undefined) {
    conflicts.push({
      path: MANIFEST_RELATIVE_PATH,
      reason: 'no-manifest',
      guidance:
        `No ${MANIFEST_RELATIVE_PATH}, so there is no record of what init wrote. Nothing was ` +
        'removed: guessing which files were ours is how a revert deletes somebody work.',
    });
    return { ok: false, actions, conflicts };
  }

  const manifest = JSON.parse(raw) as Manifest;
  let hookRemoved = false;

  for (const file of manifest.files) {
    const rel = path.relative(root, file.path).split(path.sep).join('/');
    const current = readIfExists(file.path);
    if (current === undefined) {
      actions.push({ kind: 'skip', path: rel, detail: 'already gone' });
      continue;
    }
    if (sha256(current) !== file.sha256) {
      actions.push({ kind: 'skip', path: rel, detail: 'changed since init, left alone' });
      continue;
    }
    rmSync(file.path, { force: true });
    actions.push({ kind: 'remove', path: rel, detail: 'removed' });
    if (file.path.endsWith('pre-commit')) {
      hookRemoved = true;
    }
  }

  // Only restore an adopted hook if the umbrella hook that replaced it was
  // actually removed just now. Putting the old hook back next to a hook the
  // user has since edited would give them two.
  if (manifest.adopted !== null && hookRemoved) {
    mkdirSync(path.dirname(manifest.adopted.path), { recursive: true });
    writeFileSync(manifest.adopted.path, manifest.adopted.content, 'utf8');
    chmodSync(manifest.adopted.path, 0o755);
    actions.push({
      kind: 'restore',
      path: path.relative(root, manifest.adopted.path).split(path.sep).join('/'),
      detail: `restored ${manifest.adopted.product}'s own hook`,
    });
  }

  rmSync(manifestPath, { force: true });
  actions.push({ kind: 'remove', path: MANIFEST_RELATIVE_PATH, detail: 'removed' });
  try {
    rmSync(path.dirname(manifestPath), { recursive: false });
  } catch {
    // The directory holds something else. Leaving it is the correct
    // "nothing else" behaviour.
  }

  return { ok: true, actions, conflicts };
}

export function renderInitHuman(result: InitResult): string {
  const lines: string[] = [];

  if (result.conflicts.length > 0) {
    lines.push('compass init: nothing was written.');
    for (const conflict of result.conflicts) {
      lines.push(`  ${conflict.path} (${conflict.reason})`);
      lines.push(`    ${conflict.guidance}`);
    }
    return lines.join('\n');
  }

  if (result.alreadyInstalled) {
    lines.push('compass init: already installed; nothing to do.');
  } else {
    lines.push(
      result.dryRun ? 'compass init (dry run): would write' : 'compass init: wrote'
    );
  }
  for (const action of result.actions) {
    const verb = action.kind === 'skip' ? 'skip' : result.dryRun ? 'would write' : 'wrote';
    lines.push(`  ${verb} ${action.path} (${action.detail})`);
  }
  return lines.join('\n');
}

export function renderRevertHuman(result: RevertResult): string {
  const lines: string[] = [];
  if (result.conflicts.length > 0) {
    lines.push('compass init --revert: nothing was removed.');
    for (const conflict of result.conflicts) {
      lines.push(`  ${conflict.path} (${conflict.reason})`);
      lines.push(`    ${conflict.guidance}`);
    }
    return lines.join('\n');
  }
  lines.push('compass init --revert:');
  for (const action of result.actions) {
    lines.push(`  ${action.kind} ${action.path} (${action.detail})`);
  }
  return lines.join('\n');
}
