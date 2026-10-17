// Finding the spec that stands in for a frozen intent contract.
//
// The intent gate's native flow wants a contract approved before the work
// starts. That is a per-task human step, and it is the one piece of ceremony
// the whole v0.2 design exists to remove from a pull request. So when a
// repository has no frozen contract of its own, the umbrella looks for the
// document the work was actually approved from, which in this org is a
// superpowers spec under docs/superpowers/specs.
//
// Everything here is READ-ONLY and does no subprocess work: it decides which
// file to import, and nothing else. That is what makes the discovery rules
// testable against a directory of empty files instead of against a running
// gate.
//
// Three sources, in order, and the order is the whole decision:
//
//  1. `--spec` on the umbrella's command line. Somebody typed this just now,
//     so it outranks everything, including a checked-in contract. A path
//     here that does not exist is REPORTED rather than replaced by a
//     discovered one: running a different contract than the one a person
//     just named is the wrong kindness.
//
//  2. A `Spec:` line in the pull request body. Written by whoever opened the
//     pull request, which is a weaker claim than a command line typed now,
//     and a path here that does not exist FALLS THROUGH to the convention. A
//     typo in a pull request description must not be able to fail a build.
//     The one value that does not fall through is the exact token `none`,
//     which WAIVES the import: it is a statement rather than a path, and an
//     explicit statement beats the inferred convention below.
//
//  3. The convention: a markdown file directly under docs/superpowers/specs
//     whose name matches the branch on WHOLE WORDS (selectByBranch below).
//     Directly under, not nested, because that is the layout intent-guard's
//     own importer discovers and an archive subdirectory is not a candidate
//     for this branch's contract.

import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';

export const SPEC_DIR = 'docs/superpowers/specs';
export const PLAN_DIR = 'docs/superpowers/plans';

export type SpecDiscovery =
  /** Found, with the source that won. Paths are repository-relative. */
  | { kind: 'flag' | 'pr-body'; spec: string; plan: string | null }
  /** Found by the branch-name convention, with how it was chosen. */
  | { kind: 'convention'; spec: string; plan: string | null; match: ConventionMatch }
  /** `--spec` named a file that is not there. Never silently replaced. */
  | { kind: 'missing-flag'; spec: string }
  /** The pull request body said `Spec: none`: there is nothing to import. */
  | { kind: 'waived' }
  /**
   * The convention spec, or the plan for any spec, resolves outside the
   * repository (its directory is a symlink pointing out of the checkout).
   * Refused rather than read, and rather than dropped: the gate is reported
   * as unable to run, never as having nothing to check.
   */
  | { kind: 'escaped'; path: string }
  /** Nothing found. `selection` is present when a branch was available. */
  | { kind: 'none'; selection?: SelectionMiss };

/**
 * The token that turns a `Spec:` line into a waiver.
 *
 * Exact and lowercase. "None" with a capital is somebody writing prose, and
 * a sentence must not be able to switch a gate off; an unusable value that
 * is not this token keeps falling through to the convention, silently, the
 * way every other unusable value does.
 */
export const SPEC_WAIVER_TOKEN = 'none';

export interface SpecDiscoveryOptions {
  repoRoot: string;
  /** `--spec` on the umbrella's command line, repository-relative or absolute. */
  spec?: string;
  /** The pull request body, when this run has one. */
  prBody?: string;
  /** The branch name the slug is derived from. */
  branch?: string;
}

/**
 * The branch name with its prefix removed.
 *
 * Only the FIRST segment goes. Dropping everything but the last would turn
 * `feat/online/widget-cache` into `widget-cache` and match a spec about a
 * different feature, and the prefix convention (`feat/`, `fix/`) is exactly
 * one segment deep.
 */
export function branchSlug(branch: string): string {
  const slash = branch.indexOf('/');
  return slash === -1 ? branch : branch.slice(slash + 1);
}

/**
 * A spec or plan filename reduced to the part that identifies the feature.
 *
 * The date prefix and the `-design` suffix are the two pieces of the
 * superpowers naming convention that carry no identity: the same feature's
 * spec and plan differ by exactly those, which is how intent-guard's own
 * importer pairs them.
 */
export function normalizeStem(fileName: string): string {
  const stem = fileName.replace(/\.md$/i, '');
  return stem.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/-design$/, '');
}

/**
 * The shortest token that can be evidence for a binding.
 *
 * Two-letter tokens (pr, ci, ui, db, v2) are the shape of the dogfood failure
 * this rule exists to close, and they recur across unrelated work. Three
 * keeps the short domain words a team actually names features after (api,
 * cli, osv).
 */
