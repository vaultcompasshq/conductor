// How the composed exit code is decided.
//
// Not the numeric maximum of the children's codes, because the three
// products do not mean the same thing by the same number. dep-guard has a
// third code, 2, for "could not run the checks at all"; the other two have
// only 0 and 1, and both use 1 for a rejected config as well as for a real
// finding. Taking a maximum would flatten dep-guard's distinction away and
// would call a broken config a policy violation.
//
//   2  an enabled gate could not run: its binary is missing, it exited 2,
//      it was rejected its own config, or its output could not be parsed.
//      This outranks everything, because a gate that did not run has not
//      verified anything, and a report that says "clean" when nothing
//      looked is the failure this whole family exists to prevent.
//
//   1  every enabled gate ran, and at least one of them blocked.
//
//   0  every enabled gate ran, and none blocked.
//
// Two consequences worth stating rather than leaving to be discovered.
// First, 2 covers cases the products themselves report as 1, so the
// umbrella has to tell them apart from the child's OUTPUT and not from its
// exit code alone: "exited 1 and printed nothing parseable" is the reliable
// signal for a rejected config, and it is treated as could-not-run rather
// than as clean. Second, the composed code can therefore differ from the
// maximum of the children's, and that is deliberate.
//
// The umbrella never overrules a gate's own blocking decision. A gate that
// exited non-zero produces a non-zero composed code, full stop. The
// per-finding `blocking` flag can only ADD to that, never subtract: it
// exists so a gate whose exit code somehow said clean while its own report
// carried a blocking finding still fails the run.
//
// The ONE exception, and it is the repository's own written decision rather
// than a judgment made here: a gate carrying `enforce: false` in the policy
// file is left out of this composition entirely. That is the adoption ramp,
// so a gate can be switched on and read for a few weeks before it is
// allowed to refuse anybody's commit. It is not a downgrade: the gate still
// runs, its findings keep their own levels, its blocking flags are
// untouched, and both output formats say plainly that it blocked and was
// not enforced. Nothing here reads a gate's output and decides to ignore
// it; it reads a line somebody wrote in their own policy file.

export const EXIT_OK = 0;
export const EXIT_BLOCKED = 1;
export const EXIT_COULD_NOT_RUN = 2;

export interface ExitInput {
  /** Non-null when this gate did not produce a usable result. */
  couldNotRun: { reason: string } | null;
  /** The child's own exit code, or null when there was no child. */
  exitCode: number | null;
  /** Whether any finding from this gate is one the gate itself blocks on. */
  hasBlockingFinding: boolean;
  /**
   * Whether this gate's verdict counts here at all.
   *
   * REQUIRED rather than defaulted, deliberately. A caller that forgets it
   * should not compile, because the two possible mistakes are not
   * symmetrical: silently defaulting to false would drop a real gate's
   * verdict on the floor, and even the safe default would hide the fact
   * that a call site had never thought about the question.
   *
   * An unenforced gate is filtered out of this decision entirely. It is not
   * downgraded, and its findings are not marked non-blocking: the report
   * still says exactly what the gate said. The only thing enforce: false
   * changes is which number this function returns.
   */
  enforce: boolean;
}

export function composeExitCode(gates: ExitInput[]): number {
  const enforced = gates.filter((gate) => gate.enforce);
  if (enforced.some((gate) => gate.couldNotRun !== null)) {
    return EXIT_COULD_NOT_RUN;
  }
  if (enforced.some((gate) => (gate.exitCode ?? 0) !== 0 || gate.hasBlockingFinding)) {
    return EXIT_BLOCKED;
  }
  return EXIT_OK;
}

export function describeExitCode(code: number): string {
  switch (code) {
    case EXIT_OK:
      return 'every enabled gate ran and none blocked';
    case EXIT_BLOCKED:
      return 'every enabled gate ran and at least one blocked';
    case EXIT_COULD_NOT_RUN:
      return 'an enabled gate could not run, so nothing here is a clean result';
    default:
      return 'unknown';
  }
}
