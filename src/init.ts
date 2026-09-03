// `conductor init`: one policy file, one pre-commit hook, one manifest.
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
//     blocked. A hook written the natural way, `if conductor run; then exit
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
//
//  5. NEVER WRITE INTO A HOOK MANAGER'S GENERATED DIRECTORY. Where git
//     looks and where the hook a human maintains lives are not always the
//     same file. husky 9 sets core.hooksPath to .husky/_, a generated and
//     gitignored directory it rewrites on every install; the file git
//     executes there is a dispatcher that execs the TRACKED hook one
//     directory up. Reading the dispatcher reports the repository's real
//     gate hook as foreign, so --adopt cannot adopt it, and writing the
//     dispatcher puts the umbrella hook somewhere the next install deletes
//     without a word. Found by running this tool against a real husky 9
//     repository, which is the only way it could have been found: every
//     fixture in the suite agreed with the code.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  rmSync,
  rmdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { GATE_ROLES, POLICY_FILE_NAME, PRODUCT_FOR_ROLE } from './policy.js';
import type { GateRole, Product } from './policy.js';
import { CANDIDATES } from './resolve.js';

export { POLICY_FILE_NAME };

/** The one string that says "conductor init wrote this". */
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

/**
 * Hook managers whose installed pre-commit file is GENERATED rather than
 * written by a human. Every one of these rewrites that file on install, so
 * it is never the file the umbrella may write into.
 *
 * The same four names dep-guard's and vault-guard's inits use, so the
 * family says one thing. The difference is that those take the manager as
 * a flag, and this one detects it: the umbrella's whole job is to be run
 * once in a repository somebody else already wired up.
 */
export type HookManager = 'native' | 'husky' | 'lefthook' | 'precommit';

/**
 * The `.husky` directory whose generated subdirectory git has been pointed
 * at, or null when this is not that arrangement.
 *
 * Three conditions, ALL required, and the reason all three are required is
 * a regression this function shipped with. An earlier version also accepted
 * the hooks directory on the CONTENT of the pre-commit file in it, matching
 * the line that sources husky's shim. That line appears in two completely
 * different places:
 *
 *   husky 9  core.hooksPath = .husky/_   .husky/_/pre-commit sources _/h
 *            and IS a dispatcher; the tracked hook is .husky/pre-commit.
 *
 *   husky 8  core.hooksPath = .husky     .husky/pre-commit sources
 *            _/husky.sh as a PREAMBLE and IS the tracked hook already.
 *
 * So on husky 8 the content signal fired against the tracked hook itself,
 * and the "one directory up" rule then pointed at the parent of .husky,
 * which is the repository root. Init wrote a pre-commit file there, saw no
 * gate hook because it never read the real one, reported success, and left
 * every commit ungated. Content of the pre-commit file is never sufficient
 * on its own, and the tracked target is this `.husky` directory rather than
 * a computed parent of whatever directory git happens to point at.
 *
 * The confirming file is `h` (husky 9) or `husky.sh` (husky 8 kept one
 * there too), beside the dispatcher in the generated directory. It is what
 * makes this an installed husky rather than a directory named `_`.
 */
function huskyDirectoryFor(hooksDir: string): string | null {
  if (path.basename(hooksDir) !== '_') {
    return null;
  }
  const huskyDir = path.dirname(hooksDir);
  if (path.basename(huskyDir) !== '.husky') {
    return null;
  }
  if (!isFile(path.join(hooksDir, 'h')) && !isFile(path.join(hooksDir, 'husky.sh'))) {
    return null;
  }
  return huskyDir;
}

/**
 * lefthook stamps a version checksum into the script it generates, and the
 * pre-commit framework stamps a URL. Both are their own installers' marks,
 * which is what makes these exact rather than a guess.
 */
function detectGeneratedHook(content: string): Exclude<HookManager, 'native' | 'husky'> | null {
  if (content.includes('lefthook_version:') || content.includes('call_lefthook')) {
    return 'lefthook';
  }
  if (content.includes('File generated by pre-commit: https://pre-commit.com')) {
    return 'precommit';
  }
  return null;
}