export const MIN_TOKEN_LENGTH = 3;

/**
 * Words that appear in branch and spec names because of the naming
 * convention, not because of the feature. Closed and pinned exactly by a
 * test. A stop word is ignored as EVIDENCE, never deleted from a sequence: it
 * still occupies its position for the contiguity test.
 */
export const STOP_WORDS: readonly string[] = Object.freeze([
  // Change-type words
  'feat', 'feature', 'fix', 'bugfix', 'hotfix', 'chore', 'docs',
  'refactor', 'test', 'tests', 'wip', 'release', 'build', 'perf',
  'style', 'revert', 'deps', 'bump',
  // Convention words
  'design', 'spec', 'specs', 'plan', 'draft', 'review', 'followup',
  'temp', 'tmp',
  // Function words
  'and', 'the', 'for', 'with', 'from', 'into', 'onto', 'per', 'via', 'not',
  'add', 'use', 'new', 'more', 'misc',
]);

const STOP_WORD_SET: ReadonlySet<string> = new Set(STOP_WORDS);

/**
 * A branch slug or a spec stem as a sequence of whole words.
 *
 * ASCII letters only are folded, never toLowerCase(): that maps U+212A
 * KELVIN SIGN to an ASCII k, so a branch spelled with one would fold into an
 * ASCII word and could bind a spec. The delimiters are ASCII only for the
 * same reason, never \s, which also matches Unicode whitespace git allows in
 * a ref name (U+00A0 and the rest). A non-ASCII character therefore survives
 * unchanged inside its token, and the charset rule in isSignificant keeps
 * that token from ever counting. A dot is not a delimiter: 1.2.1 is one token.
 */
export function tokens(text: string): string[] {
  return text
    .replace(/[A-Z]/g, (letter) => String.fromCharCode(letter.charCodeAt(0) + 32))
    .split(/[-_/ \t\n\r\f\v]+/)
    .filter((token) => token !== '');
}

/**
 * Whether a token can be evidence for a binding: three or more characters,
 * letters digits and dots only, at least one letter, and not a stop word.
 * The charset rule is also what keeps every word the report prints as
 * "shared" free of markup, whatever the head branch was called.
 */
export function isSignificant(token: string): boolean {
  return (
    token.length >= MIN_TOKEN_LENGTH &&
    /^[a-z0-9.]+$/.test(token) &&
    /[a-z]/.test(token) &&
    !STOP_WORD_SET.has(token)
  );
}

/** Where `needle` sits as one contiguous run of `haystack`, or -1. */
function runAt(haystack: string[], needle: string[]): number {
  for (let start = 0; start + needle.length <= haystack.length; start++) {
    if (needle.every((token, offset) => haystack[start + offset] === token)) {
      return start;
    }
  }
  return -1;
}

function candidateOnTokens(
  slug: string[],
  stem: string[]
): { exact: boolean; shared: string[] } | null {
  if (slug.length === 0 || stem.length === 0) {
    return null;
  }
  const [longer, shorter] = slug.length >= stem.length ? [slug, stem] : [stem, slug];
  if (runAt(longer, shorter) === -1) {
    return null;
  }
  const shared = shorter.filter(isSignificant);
  if (shared.length === 0) {
    return null;
  }
  return { exact: slug.length === stem.length, shared };
}

/**
 * Whether a spec stem is a candidate for a branch slug, and on what words.
 *
 * The shorter token sequence must appear as ONE CONTIGUOUS RUN of the longer,
 * compared token by token, in either direction, and that run must hold a
 * significant token. This is the old substring test moved from characters to
 * whole tokens and nothing looser: on tokens(x).join("-") of both sides,
 * every candidate here is one the substring rule also accepts.
 */
export function candidateRun(slug: string, stem: string): { exact: boolean; shared: string[] } | null {
  return candidateOnTokens(tokens(slug), tokens(stem));
}

/** How a convention selection was made, carried to every report surface. */
export interface ConventionMatch {
  strength: 'exact' | 'strong' | 'weak';
  weakBecause: Array<'single-token' | 'length-tiebreak'>;
  /** The significant tokens of the shared run, charset-restricted. */
  shared: string[];
  /** The next stem group's member, if any. */
  runnerUp: string | null;
  /** The runner-up's shared significant tokens, for the length-tiebreak wording. */
  runnerUpShared: string[];
  /**
   * What 0.10.0's substring rule would have chosen, when that differs from
   * this choice; null when it is the same file. Reporting only.
   */
  legacy: string | null;
}

