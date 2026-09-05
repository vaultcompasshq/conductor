import { afterEach, describe, expect, it } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TEMP_PREFIX } from '../src/intent-prepare.js';
import { renderSarif } from '../src/output-sarif.js';
import { renderText } from '../src/output-text.js';
import { POLICY_FILE_NAME, parsePolicy } from '../src/policy.js';
import { runAll } from '../src/run.js';
import type { RunResult } from '../src/run.js';
import { CLEAN_DEP_GUARD, stubGate, stubIntentGuard } from './helpers/stub-gate.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

const IMPORT_DRY_RUN = readFileSync(
  path.join(FIXTURES, 'intent-guard-1.2.1-import-spec-superpowers-dry-run.json'),
  'utf8'
);
const FREEZE = readFileSync(path.join(FIXTURES, 'intent-guard-1.2.1-freeze.json'), 'utf8');
const CHECK_PASSING = readFileSync(
  path.join(FIXTURES, 'intent-guard-1.2.1-check-passing.json'),
  'utf8'
);
const CHECK_BLOCKING = readFileSync(
  path.join(FIXTURES, 'intent-guard-1.2.1-check-budget-blocking.json'),
  'utf8'
);
const SPEC_BODY = readFileSync(
  path.join(FIXTURES, 'superpowers', 'specs', '2026-09-03-widget-cache-design.md'),
  'utf8'
);
const PLAN_BODY = readFileSync(
  path.join(FIXTURES, 'superpowers', 'plans', '2026-09-03-widget-cache.md'),
  'utf8'
);

const INTENT_ONLY = parsePolicy(
  'version: 1\ngates:\n  intent:\n    product: intent-guard\n',
  POLICY_FILE_NAME
);
const INTENT_UNENFORCED = parsePolicy(
  'version: 1\ngates:\n  intent:\n    product: intent-guard\n    enforce: false\n',
  POLICY_FILE_NAME
);

const temps: string[] = [];

afterEach(() => {
  while (temps.length > 0) {
    rmSync(temps.pop() as string, { recursive: true, force: true });
  }
});

function tempDir(): string {
  // Deliberately NOT prefixed "conductor-intent-": that is the prefix the
  // preparation itself uses, and intent-prepare.test.ts counts those to prove
  // a failed chain leaks none. Two suites running in parallel would make that
  // count wander.
  const dir = mkdtempSync(path.join(os.tmpdir(), 'conductor-prflow-'));
  temps.push(dir);
  return dir;
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function write(root: string, relative: string, body: string): void {
  const full = path.join(root, relative);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, body);
}

function commit(root: string, message: string): void {
  git(root, ['add', '-A']);
  git(root, [
    '-c',
    'user.email=test@example.invalid',
    '-c',
    'user.name=test',
    'commit',
    '--quiet',
    '-m',
    message,
  ]);
}

/** A repository forked from main, with the widget spec on the branch. */
function repo(options: { spec?: boolean; changed?: string[] } = {}): string {
  const root = tempDir();
  git(root, ['init', '--quiet', '-b', 'main']);
  write(root, 'README.md', '# scratch\n');
  // The spec lands on main, the way an approved spec does, so the branch
  // diff below is the work and not the paperwork.
  if (options.spec !== false) {
    write(root, 'docs/superpowers/specs/2026-09-03-widget-cache-design.md', SPEC_BODY);
    write(root, 'docs/superpowers/plans/2026-09-03-widget-cache.md', PLAN_BODY);
  }
  commit(root, 'base');
  git(root, ['checkout', '--quiet', '-b', 'feat/widget-cache']);
  for (const relative of options.changed ?? ['src/widget/cache.ts']) {
    write(root, relative, 'export const x = 1;\n');
  }
  commit(root, 'branch work');
  return root;
}

function binWith(check: string, exit = 0): string {
  const bin = tempDir();
  stubIntentGuard(bin, {
    importSpec: { stdout: IMPORT_DRY_RUN },
    freeze: { stdout: FREEZE },
    check: { stdout: check, exit },
  });
  return bin;
}

