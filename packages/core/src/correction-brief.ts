import type { CorrectionLogEntry } from "@vaultcompass/conductor-schema";
import { tokenize, tokensMatch } from "./tokenize.js";

/** Default max acknowledged corrections in a Session Brief or index summary. */
export const DEFAULT_BRIEF_CORRECTION_MAX = 10;

/** Drop acknowledged corrections older than this from brief surfaces (not the log). */
export const DEFAULT_BRIEF_CORRECTION_MAX_AGE_DAYS = 90;

/** Jaccard similarity on rule tokens at or above this counts as a duplicate. */
export const CORRECTION_RULE_DEDUPE_THRESHOLD = 0.72;

export interface BriefCorrectionOptions {
  maxItems?: number;
  /** Omit or null to disable the age filter. */
  maxAgeDays?: number | null;
  dedupeThreshold?: number;
}

function tokenJaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const left of a) {
    for (const right of b) {
      if (tokensMatch(left, right)) {
        intersection++;
        break;
      }
    }
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function rulesAreSimilar(
  ruleA: string,
  ruleB: string,
  threshold: number,
): boolean {
  return tokenJaccard(tokenize(ruleA), tokenize(ruleB)) >= threshold;
}

/**
 * Select acknowledged corrections for brief-like surfaces: dedupe near-identical
 * rules (keep newest), optionally drop stale entries, then cap count. The full
 * correction_log on the contract is never mutated.
 */
export function briefCorrections(
  entries: CorrectionLogEntry[],
  options: BriefCorrectionOptions = {},
): CorrectionLogEntry[] {
  const maxItems = options.maxItems ?? DEFAULT_BRIEF_CORRECTION_MAX;
  const maxAgeDays = options.maxAgeDays ?? DEFAULT_BRIEF_CORRECTION_MAX_AGE_DAYS;
  const dedupeThreshold =
    options.dedupeThreshold ?? CORRECTION_RULE_DEDUPE_THRESHOLD;

  let candidates = [...entries].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  if (maxAgeDays != null && maxAgeDays > 0) {
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    candidates = candidates.filter(
      (entry) => new Date(entry.timestamp).getTime() >= cutoff,
    );
  }

  const kept: CorrectionLogEntry[] = [];
  for (const entry of candidates) {
    const duplicate = kept.some((existing) =>
      rulesAreSimilar(entry.rule, existing.rule, dedupeThreshold),
    );
    if (duplicate) continue;
    kept.push(entry);
    if (kept.length >= maxItems) break;
  }

  return kept.reverse();
}