/** Why the convention chose nothing, when a branch was available. */
export interface SelectionMiss {
  why: 'no-usable-token' | 'no-candidate' | 'ambiguous';
  /** Ambiguous only: every tied group's member, sorted lexically, in full. */
  tied: string[];
  /** What 0.10.0's substring rule would have chosen. Reporting only. */
  legacy: string | null;
}

export type BranchSelection =
  | ({ kind: 'selected'; name: string } & ConventionMatch)
  | ({ kind: 'none' } & SelectionMiss);

/**
 * 0.10.0's convention rule, verbatim: a character substring test in either
 * direction, then an exact stem, the longer stem, the lexically greatest
 * filename. Kept for one minor release for the legacy sentence in the report
 * and for nothing else; it never selects.
 */
function legacySelection(names: string[], slug: string): string | null {
  const contains = (stem: string): boolean =>
    stem !== '' && slug !== '' && (stem.includes(slug) || slug.includes(stem));
  const ranked = names
    .filter((name) => contains(normalizeStem(name)))
    .sort((a, b) => {
      const stemA = normalizeStem(a);
      const stemB = normalizeStem(b);
      const exactA = stemA === slug ? 0 : 1;
      const exactB = stemB === slug ? 0 : 1;
      if (exactA !== exactB) {
        return exactA - exactB;
      }
      if (stemA.length !== stemB.length) {
        return stemB.length - stemA.length;
      }
      return a < b ? 1 : a > b ? -1 : 0;
    });
  return ranked[0] ?? null;
}

interface ScoredGroup {
  member: string;
  exact: boolean;
  shared: string[];
  longest: number;
}

function compareScore(a: ScoredGroup, b: ScoredGroup): number {
  if (a.exact !== b.exact) {
    return a.exact ? -1 : 1;
  }
  if (a.shared.length !== b.shared.length) {
    return b.shared.length - a.shared.length;
  }
  return b.longest - a.longest;
}

/**
 * The branch-name convention's choice among `names` (spec filenames), the one
 * function both selection paths call, on the working tree and at the trust
 * base.
 *
 * Candidates are grouped by their folded stem sequence; a group's member is
 * its lexically greatest filename. Groups are ranked by an exact sequence,
 * then the number of significant shared tokens, then the length of the
 * longest one. A tie on all three between the top two groups chooses
 * NOTHING: every key the old code used after the first was a guess about
 * which feature the branch meant, and a tie on everything this measures is
 * the code saying it does not know.
 */
export function selectByBranch(names: string[], branch: string): BranchSelection {
  const rawSlug = branchSlug(branch);
  const slug = tokens(rawSlug);
  const oldAnswer = legacySelection(names, rawSlug);

  if (!slug.some(isSignificant)) {
    return { kind: 'none', why: 'no-usable-token', tied: [], legacy: oldAnswer };
  }

  const groups = new Map<string, ScoredGroup>();
  for (const name of [...names].sort()) {
    const stem = tokens(normalizeStem(name));
    const run = candidateOnTokens(slug, stem);
    if (run === null) {
      continue;
    }
    // Sorted ascending, so a later name in the same group replaces an
    // earlier one: the member is the lexically greatest filename.
    groups.set(JSON.stringify(stem), {
      member: name,
      exact: run.exact,
      shared: run.shared,
      longest: Math.max(...run.shared.map((token) => token.length)),
    });
  }

  const ranked = [...groups.values()].sort(
    (a, b) => compareScore(a, b) || (a.member < b.member ? -1 : a.member > b.member ? 1 : 0)
  );
  const top = ranked[0];
  if (top === undefined) {
    return { kind: 'none', why: 'no-candidate', tied: [], legacy: oldAnswer };
  }
  const second = ranked[1];
  if (second !== undefined && compareScore(top, second) === 0) {
    const tied = ranked.filter((group) => compareScore(top, group) === 0).map((group) => group.member);
    return { kind: 'none', why: 'ambiguous', tied: tied.sort(), legacy: oldAnswer };
  }

  const weakBecause: ConventionMatch['weakBecause'] = [];
  if (!top.exact) {
    if (top.shared.length === 1) {
      weakBecause.push('single-token');
    }
    if (second !== undefined && second.exact === top.exact && second.shared.length === top.shared.length) {
      weakBecause.push('length-tiebreak');
    }
  }
  return {
    kind: 'selected',
    name: top.member,
    strength: top.exact ? 'exact' : weakBecause.length > 0 ? 'weak' : 'strong',
    weakBecause,
    shared: top.shared,
    runnerUp: second?.member ?? null,
    runnerUpShared: second?.shared ?? [],
    legacy: oldAnswer === top.member ? null : oldAnswer,
  };
}