function run(
  root: string,
  bin: string,
  options: {
    base?: string;
    spec?: string;
    env?: NodeJS.ProcessEnv;
    enforce?: boolean;
    tempRoot?: string;
  } = {}
): RunResult {
  return runAll(options.enforce === false ? INTENT_UNENFORCED : INTENT_ONLY, {
    repoRoot: root,
    staged: false,
    pathValue: bin,
    env: options.env ?? {},
    ...(options.base === undefined ? {} : { base: options.base }),
    ...(options.spec === undefined ? {} : { spec: options.spec }),
    ...(options.tempRoot === undefined ? {} : { tempRoot: options.tempRoot }),
  });
}

describe('a pull-request run against an imported spec', () => {
  it('runs the gate and reports where its contract came from', () => {
    const result = run(repo(), binWith(CHECK_PASSING), { base: 'main' });

    expect(result.exitCode).toBe(0);
    expect(result.gates[0].intent).toEqual({
      contractSource: {
        kind: 'imported',
        spec: 'docs/superpowers/specs/2026-09-03-widget-cache-design.md',
        plan: 'docs/superpowers/plans/2026-09-03-widget-cache.md',
      },
      baseRef: 'main',
    });
  });

  it('leaves no temporary directory behind when every gate ran and passed', () => {
    // The other half of the rule the failure-half test in
    // tests/intent-prepare.test.ts pins. There the preparation itself cleans
    // up after a step that failed; here the whole chain succeeded, so the
    // only thing that removes the directory is the caller's finally in
    // runAll. A leak is one directory per pull request on a shared CI
    // runner, with nothing in any report pointing at the cause.
    //
    // Counted in a temporary root of this test's OWN, never in the shared
    // one. Both halves used to count entries in os.tmpdir() itself, and the
    // two files can run in parallel jest workers, so each was counting the
    // other's directories and the number could move in either direction
    // between the two reads. TMPDIR cannot steer this from here: node reads
    // that from the real process environment and a jest test's process.env
    // is a copy, so the root is injected instead, the same way the
    // environment already is.
    const tempRoot = tempDir();

    const result = run(repo(), binWith(CHECK_PASSING), { base: 'main', tempRoot });

    // The run has to have gone through the import and the freeze, or this
    // would pass on a directory that was never created.
    expect(result.exitCode).toBe(0);
    expect(result.gates[0].intent?.contractSource.kind).toBe('imported');
    expect(readdirSync(tempRoot).filter((entry) => entry.startsWith(TEMP_PREFIX))).toEqual([]);
  });

  it('hands the gate the branch diff rather than the index', () => {
    const root = repo({ changed: ['src/widget/cache.ts', 'src/widget/lookup.ts'] });

    const result = run(root, binWith(CHECK_PASSING), { base: 'main' });

    const argv = result.gates[0].argv.join(' ');
    expect(argv).toMatch(/--paths src\/widget\/cache\.ts,src\/widget\/lookup\.ts/);
    expect(argv).not.toMatch(/--staged/);
  });

  it('points the gate at the temporary project, never at the repository', () => {
    const root = repo();

    const result = run(root, binWith(CHECK_PASSING), { base: 'main' });

    const projectIndex = result.gates[0].argv.indexOf('--project');
    expect(result.gates[0].argv[projectIndex + 1]).not.toBe('.');
    expect(result.gates[0].argv[projectIndex + 1].startsWith(root)).toBe(false);
  });

  it('still blocks on a budget breach, which is where intent-guard puts blocking', () => {
    const result = run(repo(), binWith(CHECK_BLOCKING, 1), { base: 'main' });

    expect(result.exitCode).toBe(1);
    expect(result.findings.map((finding) => finding.ruleId)).toContain(
      'intent-guard/budget.allowed_paths'
    );
  });

  it('takes the base ref from the pull request environment when no --base was given', () => {
    const root = repo();
    // A local branch standing in for the remote-tracking ref a CI checkout
    // would have, so origin/main resolves without a remote.
    git(root, ['branch', 'origin/main', 'main']);

    const result = run(root, binWith(CHECK_PASSING), { env: { GITHUB_BASE_REF: 'main' } });

    expect(result.gates[0].intent?.baseRef).toBe('origin/main');
  });
});

