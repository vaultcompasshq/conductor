// Generic, domain-agnostic tokenization shared by the drift scorer.
//
// The goal is NOT perfect NLP. It is a defensible, project-independent way to
// decide whether a changed path or a free-text signal "touches" an out-of-scope
// item or a constraint, without hardcoding any particular project's vocabulary.

// Words that carry no scope meaning. Kept deliberately small and generic.
const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "of", "to", "in", "on", "for", "with",
  "without", "no", "not", "new", "must", "should", "shall", "never", "do",
  "does", "did", "done", "only", "all", "any", "into", "from", "this", "that",
  "these", "those", "is", "are", "be", "been", "being", "explicit", "your",
  "our", "their", "its", "it", "as", "at", "by", "via", "use", "using",
  "add", "added", "adding", "change", "changes", "changed", "etc",
]);

// Generic file/path and code tokens that appear everywhere and therefore
// discriminate nothing. Matching on these produces noise, not signal.
const GENERIC_TOKENS = new Set([
  "index", "src", "lib", "dist", "build", "node", "modules", "test", "tests",
  "spec", "specs", "util", "utils", "types", "main", "app", "pkg", "package",
  "packages", "json", "yaml", "yml", "md", "ts", "tsx", "js", "jsx", "mjs",
  "cjs", "html", "css", "scss", "file", "files", "code", "config",
]);

// Tokens that appear in paths and meta-rules but rarely indicate drift alone.
export const CONSTRAINT_NOISE_TOKENS = new Set([
  "task", "tasks", "hooks", "hook", "component", "components", "web",
  "refactor", "beyond", "variant", "variants", "button", "buttons",
  "acceptable", "semantic", "design", "system", "tokens", "token", "raw",
  "what", "requires", "other", "only", "map", "controls", "nav", "links", "tab",
  "inline", "style", "styles", "always", "prefer",
]);

// When a prohibition mentions these, a path hit on a vendor name alone is weak.
export const OUT_OF_SCOPE_QUALIFIER_TOKENS = new Set([
  "production", "credential", "credentials", "secret", "secrets", "dashboard",
  "migration", "migrations", "deploy", "deployment", "billing", "stripe",
  "environment", "console", "operator", "vendor", "metadata", "manifest",
]);

const MIN_TOKEN_LENGTH = 3;

/**
 * Break text into normalized, meaningful tokens.
 *
 * - splits camelCase (`useWebSocket` -> use web socket)
 * - splits on any non-alphanumeric boundary (paths, snake_case, punctuation)
 * - lowercases, drops stopwords, generic file/code tokens, and short tokens
 */
export function tokenize(text: string): Set<string> {
  const spaced = text.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  const raw = spaced
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

  const tokens = new Set<string>();
  for (const word of raw) {
    if (word.length < MIN_TOKEN_LENGTH) continue;
    if (STOPWORDS.has(word)) continue;
    if (GENERIC_TOKENS.has(word)) continue;
    tokens.add(word);
  }
  return tokens;
}

/**
 * Two tokens match if they are equal, or one contains the other and the
 * shorter token is at least 4 characters (handles plurals/stems like
 * stub/stubbed, score/scores — while avoiding noise from 3-char fragments).
 */
export function tokensMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length >= 4 && b.includes(a)) return true;
  if (b.length >= 4 && a.includes(b)) return true;
  return false;
}

/** Tokens of `set` that have a match in `other`. */
export function intersectingTokens(set: Set<string>, other: Set<string>): string[] {
  const hits: string[] = [];
  for (const a of set) {
    for (const b of other) {
      if (tokensMatch(a, b)) {
        hits.push(a);
        break;
      }
    }
  }
  return hits;
}

/**
 * Discriminating tokens of `text`: its tokens minus any token that also
 * describes the agreed in-scope work. A token shared with in-scope is not
 * evidence of drift — e.g. "PDF export" vs in-scope "CSV export" both reduce
 * to "export", so "export" is removed and only "pdf" remains discriminating.
 */
export function discriminatingTokens(
  text: string,
  scopeTokens: Set<string>,
): Set<string> {
  const tokens = tokenize(text);
  const result = new Set<string>();
  for (const t of tokens) {
    let shared = false;
    for (const s of scopeTokens) {
      if (tokensMatch(t, s)) {
        shared = true;
        break;
      }
    }
    if (!shared) result.add(t);
  }
  return result;
}

/** Path segments from `/`, `.`, `-`, `_` — used to avoid substring false positives. */
export function pathSegmentTokens(path: string): Set<string> {
  const segments = new Set<string>();
  const normalized = path.toLowerCase().replace(/\\/g, "/");
  for (const part of normalized.split("/")) {
    if (!part) continue;
    for (const piece of part.split(/[._-]+/)) {
      if (piece.length < MIN_TOKEN_LENGTH) continue;
      if (STOPWORDS.has(piece)) continue;
      if (GENERIC_TOKENS.has(piece)) continue;
      segments.add(piece);
    }
  }
  return segments;
}

/** Constraint drift needs at least one non-noise token overlap. */
export function hasSignificantConstraintMatch(matched: string[]): boolean {
  return matched.some((t) => !CONSTRAINT_NOISE_TOKENS.has(t));
}

/**
 * Out-of-scope path matching: when a prohibition names sensitive qualifiers
 * (production, credentials, …), a lone vendor token in a filename is not enough.
 */
export function outOfScopeTouch(
  discriminating: Set<string>,
  target: Set<string>,
  pathSegs: Set<string>,
): string[] {
  const matched = intersectingTokens(discriminating, target);
  if (matched.length === 0) return [];

  const qualifiers = [...discriminating].filter((t) =>
    [...OUT_OF_SCOPE_QUALIFIER_TOKENS].some((q) => tokensMatch(t, q)),
  );
  if (qualifiers.length === 0) return matched;

  const qualHits = intersectingTokens(new Set(qualifiers), target);
  if (qualHits.length > 0) return matched;

  const pathHits = intersectingTokens(discriminating, pathSegs);
  if (pathHits.length > 0) return [];

  return matched;
}

/** Meta-rules that tend to false-block any touch of common path tokens. */
export function isDriftNoisyConstraintRule(rule: string): boolean {
  return (
    /\b(refactor|restructure|clean up).*\b(beyond|outside|what).*\b(task|scope)\b/i.test(
      rule,
    ) ||
    /\bskip hooks?\b/i.test(rule) ||
    /\b(raw hex|css tokens?|design-system\.css)\b/i.test(rule) ||
    /\buse the .*<Button>\b/i.test(rule) ||
    /\braw <button>\b/i.test(rule)
  );
}
