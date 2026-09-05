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
//     whose name relates to the branch. Directly under, not nested, because
//     that is the layout intent-guard's own importer discovers and an
//     archive subdirectory is not a candidate for this branch's contract.

import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';

export const SPEC_DIR = 'docs/superpowers/specs';
export const PLAN_DIR = 'docs/superpowers/plans';

export type SpecDiscovery =
  /** Found, with the source that won. Paths are repository-relative. */
  | { kind: 'flag' | 'pr-body' | 'convention'; spec: string; plan: string | null }
  /** `--spec` named a file that is not there. Never silently replaced. */
  | { kind: 'missing-flag'; spec: string }
  /** The pull request body said `Spec: none`: there is nothing to import. */
  | { kind: 'waived' }
  | { kind: 'none' };

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

/** Whether a normalized stem and a slug name the same work. */
export function stemMatches(stem: string, slug: string): boolean {
  if (stem === '' || slug === '') {
    return false;
  }
  return stem.includes(slug) || slug.includes(stem);
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
 * The best of the candidates whose stem relates to `target`, or undefined.
 *
 * `stemMatches` decides who is a CANDIDATE; this decides who wins, and the
 * two are different questions. Ranking on the lexically newest filename alone
 * was answering the second with the first: a loose candidate carrying a later
 * date beat the spec whose stem was the branch slug exactly, and an undated
 * name beat everything because it sorts after every date. A pull request was
 * then measured against a different feature's requirements, with nothing in
 * the report saying so, since naming the spec it used is exactly what the
 * report does.
 *
 * So: an exact stem first, then the most specific stem, and only then the
 * newest name. Specificity is stem LENGTH, which is crude but is the property
 * the failure actually had: "superpowers" beat
 * "1.2.1-base-and-superpowers" by being shorter and vaguer.
 */
function bestMatch(names: string[], target: string): string | undefined {
  return names
    .filter((name) => stemMatches(normalizeStem(name), target))
    .sort((a, b) => {
      const stemA = normalizeStem(a);
      const stemB = normalizeStem(b);
      const exactA = stemA === target ? 0 : 1;
      const exactB = stemB === target ? 0 : 1;
      if (exactA !== exactB) {
        return exactA - exactB;
      }
      if (stemA.length !== stemB.length) {
        return stemB.length - stemA.length;
      }
      // Newest name last in lexical order, so descending puts it first. The
      // names carry an ISO date prefix, so this is date order among equally
      // good candidates and nothing more.
      return a < b ? 1 : a > b ? -1 : 0;
    })[0];
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
function planFor(repoRoot: string, specPath: string): string | null {
  const specStem = normalizeStem(path.basename(specPath));
  const matches = markdownFilesIn(repoRoot, PLAN_DIR).filter(
    (name) => normalizeStem(name) === specStem
  );
  const newest = matches[matches.length - 1];
  return newest === undefined ? null : `${PLAN_DIR}/${newest}`;
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
    return { kind: 'flag', spec: relative, plan: planFor(repoRoot, relative) };
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
        return { kind: 'pr-body', spec: relative, plan: planFor(repoRoot, relative) };
      }
    }
  }

  if (options.branch !== undefined) {
    const best = bestMatch(markdownFilesIn(repoRoot, SPEC_DIR), branchSlug(options.branch));
    if (best !== undefined) {
      const relative = `${SPEC_DIR}/${best}`;
      return { kind: 'convention', spec: relative, plan: planFor(repoRoot, relative) };
    }
  }

  return { kind: 'none' };
}