describe('a pull-request run against the repository own frozen contract', () => {
  it('uses it untouched and says so', () => {
    const root = repo();
    write(
      root,
      '.conductor/intent-contract.yaml',
      'contract_id: ic-1\nfrozen_by: user\napproval:\n  approved_by: a person\n'
    );

    const result = run(root, binWith(CHECK_PASSING), { base: 'main' });

    expect(result.gates[0].intent?.contractSource).toEqual({
      kind: 'native',
      path: '.conductor/intent-contract.yaml',
    });
    const projectIndex = result.gates[0].argv.indexOf('--project');
    expect(result.gates[0].argv[projectIndex + 1]).toBe('.');
  });
});

describe('a branch with no contract and no spec', () => {
  function noSpecRun(enforce = true): RunResult {
    return run(repo({ spec: false }), binWith(CHECK_PASSING), {
      base: 'main',
      ...(enforce ? {} : { enforce: false }),
    });
  }

  it('is an advisory, and the gate is reported as skipped', () => {
    const result = noSpecRun();

    expect(result.gates).toEqual([]);
    expect(result.skipped).toEqual([
      {
        role: 'intent',
        product: 'intent-guard',
        reason: 'no-contract',
        detail: expect.stringContaining('docs/superpowers/specs') as unknown as string,
      },
    ]);
  });

  it('never changes the exit code, enforced', () => {
    expect(noSpecRun().exitCode).toBe(0);
  });

  it('never changes the exit code, unenforced either', () => {
    expect(noSpecRun(false).exitCode).toBe(0);
  });

  it('is one notification in the umbrella SARIF run, not an alert', () => {
    // A branch with no spec is the ordinary state of most branches in a
    // repository that has not adopted the flow. As a RESULT it was a
    // fingerprint-less note alert on every run; as a notification it is what
    // it actually is, a statement about this run's coverage.
    const log = JSON.parse(renderSarif(noSpecRun(), '0.2.0')) as {
      runs: Array<{
        tool: { driver: { name: string } };
        results: Array<{ ruleId: string }>;
        invocations?: Array<{
          toolExecutionNotifications: Array<{ descriptor: { id: string }; level: string }>;
        }>;
      }>;
    };

    const umbrella = log.runs.find((entry) => entry.tool.driver.name === 'conductor');
    expect(umbrella?.results.map((entry) => entry.ruleId)).not.toContain(
      'intent-guard/no-contract'
    );
    const advisory = umbrella?.invocations?.[0].toolExecutionNotifications.find(
      (entry) => entry.descriptor.id === 'intent-guard/no-contract'
    );
    expect(advisory?.level).toBe('note');
    // And the gate that never ran gets no run of its own.
    expect(log.runs.map((entry) => entry.tool.driver.name)).not.toContain('intent-guard');
  });

  it('is one line in the text report', () => {
    const text = renderText(noSpecRun());

    expect(text).toMatch(/skipped\s+intent/);
    expect(text).toMatch(/no contract/);
    expect(text).toMatch(/verdict: exit 0/);
  });
});

describe('a git failure while working out what the branch changed', () => {
  it('is could-not-run, and exit 2, for an enforced gate', () => {
    // Fail-closed. An unresolvable base means the changed-path set is
    // unknown, and an unknown set is not an empty one.
    const result = run(repo(), binWith(CHECK_PASSING), { base: 'origin/nope' });

    expect(result.exitCode).toBe(2);
    expect(result.gates[0].couldNotRun?.reason).toBe('preparation-failed');
    expect(result.gates[0].couldNotRun?.detail).toMatch(/origin\/nope/);
  });

  it('is a note, and exit 0, for an unenforced gate', () => {
    const result = run(repo(), binWith(CHECK_PASSING), {
      base: 'origin/nope',
      enforce: false,
    });

    expect(result.exitCode).toBe(0);
    expect(result.gates[0].couldNotRun?.reason).toBe('preparation-failed');
  });

  it('names the step it failed at', () => {
    const result = run(repo(), binWith(CHECK_PASSING), { base: 'origin/nope' });

    expect(renderText(result)).toMatch(/base/);
    expect(result.findings.some((finding) => finding.ruleId === 'conductor/gate-failed')).toBe(
      true
    );
  });
});