function generatedHookGuidance(manager: 'lefthook' | 'precommit', relPath: string): string {
  const owner = manager === 'lefthook' ? 'lefthook' : 'the pre-commit framework';
  const config = manager === 'lefthook' ? 'lefthook-local.yml' : '.pre-commit-config.yaml';
  const stanza =
    manager === 'lefthook'
      ? 'add "conductor:" under pre-commit.commands with "run: conductor run --staged"'
      : 'add a local hook entry running "conductor run --staged" to its repos: list';
  return (
    `${relPath} is generated by ${owner}, which rewrites it on every install, so anything ` +
    `written there is lost without a word. Nothing was changed. To run the umbrella under ` +
    `${owner}, ${stanza} in ${config}. Note that ${owner} owns the commit's exit code, so the ` +
    "umbrella's 1 (a gate blocked) and 2 (a gate could not run) do not survive it."
  );
}

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
# Installed by "conductor init". Remove it with "conductor init --revert".
#
# No "set -e" of its own, and written to survive somebody else's. Under
# "set -e" a shell exits at the failing command before its status can be
# captured, which keeps the exit code but loses the explanatory line, so a
# blocked commit prints nothing about why. husky's dispatcher runs this
# file as "sh -e", so every command allowed to fail is in a condition
# context rather than standing alone.
#
# "command -v" rather than "which": "which" is not in POSIX, is absent from
# some minimal images, and reports success in some shells for a builtin
# that is not an executable.

# A conductor installed only as a devDependency of this repository is not
# on PATH, and was invisible to its own hook until this line existed: every
# commit reported the umbrella missing and blocked, which is the right
# answer to the wrong question. The root comes from git rather than from
# the working directory: git runs a pre-commit hook from the top level
# today, but a hook invoked by hand or by another manager can start in a
# subdirectory, where a relative "node_modules/.bin" points at nothing.
conductor_root=$(git rev-parse --show-toplevel 2>/dev/null) || conductor_root=""
if [ -n "$conductor_root" ] && [ -d "$conductor_root/node_modules/.bin" ]; then
  PATH="$conductor_root/node_modules/.bin:$PATH"
  export PATH
fi

if ! command -v conductor >/dev/null 2>&1; then
  echo "conductor: command not found, so this commit was NOT checked by any guardrail gate. Install the umbrella, or run 'conductor init --revert' to remove this hook." >&2
  exit 1
fi

conductor_status=0
conductor run --staged || conductor_status=$?

if [ "$conductor_status" -ne 0 ]; then
  echo "conductor: commit blocked (conductor exit $conductor_status). Review the report above; 'git commit --no-verify' bypasses this hook at your own risk." >&2
fi