/**
 * The path named by a `Spec:` line in a pull request body.
 *
 * Anchored to the start of a line on purpose: a sentence that happens to
 * contain "the Spec: value" in prose is not somebody naming a file, and
 * treating it as one would silently swap the contract a pull request is
 * checked against.
 *
 * The FIRST such line wins when a body carries two. Not a deep decision, but
 * it has to be a decision rather than whatever the regex happened to do: a
 * pull request edited to add a second line above the first would otherwise
 * change contract without the diff showing it.
 */
export function specFromPrBody(body: string): string | null {
  const match = /^Spec:\s*(\S+)/m.exec(body);
  return match === null ? null : match[1];
}

/** `pull_request.body` out of a GitHub event payload, or null. */
export function prBodyFromEvent(eventPath: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(eventPath, 'utf8'));
  } catch {
    // A missing, unreadable or malformed payload is not an error here. It
    // means this run has no pull request body to read, which is the ordinary
    // case outside a pull request.
    return null;
  }
  if (parsed === null || typeof parsed !== 'object') {
    return null;
  }
  const pull = (parsed as { pull_request?: unknown }).pull_request;
  if (pull === null || typeof pull !== 'object') {
    return null;
  }
  const body = (pull as { body?: unknown }).body;
  return typeof body === 'string' ? body : null;
}