describe('a changed path the --paths encoding cannot carry', () => {
  it('is could-not-run and exit 2 for an enforced gate, naming the path', () => {
    const result = run(repo({ changed: ['src/widget/a,b.ts'] }), binWith(CHECK_PASSING), {
      base: 'main',
    });

    expect(result.exitCode).toBe(2);
    expect(result.gates[0].couldNotRun?.reason).toBe('preparation-failed');
    expect(result.gates[0].couldNotRun?.detail).toContain('src/widget/a,b.ts');
    // The step, so nobody debugs the spec import over a filename.
    expect(result.gates[0].couldNotRun?.detail).toMatch(/base step/);
  });

  it('is a note and exit 0 for an unenforced gate', () => {
    const result = run(repo({ changed: ['src/widget/a,b.ts'] }), binWith(CHECK_PASSING), {
      base: 'main',
      enforce: false,
    });

    expect(result.exitCode).toBe(0);
    expect(result.gates[0].couldNotRun?.reason).toBe('preparation-failed');
  });

  it('lets a space in the middle of a filename through to the gate unchanged', () => {
    const result = run(repo({ changed: ['src/widget/my cache.ts'] }), binWith(CHECK_PASSING), {
      base: 'main',
    });

    expect(result.exitCode).toBe(0);
    expect(result.gates[0].argv).toContain('src/widget/my cache.ts');
  });
});

describe('the report says where the contract came from', () => {
  it('names the spec and the plan and the base ref in the text report', () => {
    // Verbose, because this run is clean and a clean run prints one summary
    // line. The contract line is per-gate detail, which is what --verbose is
    // for.
    const text = renderText(run(repo(), binWith(CHECK_PASSING), { base: 'main' }), {
      verbose: true,
    });

    expect(text).toMatch(/contract: spec docs\/superpowers\/specs\/2026-09-03-widget-cache-design\.md/);
    expect(text).toMatch(/plus plan docs\/superpowers\/plans\/2026-09-03-widget-cache\.md/);
    expect(text).toMatch(/base: main/);
  });

  it('carries both onto the gate run in SARIF', () => {
    const log = JSON.parse(
      renderSarif(run(repo(), binWith(CHECK_PASSING), { base: 'main' }), '0.2.0')
    ) as {
      runs: Array<{
        tool: { driver: { name: string } };
        properties?: { contractSource?: { kind?: string }; baseRef?: string | null };
      }>;
    };

    const gateRun = log.runs.find((entry) => entry.tool.driver.name === 'intent-guard');
    expect(gateRun?.properties?.contractSource?.kind).toBe('imported');
    expect(gateRun?.properties?.baseRef).toBe('main');
  });
});

describe('the ambient environment', () => {
  it('is never read unless the caller passes it in', () => {
    // pathValue is already injected rather than read, for exactly this
    // reason. Without the same rule for the environment, this very suite
    // behaves differently when it runs inside a pull request build, because
    // Actions sets GITHUB_BASE_REF and every runAll call that did not name an
    // env would quietly enter the pull-request flow.
    const previous = process.env.GITHUB_BASE_REF;
    process.env.GITHUB_BASE_REF = 'main';
    try {
      const result = runAll(INTENT_ONLY, {
        repoRoot: repo(),
        staged: true,
        pathValue: binWith(CHECK_PASSING),
      });

      expect(result.gates[0].intent).toBeUndefined();
      expect(result.gates[0].argv).toEqual(['check', '--project', '.', '--staged', '--json']);
    } finally {
      if (previous === undefined) {
        delete process.env.GITHUB_BASE_REF;
      } else {
        process.env.GITHUB_BASE_REF = previous;
      }
    }
  });
});

