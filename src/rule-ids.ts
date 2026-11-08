// Every rule id the umbrella writes, as a named constant with its class.
// tests/rule-ids.test.ts holds this to every id literal under src in any
// quote style, every template id of the form product/suffix, and every
// skip reason that becomes the second half of an id.
//
// These strings are frozen public surface: they are SARIF rule and
// notification ids, and the codes of the umbrella's diagnostics, and a
// consumer matches on them. A value here never changes; a new id is added,
// never renamed in place.
//
// The class says what kind of record carries the id when the umbrella
// writes it, not where a renderer later files it:
// - finding: a Finding the umbrella raises itself (src/normalize.ts).
// - diagnostic: a Diagnostic record, an umbrella diagnostic or a run note,
//   which never counts toward the exit code.
// - notification: a SARIF tool-execution notification on the umbrella's run.
//
// Call sites are moving to these constants one file at a time; a site that
// still writes the literal must write exactly the value here.

export type RuleIdClass = 'finding' | 'diagnostic' | 'notification';

// Findings.
export const GATE_MISSING = 'conductor/gate-missing';
export const GATE_FAILED = 'conductor/gate-failed';
export const GATE_OUTPUT_UNPARSEABLE = 'conductor/gate-output-unparseable';
export const INTENT_GATE_BLOCKED = 'intent-guard/gate-blocked';

// Diagnostics.
export const BLOCKING_COUNT_MISMATCH = 'conductor/blocking-count-mismatch';
export const BLOCKING_THRESHOLD_UNKNOWN = 'conductor/blocking-threshold-unknown';
export const NOTHING_TO_SCAN = 'conductor/nothing-to-scan';
export const LOCKFILES_EMPTY = 'conductor/lockfiles-empty';
export const LOCKFILE_NO_LONGER_SCANNED = 'conductor/lockfile-no-longer-scanned';
export const MANIFESTS_NOT_HANDED = 'conductor/manifests-not-handed';
export const OPTION_OVERRIDDEN = 'conductor/option-overridden';
export const BASE_COMPARISON_UNAVAILABLE = 'conductor/base-comparison-unavailable';
export const REQUIREMENTS_DIRECT_ONLY = 'conductor/requirements-direct-only';
export const REQUIREMENTS_NOT_PINNED = 'conductor/requirements-not-pinned';
export const REQUIREMENTS_NOT_SCANNED = 'conductor/requirements-not-scanned';
export const INTENT_WARNING = 'intent-guard/warning';

// Notifications.
export const GATE_DEFERRED = 'conductor/gate-deferred';
export const GATE_EXCLUDED = 'conductor/gate-excluded';
export const GATE_NOT_ENFORCED = 'conductor/gate-not-enforced';
export const TREE_UNCHANGED = 'conductor/tree-unchanged';
export const BASE_MOVED = 'conductor/base-moved';
export const CONTROL_CHANGE_PROPOSED = 'conductor/control-change-proposed';
export const PREVIEW_UNDER_PROPOSED_RULES = 'conductor/preview-under-proposed-rules';
export const TRUST_BASE_REFUSED = 'conductor/trust-base-refused';
export const TRUST_BASE_NOT_PASSED = 'conductor/trust-base-not-passed';
export const GATE_PROGRAM_REFUSED = 'conductor/gate-program-refused';
export const NODE_MODULES_SKIPPED = 'conductor/node-modules-skipped';
export const VERSION_SKEW = 'conductor/version-skew';
export const OPTION_IS_GATE_OWN = 'conductor/option-is-gate-own';
export const INTENT_LEGACY_STATE_DIR = 'intent-guard/legacy-state-dir';
// These five are written in src/output-sarif.ts as a template on the gate's
// product, which only an intent gate reaches, so the value written is the
// one here. The skip reasons are SkippedGate.reason in src/run.ts.
export const INTENT_NO_CONTRACT = 'intent-guard/no-contract';
export const INTENT_CONTRACT_WAIVED = 'intent-guard/contract-waived';
export const INTENT_SPEC_AMBIGUOUS = 'intent-guard/spec-ambiguous';
export const INTENT_SPEC_WEAK_MATCH = 'intent-guard/spec-weak-match';
export const INTENT_EMPTY_CHANGE_SET = 'intent-guard/empty-change-set';

/** Every id above, with its class. */
export const RULE_IDS: ReadonlyArray<{ id: string; class: RuleIdClass }> = [
  { id: GATE_MISSING, class: 'finding' },
  { id: GATE_FAILED, class: 'finding' },
  { id: GATE_OUTPUT_UNPARSEABLE, class: 'finding' },
  { id: INTENT_GATE_BLOCKED, class: 'finding' },
  { id: BLOCKING_COUNT_MISMATCH, class: 'diagnostic' },
  { id: BLOCKING_THRESHOLD_UNKNOWN, class: 'diagnostic' },
  { id: NOTHING_TO_SCAN, class: 'diagnostic' },
  { id: LOCKFILES_EMPTY, class: 'diagnostic' },
  { id: LOCKFILE_NO_LONGER_SCANNED, class: 'diagnostic' },
  { id: MANIFESTS_NOT_HANDED, class: 'diagnostic' },
  { id: OPTION_OVERRIDDEN, class: 'diagnostic' },
  { id: BASE_COMPARISON_UNAVAILABLE, class: 'diagnostic' },
  { id: REQUIREMENTS_DIRECT_ONLY, class: 'diagnostic' },
  { id: REQUIREMENTS_NOT_PINNED, class: 'diagnostic' },
  { id: REQUIREMENTS_NOT_SCANNED, class: 'diagnostic' },
  { id: INTENT_WARNING, class: 'diagnostic' },
  { id: GATE_DEFERRED, class: 'notification' },
  { id: GATE_EXCLUDED, class: 'notification' },
  { id: GATE_NOT_ENFORCED, class: 'notification' },
  { id: TREE_UNCHANGED, class: 'notification' },
  { id: BASE_MOVED, class: 'notification' },
  { id: CONTROL_CHANGE_PROPOSED, class: 'notification' },
  { id: PREVIEW_UNDER_PROPOSED_RULES, class: 'notification' },
  { id: TRUST_BASE_REFUSED, class: 'notification' },
  { id: TRUST_BASE_NOT_PASSED, class: 'notification' },
  { id: GATE_PROGRAM_REFUSED, class: 'notification' },
  { id: NODE_MODULES_SKIPPED, class: 'notification' },
  { id: VERSION_SKEW, class: 'notification' },
  { id: OPTION_IS_GATE_OWN, class: 'notification' },
  { id: INTENT_LEGACY_STATE_DIR, class: 'notification' },
  { id: INTENT_NO_CONTRACT, class: 'notification' },
  { id: INTENT_CONTRACT_WAIVED, class: 'notification' },
  { id: INTENT_SPEC_AMBIGUOUS, class: 'notification' },
  { id: INTENT_SPEC_WEAK_MATCH, class: 'notification' },
  { id: INTENT_EMPTY_CHANGE_SET, class: 'notification' },
];
