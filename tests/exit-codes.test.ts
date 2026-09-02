import { describe, expect, it } from '@jest/globals';

import { EXIT_BLOCKED, EXIT_COULD_NOT_RUN, EXIT_OK, composeExitCode } from '../src/exit-codes.js';

function gate(overrides: Partial<Parameters<typeof composeExitCode>[0][number]> = {}) {
  return { couldNotRun: null, exitCode: 0, hasBlockingFinding: false, ...overrides };
}

describe('exit code composition', () => {
  it('is 0 when every enabled gate ran and none blocked', () => {
    expect(composeExitCode([gate(), gate(), gate()])).toBe(EXIT_OK);
  });

  it('is 0 with no enabled gates at all', () => {
    expect(composeExitCode([])).toBe(EXIT_OK);
  });

  it('is 1 when a gate exited non-zero', () => {
    expect(composeExitCode([gate(), gate({ exitCode: 1 })])).toBe(EXIT_BLOCKED);
  });

  it('is 1 when a gate reported a blocking finding even if its exit code did not', () => {
    // Belt to the braces: the umbrella can add to a gate's decision but
    // never subtract from it.
    expect(composeExitCode([gate({ hasBlockingFinding: true })])).toBe(EXIT_BLOCKED);
  });

  it('is 2 when any gate could not run, whatever the others did', () => {
    expect(composeExitCode([gate(), gate({ couldNotRun: { reason: 'binary-missing' } })])).toBe(
      EXIT_COULD_NOT_RUN
    );
  });

  it('lets could-not-run outrank a blocking gate rather than the other way round', () => {
    expect(
      composeExitCode([
        gate({ exitCode: 1, hasBlockingFinding: true }),
        gate({ couldNotRun: { reason: 'unparseable-output' }, exitCode: 1 }),
      ])
    ).toBe(EXIT_COULD_NOT_RUN);
  });

  it('does not take the numeric maximum of the children codes', () => {
    // A child that exited 2 is could-not-run, and the composed code is 2
    // for that reason rather than by arithmetic. The distinction matters
    // for the case below, where a child exited 1 and still composes to 2.
    expect(composeExitCode([gate({ couldNotRun: { reason: 'gate-error' }, exitCode: 1 })])).toBe(
      EXIT_COULD_NOT_RUN
    );
  });

  it('treats a missing enabled gate as non-zero, never as clean', () => {
    const code = composeExitCode([
      gate({ couldNotRun: { reason: 'binary-missing' }, exitCode: null, hasBlockingFinding: true }),
    ]);
    expect(code).not.toBe(EXIT_OK);
    expect(code).toBe(EXIT_COULD_NOT_RUN);
  });
});