describe('a pull request body that waives the spec', () => {
  // One clean gate beside the waived one, so the clean run collapses to the
  // one-line summary and this can check the waiver is named there. With the
  // intent gate alone there are no gates left in the result and the report
  // takes its other branch entirely.
  const DEPS_AND_INTENT = parsePolicy(
    'version: 1\ngates:\n  dependencies:\n    product: dep-guard\n  intent:\n    product: intent-guard\n',
    POLICY_FILE_NAME
  );

  function waivedRun(): RunResult {
    // The branch's own spec IS on disk, so nothing here is skipped for want
    // of one: the body is the only reason the gate had nothing to check.
    const root = repo();
    const bin = binWith(CHECK_PASSING);
    stubGate(bin, 'dep-guard', { stdout: CLEAN_DEP_GUARD, exit: 0 });
    const event = path.join(tempDir(), 'event.json');
    writeFileSync(event, JSON.stringify({ pull_request: { body: 'Spec: none\n' } }));

    return runAll(DEPS_AND_INTENT, {
      repoRoot: root,
      staged: false,
      pathValue: bin,
      env: { GITHUB_EVENT_PATH: event },
      base: 'main',
    });
  }

  it('reports the gate as skipped for the waiver, and never moves the exit code', () => {
    const result = waivedRun();

    expect(result.exitCode).toBe(0);
    expect(result.skipped).toEqual([
      {
        role: 'intent',
        product: 'intent-guard',
        reason: 'contract-waived',
        detail: expect.stringContaining('pull request body') as unknown as string,
      },
    ]);
  });

  it('is a notification in the umbrella SARIF run under its own id, not a result', () => {
    // A waiver is a statement about configuration in its purest form: a
    // person wrote it in the pull request body on purpose. As a result it
    // would be a fingerprint-less note alert on every run of the branch.
    const log = JSON.parse(renderSarif(waivedRun(), '0.2.2')) as {
      runs: Array<{
        tool: { driver: { name: string } };
        results: Array<{ ruleId: string }>;
        invocations?: Array<{
          toolExecutionNotifications: Array<{ descriptor: { id: string }; level: string }>;
        }>;
      }>;
    };

    const umbrella = log.runs.find((entry) => entry.tool.driver.name === 'conductor');
    expect(umbrella?.results.map((entry) => entry.ruleId)).not.toContain(
      'intent-guard/contract-waived'
    );
    const advisory = umbrella?.invocations?.[0].toolExecutionNotifications.find(
      (entry) => entry.descriptor.id === 'intent-guard/contract-waived'
    );
    expect(advisory?.level).toBe('note');
    // And never the id a branch with no spec at all files under.
    expect(
      umbrella?.invocations?.[0].toolExecutionNotifications.map((entry) => entry.descriptor.id)
    ).not.toContain('intent-guard/no-contract');
  });

  it('is one line in the text report, and is named on the clean summary line', () => {
    const result = waivedRun();

    const summary = renderText(result);
    expect(summary.trimEnd().split('\n')).toHaveLength(1);
    expect(summary).toMatch(/clean, nothing blocked/);
    expect(summary).toMatch(/Nothing to check against: intent \(intent-guard\)/);

    const full = renderText(result, { verbose: true });
    expect(full).toMatch(/skipped\s+intent/);
    expect(full).toMatch(/spec waived/);
    expect(full).not.toMatch(/no contract/);
  });
});

describe('a run that is not pull-request shaped', () => {
  it('leaves the intent gate exactly as v0.1 ran it', () => {
    // No --base, no GITHUB_BASE_REF, no --spec. Nothing is imported, nothing
    // is discovered, and the gate keeps the staged command line it had.
    const root = repo();
    const result = runAll(INTENT_ONLY, {
      repoRoot: root,
      staged: true,
      pathValue: binWith(CHECK_PASSING),
      env: {},
    });

    expect(result.gates[0].argv).toEqual(['check', '--project', '.', '--staged', '--json']);
    expect(result.gates[0].intent).toBeUndefined();
    expect(result.skipped).toEqual([]);
  });
});