# Passed straight through. 1 means a gate blocked; 2 means a gate could not
# run at all. Collapsing 2 into 1 would report findings never looked for.
exit "$conductor_status"
`;

export type ConflictReason =
  | 'not-a-git-repository'
  | 'foreign-hook'
  | 'gate-hook'
  | 'generated-hook'
  | 'hooks-path-outside-repository'
  | 'no-manifest'
  | 'changed-since-init'
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
  /**
   * Which hook manager owns this repository's pre-commit hook, as detected.
   * `husky` means hookPath is the TRACKED file rather than the generated
   * one git executes.
   */
  hookManager: HookManager;
  repoRoot: string;
  adoptedFrom: AdoptedHook | null;
  /** Contents to write, keyed by absolute path. Empty on a dry run's apply. */
  writes: Array<{
    path: string;
    content: string;
    executable: boolean;
    kind: 'hook' | 'policy';
  }>;
}

export interface InitOptions {
  cwd: string;
  /** PATH used for gate detection. Injected so tests never depend on the machine. */
  pathValue: string;
  dryRun?: boolean;
  /** Replace a per-gate hook with the umbrella's. Never replaces a foreign one. */
  adopt?: boolean;
  /** Revert only: remove a file that has changed since init anyway. */
  force?: boolean;
}

interface ManifestFile {
  path: string;
  sha256: string;
  /**
   * What this file is to the umbrella. Recorded rather than inferred from
   * the path, because revert's whole decision turns on whether the HOOK
   * survived, and sniffing that from a filename is a guess.
   */
  kind: 'hook' | 'policy';
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

/**
 * Existence as a plain file, with no opinion about the executable bit.
 * husky's shim is copied out of the package with whatever mode the tarball
 * carried, and it is sourced rather than executed, so requiring +x here
 * would make detection depend on something husky does not guarantee.
 */
function isFile(file: string): boolean {
  try {
    return statSync(file).isFile();
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
        `  # not found in node_modules/.bin or on PATH. Install ${product}, then set enabled: true.`
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
    `${relPath} already exists and was not written by conductor init. Merge "conductor run --staged" ` +
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
    hookManager: 'native',
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

  // What git executes. Under husky this is a generated dispatcher rather
  // than the hook anybody maintains, so it decides the manager and then
  // stops being the file this function is about.
  const executedHookPath = path.join(hooks.dir, 'pre-commit');
  const executedHook = readIfExists(executedHookPath);

  // The redirect fires only on husky's OWN generated directory, confirmed
  // by the shim husky leaves in it. The tracked hook is then that .husky
  // directory's own pre-commit, which is what husky's shim runs:
  // `s=$(dirname "$(dirname "$0")")/$n`. Never a computed parent of an
  // arbitrary hooks directory, and never decided by the content of the file
  // git executes: on husky 8 that file IS the tracked hook.
  const huskyDir = huskyDirectoryFor(hooks.dir);
  const husky = huskyDir !== null;

  if (!husky && executedHook !== undefined) {
    const generatedBy = detectGeneratedHook(executedHook);
    if (generatedBy !== null) {
      const rel = path.relative(root, executedHookPath).split(path.sep).join('/');
      conflicts.push({
        path: rel,
        reason: 'generated-hook',
        guidance: generatedHookGuidance(generatedBy, rel),
      });
      return { ...base, repoRoot: root, hookPath: executedHookPath, hookManager: generatedBy };
    }
  }

  const hookManager: HookManager = husky ? 'husky' : 'native';
  const hookPath = huskyDir === null ? executedHookPath : path.join(huskyDir, 'pre-commit');
  const relHook = path.relative(root, hookPath).split(path.sep).join('/');
  const policyPath = path.join(root, POLICY_FILE_NAME);
  const manifestPath = path.join(root, MANIFEST_RELATIVE_PATH);

  // Under husky this is the TRACKED file, never the dispatcher: reading the
  // dispatcher reported a real gate hook as foreign, which is exactly what
  // made --adopt unable to adopt it.
  const existingHook = readIfExists(hookPath);
  let adoptedFrom: AdoptedHook | null = null;

  if (existingHook !== undefined && existingHook.includes(MANAGED_HOOK_MARKER)) {
    // Nothing to do for the hook. The policy file is still checked below,
    // so a repository whose policy file was deleted can get it back.
    actions.push({ kind: 'skip', path: relHook, detail: 'already installed by conductor init' });
  } else if (existingHook !== undefined && existingHook.trim().length > 0) {
    const gateProduct = detectGateHook(existingHook);
    if (gateProduct === null) {
      conflicts.push({ path: relHook, reason: 'foreign-hook', guidance: foreignGuidance(relHook) });
      return { ...base, repoRoot: root, hookPath, hookManager };
    }
    if (!options.adopt) {
      conflicts.push({
        path: relHook,
        reason: 'gate-hook',
        guidance: gateHookGuidance(gateProduct, relHook),
      });
      return { ...base, repoRoot: root, hookPath, hookManager };
    }
    adoptedFrom = { product: gateProduct, content: existingHook };
    actions.push({
      kind: 'write',
      path: relHook,
      detail: `adopt: replace ${gateProduct}'s own hook (restored by --revert)`,
    });
    writes.push({ path: hookPath, content: HOOK, executable: true, kind: 'hook' });
  } else {
    const created = existingHook === undefined ? 'create' : 'replace an empty file';
    actions.push({
      kind: 'write',
      path: relHook,
      // Say the redirect out loud in --dry-run: somebody reading it in a
      // husky repository is entitled to know why the path on screen is not
      // the one core.hooksPath points at.
      detail: husky
        ? `${created}: husky runs ${path
            .relative(root, executedHookPath)
            .split(path.sep)
            .join('/')}, which execs this tracked file`
        : created,
    });
    writes.push({ path: hookPath, content: HOOK, executable: true, kind: 'hook' });
  }

  const existingPolicy = readIfExists(policyPath);
  if (existingPolicy === undefined) {
    writes.push({
      path: policyPath,
      content: renderPolicy(detectGates(root, options.pathValue)),
      executable: false,
      kind: 'policy',
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
    hookManager,
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
      manifest.files.push({ path: write.path, sha256: sha256(write.content), kind: write.kind });
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
 * alone and reported, because that file is now the user's whatever it
 * started as, and a revert that deletes edited work is a revert nobody runs
 * twice. Three rules follow from that, and all three were bugs here first:
 *
 *  1. IF THE HOOK SURVIVES, NOTHING IS REMOVED. Removing the policy file
 *     while leaving an edited hook in place leaves that hook running the
 *     umbrella with nothing to read, so every commit afterwards is refused
 *     with exit 2 -- while revert reported success. The hook is the piece
 *     that depends on the rest, so it decides whether a revert can proceed
 *     at all.
 *
 *  2. THE MANIFEST OUTLIVES A PARTIAL REVERT. It is deleted only once it
 *     holds nothing, because it is the only record of what is left AND, after
 *     an --adopt, the only copy of the gate hook that was replaced. Deleting
 *     it while that content was still needed made the gate's own hook
 *     unrecoverable.
 *
 *  3. A PARTIAL REVERT IS NOT A SUCCESS. It returns ok: false, so the exit
 *     code is non-zero and a script does not read "some of it" as "all of it".
 *
 * `--force` removes a changed file anyway, restoring adopted content if
 * there is any. It is the deliberate way out of every state above.
 */
export function revertInit(options: InitOptions): RevertResult {
  const actions: InitAction[] = [];
  const conflicts: InitConflict[] = [];
  const force = Boolean(options.force);

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
  const relative = (file: string): string => path.relative(root, file).split(path.sep).join('/');

  // Classify first, act second. Deciding as it goes is what let the old
  // version remove the policy file before discovering it could not remove
  // the hook.
  type State = 'gone' | 'match' | 'changed';
  const planned = manifest.files.map((file) => {
    const current = readIfExists(file.path);
    const state: State =
      current === undefined ? 'gone' : sha256(current) === file.sha256 ? 'match' : 'changed';
    return { file, state };
  });

  const blockedHook = planned.find(
    (entry) => entry.file.kind === 'hook' && entry.state === 'changed'
  );

  if (blockedHook !== undefined && !force) {
    const rel = relative(blockedHook.file.path);
    conflicts.push({
      path: rel,
      reason: 'changed-since-init',
      guidance:
        `${rel} has changed since init wrote it, so nothing was removed. Removing the policy ` +
        'file while this hook stays in place would leave it running the umbrella with nothing ' +
        `to read, and every commit would be refused. Re-run with --force to remove ${rel} anyway ` +
        '(any adopted hook is restored), or delete it by hand and re-run.',
    });
    for (const entry of planned) {
      actions.push({
        kind: 'skip',
        path: relative(entry.file.path),
        detail: entry.state === 'changed' ? 'changed since init, left alone' : 'left alone',
      });
    }
    return { ok: false, actions, conflicts };
  }

  const remaining: ManifestFile[] = [];
  let hookRemoved = false;

  for (const { file, state } of planned) {
    const rel = relative(file.path);
    if (state === 'gone') {
      actions.push({ kind: 'skip', path: rel, detail: 'already gone' });
      if (file.kind === 'hook') {
        hookRemoved = true;
      }
      continue;
    }
    if (state === 'changed' && !force) {
      actions.push({ kind: 'skip', path: rel, detail: 'changed since init, left alone' });
      conflicts.push({
        path: rel,
        reason: 'changed-since-init',
        guidance: `${rel} has changed since init wrote it and was left alone. Re-run with --force to remove it anyway.`,
      });
      remaining.push(file);
      continue;
    }
    rmSync(file.path, { force: true });
    actions.push({
      kind: 'remove',
      path: rel,
      detail: state === 'changed' ? 'removed (--force, it had changed)' : 'removed',
    });
    if (file.kind === 'hook') {
      hookRemoved = true;
    }
  }

  // Only restore an adopted hook once the umbrella hook that replaced it is
  // actually gone. Putting the old hook back next to a hook the user has
  // since edited would give them two.
  let adopted = manifest.adopted;
  if (adopted !== null && hookRemoved) {
    mkdirSync(path.dirname(adopted.path), { recursive: true });
    writeFileSync(adopted.path, adopted.content, 'utf8');
    chmodSync(adopted.path, 0o755);
    actions.push({
      kind: 'restore',
      path: relative(adopted.path),
      detail: `restored ${adopted.product}'s own hook`,
    });
    adopted = null;
  }

  if (remaining.length === 0 && adopted === null) {
    rmSync(manifestPath, { force: true });
    actions.push({ kind: 'remove', path: MANIFEST_RELATIVE_PATH, detail: 'removed' });
    try {
      // rmdirSync, not rmSync: rmSync on a directory without recursive: true
      // throws before it removes anything, so this swallowed its own error
      // every time and left an empty .guardrails behind after a revert that
      // said it had removed everything. rmdirSync removes an empty directory
      // and refuses a non-empty one, which is exactly the rule wanted here.
      rmdirSync(path.dirname(manifestPath));
    } catch {
      // The directory holds something else. Leaving it is the correct
      // "nothing else" behaviour.
    }
    return { ok: true, actions, conflicts };
  }

  // Something is left, so the manifest stays and keeps describing it.
  writeFileSync(
    manifestPath,
    `${JSON.stringify({ ...manifest, files: remaining, adopted }, null, 2)}\n`,
    'utf8'
  );
  actions.push({
    kind: 'skip',
    path: MANIFEST_RELATIVE_PATH,
    detail: 'kept: it still records what was left behind',
  });
  return { ok: false, actions, conflicts };
}

export function renderInitHuman(result: InitResult): string {
  const lines: string[] = [];

  if (result.conflicts.length > 0) {
    lines.push('conductor init: nothing was written.');
    for (const conflict of result.conflicts) {
      lines.push(`  ${conflict.path} (${conflict.reason})`);
      lines.push(`    ${conflict.guidance}`);
    }
    return lines.join('\n');
  }

  if (result.alreadyInstalled) {
    lines.push('conductor init: already installed; nothing to do.');
  } else {
    lines.push(
      result.dryRun ? 'conductor init (dry run): would write' : 'conductor init: wrote'
    );
  }
  for (const action of result.actions) {
    const verb = action.kind === 'skip' ? 'skip' : result.dryRun ? 'would write' : 'wrote';
    lines.push(`  ${verb} ${action.path} (${action.detail})`);
  }
  return lines.join('\n');
}

export function renderRevertHuman(result: RevertResult): string {
  const removed = result.actions.filter((action) => action.kind === 'remove').length;
  const lines: string[] = [
    removed === 0
      ? 'conductor init --revert: nothing was removed.'
      : 'conductor init --revert: partly done, see below.',
  ];

  if (result.ok) {
    lines[0] = 'conductor init --revert:';
  }

  for (const action of result.actions) {
    lines.push(`  ${action.kind} ${action.path} (${action.detail})`);
  }

  // The conflicts go LAST rather than first, so the thing the user has to
  // act on is the last line on their terminal rather than scrolled off the
  // top behind a list of what did work.
  for (const conflict of result.conflicts) {
    lines.push('', `  ${conflict.path} (${conflict.reason})`, `    ${conflict.guidance}`);
  }
  return lines.join('\n');
}