/** Markdown files directly under `dir`, sorted lexically. Never throws. */
function markdownFilesIn(repoRoot: string, dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(path.join(repoRoot, dir), { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.md$/i.test(entry.name))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
  return entries.sort();
}

function exists(repoRoot: string, relative: string): boolean {
  try {
    readFileSync(path.join(repoRoot, relative));
    return true;
  } catch {
    return false;
  }
}

/**
 * The plan belonging to a spec.
 *
 * The stem must be EQUAL, not merely related. The loose rule paired one
 * feature's spec with another feature's plan, which freezes a set of
 * requirements against a change budget belonging to different work: the
 * resulting block or pass is about neither of them. No plan is a fine
 * outcome, since intent-guard imports a spec on its own; the wrong plan is
 * not.
 *
 * Applied to any spec, however it was chosen, rather than only to a
 * conventionally discovered one: a spec named in a pull request body has a
 * plan beside it just as often.
 */
function planFor(repoRoot: string, specPath: string): { plan: string | null } | { escaped: string } {
  const specStem = normalizeStem(path.basename(specPath));
  const matches = markdownFilesIn(repoRoot, PLAN_DIR).filter(
    (name) => normalizeStem(name) === specStem
  );
  const newest = matches[matches.length - 1];
  if (newest === undefined) {
    return { plan: null };
  }
  const plan = `${PLAN_DIR}/${newest}`;
  // Held to the repository like the convention spec: a plans directory
  // linked out of the checkout is refused, never read and never dropped.
  return resolvesInsideRoot(repoRoot, plan) ? { plan } : { escaped: plan };
}

/** A found spec with its plan, or the refusal for a plan that escapes. */
function withPlan(repoRoot: string, kind: 'flag' | 'pr-body', spec: string): SpecDiscovery {
  const found = planFor(repoRoot, spec);
  return 'escaped' in found ? { kind: 'escaped', path: found.escaped } : { kind, spec, plan: found.plan };
}

/** The same, for a convention spec, which carries how it was chosen. */
function conventionWithPlan(repoRoot: string, spec: string, match: ConventionMatch): SpecDiscovery {
  const found = planFor(repoRoot, spec);
  return 'escaped' in found
    ? { kind: 'escaped', path: found.escaped }
    : { kind: 'convention', spec, plan: found.plan, match };
}

/** The match record of a selection, without its discriminant and name. */
export function matchOf(selection: Extract<BranchSelection, { kind: 'selected' }>): ConventionMatch {
  return {
    strength: selection.strength,
    weakBecause: selection.weakBecause,
    shared: selection.shared,
    runnerUp: selection.runnerUp,
    runnerUpShared: selection.runnerUpShared,
    legacy: selection.legacy,
  };
}

/** Normalizes a user-supplied path to a repository-relative one. */
function relativeToRoot(repoRoot: string, candidate: string): string {
  const relative = path.isAbsolute(candidate)
    ? path.relative(repoRoot, candidate)
    : path.normalize(candidate);
  return relative.split(path.sep).join('/');
}

/**
 * Whether a repository-relative path names a file that is really inside the
 * repository.
 *
 * Only the pull request body is held to this. That body is written by whoever
 * opened the pull request, and on a FORK pull request that is somebody with
 * no write access at all: without the check, a `Spec: ../../etc/something`
 * line imports an arbitrary readable file from the runner into a contract,
 * and its path then appears in `contractSource` and in the `--approved-by`
 * string.
 *
 * The test is on the RESOLVED path, not on the spelling. Testing the string
 * left a two-step route to the same escape, and one pull request can take
 * both steps: on a `pull_request` event `actions/checkout` checks out the
 * merge ref, so a fork's own commits are in the tree, and the same pull
 * request can add a symlink pointing outside AND the `Spec:` line naming it.
 * To a string test that line is an ordinary relative path.
 *
 * A path that will not resolve at all -- a dangling symlink, a missing file,
 * a directory nothing may read -- is not contained either, which lands it in
 * the same place as a path that is simply not there: fall through to the
 * convention.
 *
 * This is containment, NOT a ban on symlinks. One pointing at a file inside
 * the repository resolves inside it and is used, because a repository that
 * keeps its specs behind a link is doing something ordinary.
 *
 * `--spec` is deliberately NOT held to any of this. A person typed that on
 * the command line just now, and pointing at a spec kept outside the checkout
 * is a real thing to want.
 */
function resolvesInsideRoot(repoRoot: string, relative: string): boolean {
  try {
    // The root is resolved too. On macOS a temporary directory reaches the
    // caller through a symlink, so comparing a resolved candidate against an
    // unresolved root would report every path in such a tree as an escape.
    const root = realpathSync(repoRoot);
    const resolved = realpathSync(path.join(repoRoot, relative));
    const inside = path.relative(root, resolved);
    return inside !== '' && !inside.startsWith(`..${path.sep}`) && inside !== '..' && !path.isAbsolute(inside);
  } catch {
    return false;
  }
}

export function discoverSpec(options: SpecDiscoveryOptions): SpecDiscovery {
  const { repoRoot } = options;

  if (options.spec !== undefined) {
    const relative = relativeToRoot(repoRoot, options.spec);
    if (!exists(repoRoot, relative)) {
      return { kind: 'missing-flag', spec: relative };
    }
    return withPlan(repoRoot, 'flag', relative);
  }

  if (options.prBody !== undefined) {
    const named = specFromPrBody(options.prBody);
    if (named === SPEC_WAIVER_TOKEN) {
      // Before the convention, because an explicit statement beats an
      // inferred one: whoever opened the pull request said there is no spec
      // to import, and the branch happening to share a name with a file
      // under docs/superpowers/specs does not overrule that. It is NOT
      // before a frozen native contract, which prepareIntent still checks
      // first: a waiver says "nothing to import", not "check nothing".
      return { kind: 'waived' };
    }
    if (named !== null) {
      const relative = relativeToRoot(repoRoot, named);
      // A path out of the tree is treated exactly as a path that is not
      // there: fall through to the convention. Same posture, same reason, and
      // it keeps an unusable Spec: line from being able to silence the gate.
      // Containment subsumes existence here, since a path that does not
      // resolve is not contained.
      if (resolvesInsideRoot(repoRoot, relative)) {
        return withPlan(repoRoot, 'pr-body', relative);
      }
    }
  }

  if (options.branch !== undefined) {
    const selection = selectByBranch(markdownFilesIn(repoRoot, SPEC_DIR), options.branch);
    if (selection.kind === 'none') {
      return {
        kind: 'none',
        selection: { why: selection.why, tied: selection.tied, legacy: selection.legacy },
      };
    }
    const relative = `${SPEC_DIR}/${selection.name}`;
    // The convention spec is held to the repository too: a specs directory
    // linked out of the checkout is refused, never imported. Only --spec is
    // exempt, as a path a person typed.
    if (!resolvesInsideRoot(repoRoot, relative)) {
      return { kind: 'escaped', path: relative };
    }
    return conventionWithPlan(repoRoot, relative, matchOf(selection));
  }

  return { kind: 'none' };
}
