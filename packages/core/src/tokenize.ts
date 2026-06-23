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
