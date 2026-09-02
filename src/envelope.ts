// The internal finding envelope.
//
// This shape is NOT published. SARIF is the family's published finding
// format, and every field here exists to make one SARIF mapping decision
// possible without the mapping having to know which of the three gates it
// is looking at. Keeping it internal is what lets it change when a gate
// changes, without anybody's pipeline breaking.
//
// The parts that are decisions rather than plumbing:
//
//  - `ruleId` is product-namespaced, always. Two of the three products have
//    open rule vocabularies (a user's own extra patterns in one, contract
//    text in another), so a bare id could collide on an ordinary word like
//    "dependencies" at any time. Namespacing costs nothing now and cannot
//    be retrofitted once anyone has written a suppression against a bare id.
//
//  - `severityIsDerived` is not decoration. Two products share a four-level
//    scale exactly, so their severities map by identity and the flag is
//    false. The third has no per-finding severity at all: it scores a
//    weighted rubric and emits two budget outcomes, so any level the
//    umbrella prints for it is the umbrella's own invention. Saying which
//    is which lets a consumer choose to trust the product's own action out
//    of `details` instead.
//
//  - `fingerprint.stability` is the honest version of "we have a shared
//    fingerprint". Each product's fingerprint is carried verbatim and
//    namespaced by product; nothing is hashed together with anything else,
//    because a new digest would match no existing baseline file and would
//    silently invalidate every one in the wild. `stability` records what
//    the value is actually worth: `stable` survives edits elsewhere in the
//    file, `positional` does not, `none` means there is no id to keep.
//
//  - `subject` is a union rather than a lowest common denominator. One
//    product's subject is a package in a manifest, another's is a byte
//    position in a file, the third's is a set of changed paths or a
//    contract with no position at all. Flattening those into file-and-line
//    would mean inventing a line number, and an invented line number is
//    indistinguishable from a real one once it reaches a code-scanning UI.

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

/** Highest first. Used only for report ordering, never to decide blocking. */
export const SEVERITY_ORDER: readonly Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

/**
 * The four-level ladder dep-guard and vault-guard share, plus the
 * thresholds they both accept. `info` is the umbrella's own fifth level and
 * never appears in either product's own output, so it is not on this ladder.
 */
export const SHARED_LADDER: readonly string[] = ['low', 'medium', 'high', 'critical'];

export type FingerprintStability = 'stable' | 'positional' | 'none';

export interface Fingerprint {
  /** The product's own value, verbatim and unhashed. */
  value: string;
  /** Which product's namespace the value lives in. */
  scope: string;
  stability: FingerprintStability;
}

export type Subject =
  | { kind: 'package'; name: string; manifest: string; lockfile?: string }
  /** `column` and `endColumn` are 1-based here even where the source is 0-based. */
  | { kind: 'location'; file: string; line: number; column: number; endColumn?: number }
  | { kind: 'paths'; paths: string[] }
  | { kind: 'contract'; category?: string }
  /** No subject exists. Used for findings about a gate rather than about code. */
  | { kind: 'none' };

export interface Finding {
  schemaVersion: 1;
  /** The gate that produced it, or "compass" for the umbrella's own findings. */
  product: string;
  /** Read from the binary's --version, or null when it could not be asked. */
  productVersion: string | null;
  ruleId: string;
  severity: Severity;
  severityIsDerived: boolean;
  /**
   * Whether this finding is one the GATE would fail a build over.
   *
   * The draft this package was built from says "copied from the product,
   * never recomputed". That turned out not to be literally available:
   * neither dep-guard nor vault-guard marks findings individually, they
   * report a threshold and a count of matches at or above it. So this is
   * reconstructed from the threshold the gate itself reported, using that
   * gate's own documented ladder, and then CHECKED against the count the
   * gate reported. A disagreement is a diagnostic and every finding in that
   * gate drops to false, because the umbrella reporting "blocking" about a
   * finding the gate did not block on is the failure the rule exists to
   * prevent.
   *
   * Nothing about the composed exit code depends on this field. That comes
   * from each child's own exit code, which is the only number the gate
   * actually decided.
   */
  blocking: boolean;
  message: string;
  subject: Subject;
  /** Null when the product emits no fingerprint for this kind of finding. */
  fingerprint: Fingerprint | null;
  /** The product's own payload, verbatim. */
  details: Record<string, unknown>;
}

export interface Diagnostic {
  code: string;
  message: string;
}

/** Everything a gate's report section needs that is not a finding. */
export interface RunSummary {
  /** The threshold the gate reported using, when it reports one. */
  failOn: string | null;
  /** Findings the gate's own baseline removed. The user's earlier decisions. */
  suppressed: number;
  /** Findings the gate's own ignore rules removed. */
  ignored: number;
  diagnostics: Diagnostic[];
  /** Product-specific run facts with nowhere else to go. */
  details: Record<string, unknown>;
}

export interface NormalizedGateOutput {
  findings: Finding[];
  run: RunSummary;
  /** Problems with the normalization itself, not with the scanned code. */
  diagnostics: Diagnostic[];
}

export class NormalizeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NormalizeError';
  }
}

/** True when `severity` is at or above `threshold` on the shared four-level ladder. */
export function atOrAboveThreshold(severity: string, threshold: string): boolean {
  if (threshold === 'none') {
    return false;
  }
  const severityIndex = SHARED_LADDER.indexOf(severity);
  const thresholdIndex = SHARED_LADDER.indexOf(threshold);
  if (severityIndex < 0 || thresholdIndex < 0) {
    return false;
  }
  return severityIndex >= thresholdIndex;
}

/** Orders findings for a report: blocking first, then by severity, then stably. */
export function compareFindings(a: Finding, b: Finding): number {
  if (a.blocking !== b.blocking) {
    return a.blocking ? -1 : 1;
  }
  const bySeverity = SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity);
  if (bySeverity !== 0) {
    return bySeverity;
  }
  return a.ruleId.localeCompare(b.ruleId);
}
