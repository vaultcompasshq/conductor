import { afterEach, describe, expect, it } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync, symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  LEGACY_NATIVE_CONTRACT_PATH,
  NATIVE_CONTRACT_PATH,
  TEMP_PREFIX,
} from '../src/intent-prepare.js';
import { TRUST_BASE_MIN_VERSION } from '../src/gate-runner.js';
import { renderSarif } from '../src/output-sarif.js';
import { INTENT_SPEC_LINES, gateLogLines, renderText, verdictToken } from '../src/output-text.js';
import { atLeastVersion } from '../src/trust-base.js';
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

function binWith(check: string, exit = 0, version?: string): string {
  const bin = tempDir();
  stubIntentGuard(bin, {
    importSpec: { stdout: IMPORT_DRY_RUN },
    freeze: { stdout: FREEZE },
    check: { stdout: check, exit },
    ...(version === undefined ? {} : { version }),
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
        plan: 'docs/superpowers/plans/2026-09-03-widget-cache.md', match: expect.objectContaining({ strength: 'exact' }),
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
    // The remote-tracking ref a CI checkout would have, without a remote.
    // The base is the commit id read from the exact ref, so a tag cannot
    // shadow it.
    git(root, ['update-ref', 'refs/remotes/origin/main', 'main']);
    const mainSha = git(root, ['rev-parse', 'main']).trim();

    const result = run(root, binWith(CHECK_PASSING), { env: { GITHUB_BASE_REF: 'main' } });

    expect(result.gates[0].intent?.baseRef).toBe(mainSha);
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

  it('is one line in the text report, and is named as a waiver on the clean summary line', () => {
    // The default report. A pre-commit hook and the pull request comment step
    // in the README both print this line and nothing else, so a clause that
    // reads the same for a waiver and for a missing spec means the difference
    // never reaches the people who only ever see one line.
    const result = waivedRun();

    const summary = renderText(result);
    expect(summary.trimEnd().split('\n')).toHaveLength(1);
    expect(summary).toMatch(/clean, nothing blocked/);
    expect(summary).toMatch(/Spec waived by the pull request body: intent \(intent-guard\)/);
    expect(summary).not.toMatch(/Nothing to check against/);

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

describe('a waived run where the intent gate is the only gate', () => {
  // The branch the waiver tests above route around. With a second, clean gate
  // in the policy there is a GateOutcome, so the report never reaches the
  // verdict for a run whose gate list is empty. An intent-only policy is not
  // a corner case: it is what `--gate intent` produces, and what a repository
  // running the intent gate at the ci stage on its own has.
  function intentOnlyWaivedRun(): RunResult {
    const event = path.join(tempDir(), 'event.json');
    writeFileSync(event, JSON.stringify({ pull_request: { body: 'Spec: none\n' } }));

    return run(repo(), binWith(CHECK_PASSING), {
      base: 'main',
      env: { GITHUB_EVENT_PATH: event },
    });
  }

  it('says the spec was waived in the verdict, rather than asking for a spec', () => {
    // The sentence a reader acts on. Telling somebody to write a spec, on a
    // pull request whose author has just written down that there is none, is
    // the report contradicting the person it is reporting to.
    const result = intentOnlyWaivedRun();

    expect(result.gates).toEqual([]);
    expect(result.exitCode).toBe(0);

    const text = renderText(result);
    expect(text).toMatch(/verdict: exit 0, nothing was checked/);
    expect(text).toMatch(/verdict:.*waived by the pull request body/);
    expect(text).not.toMatch(/no contract to check against/);
  });
});

/**
 * A repository still on intent-guard's pre-1.3 state directory.
 *
 * The fallback works, which is the point of it, and a working fallback is
 * silent unless something says otherwise. A silent one is how a repository
 * stays on the old layout for a year, so the log says which directory the
 * verdict was actually about.
 */
describe('a pull-request run reading the pre-1.3 state directory', () => {
  function legacyRun(): RunResult {
    const root = repo();
    write(
      root,
      LEGACY_NATIVE_CONTRACT_PATH,
      'contract_id: ic-1\nfrozen_by: user\napproval:\n  approved_by: a person\n'
    );
    return run(root, binWith(CHECK_PASSING), { base: 'main' });
  }

  it('lands in the SARIF log as a notification on the umbrella run', () => {
    const log = JSON.parse(renderSarif(legacyRun(), '0.2.3')) as {
      runs: Array<{
        tool: { driver: { name: string } };
        results?: Array<{ ruleId: string }>;
        invocations?: Array<{
          toolExecutionNotifications: Array<{
            descriptor: { id: string };
            level: string;
            message: { text: string };
          }>;
        }>;
      }>;
    };

    const umbrella = log.runs.find((entry) => entry.tool.driver.name === 'conductor');
    const notice = umbrella?.invocations?.[0].toolExecutionNotifications.find(
      (entry) => entry.descriptor.id === 'intent-guard/legacy-state-dir'
    );

    expect(notice).toBeDefined();
    expect(notice?.level).toBe('note');
    expect(notice?.message.text).toContain(LEGACY_NATIVE_CONTRACT_PATH);
    expect(notice?.message.text).toContain(NATIVE_CONTRACT_PATH);
  });

  it('is never a result, because nothing went wrong', () => {
    // The closest call of the five notifications, so it is pinned in both
    // directions. The gate ran, the contract was read, and the verdict is
    // exactly what it will be after the migration. As a result it would be a
    // fingerprint-less alert reappearing on every pull request until somebody
    // upgrades the gate, which is the permanent alert the rule excludes.
    const log = JSON.parse(renderSarif(legacyRun(), '0.2.3')) as {
      runs: Array<{ tool: { driver: { name: string } }; results?: Array<{ ruleId: string }> }>;
    };

    const ids = log.runs.flatMap((entry) => (entry.results ?? []).map((r) => r.ruleId));
    expect(ids).not.toContain('intent-guard/legacy-state-dir');
  });

  it('says which directory it read in the text report too', () => {
    // --verbose, because this run is fully clean and a clean run is one
    // line. The aside belongs on the contract line of the per-gate section,
    // not in the summary: it is context for somebody already reading the
    // detail, and putting it in the one-line summary would make every clean
    // pull request on the old layout print it.
    const text = renderText(legacyRun(), { verbose: true });

    expect(text).toContain(LEGACY_NATIVE_CONTRACT_PATH);
    expect(text).toMatch(/pre-1\.3 directory/);
  });

  it('says nothing at all when the contract is in the canonical directory', () => {
    const root = repo();
    write(
      root,
      NATIVE_CONTRACT_PATH,
      'contract_id: ic-1\nfrozen_by: user\napproval:\n  approved_by: a person\n'
    );
    const result = run(root, binWith(CHECK_PASSING), { base: 'main' });

    const log = JSON.parse(renderSarif(result, '0.2.3')) as {
      runs: Array<{
        tool: { driver: { name: string } };
        invocations?: Array<{ toolExecutionNotifications: Array<{ descriptor: { id: string } }> }>;
      }>;
    };
    const umbrella = log.runs.find((entry) => entry.tool.driver.name === 'conductor');
    const ids = (umbrella?.invocations?.[0].toolExecutionNotifications ?? []).map(
      (entry) => entry.descriptor.id
    );

    expect(ids).not.toContain('intent-guard/legacy-state-dir');
    expect(renderText(result, { verbose: true })).not.toMatch(/pre-1\.3 directory/);
  });
});

/**
 * The preparation is a SPAWN, so it is inside the program rule or outside the
 * boundary.
 *
 * `runGate` checks where a gate's program came from before it runs it, and
 * for every other gate that is the first thing that happens. The intent gate
 * is the exception: its contract is prepared first, and preparing it runs the
 * gate three times. A base policy that vendors the gate in the tree therefore
 * handed a pull request three executions of a file it had just rewritten,
 * before anything had looked at where that file came from. Measured with a
 * marker rather than with an assertion about which branch was taken: the
 * claim is that a program did not execute, and only the filesystem can say
 * that.
 */
describe('a pull-request run whose intent gate is vendored in the tree', () => {
  /**
   * A repository whose base vendors an honest intent-guard in its own
   * directory, and whose branch rewrites that program when asked to.
   */
  function vendored(options: { rewrite: boolean }): {
    root: string;
    command: string;
    marker: string;
  } {
    const root = tempDir();
    const marker = path.join(tempDir(), 'vendored-ran.txt');
    git(root, ['init', '--quiet', '-b', 'main']);
    write(root, 'README.md', '# scratch\n');
    write(root, 'docs/superpowers/specs/2026-09-03-widget-cache-design.md', SPEC_BODY);
    write(root, 'docs/superpowers/plans/2026-09-03-widget-cache.md', PLAN_BODY);
    const command = stubIntentGuard(path.join(root, 'vendor', 'intent-guard'), {
      importSpec: { stdout: IMPORT_DRY_RUN },
      freeze: { stdout: FREEZE },
      check: { stdout: CHECK_PASSING },
      version: '1.9.0',
    });
    commit(root, 'base');

    git(root, ['checkout', '--quiet', '-b', 'feat/widget-cache']);
    write(root, 'src/widget/cache.ts', 'export const x = 1;\n');
    if (options.rewrite) {
      // Byte for byte what the base approved everywhere except the one file
      // the policy names, and that file now records every invocation. The
      // payloads beside it are untouched, so the rewritten program is still a
      // working gate and the run it produces is clean.
      writeFileSync(
        command,
        [
          '#!/bin/sh',
          `printf '%s\\n' "$1" >> ${JSON.stringify(marker)}`,
          'if [ "$1" = "--version" ]; then echo "1.9.0"; exit 0; fi',
          `cat ${JSON.stringify(command)}."$1".stdout`,
          'exit 0',
        ].join('\n') + '\n'
      );
      chmodSync(command, 0o755);
    }
    commit(root, 'branch work');
    return { root, command, marker };
  }

  function vendoredPolicy(command: string, enforce: boolean) {
    return parsePolicy(
      'version: 1\ngates:\n  intent:\n    product: intent-guard\n' +
        `    command: ${JSON.stringify(command)}\n` +
        (enforce ? '' : '    enforce: false\n'),
      POLICY_FILE_NAME
    );
  }

  function vendoredRun(
    fixture: { root: string; command: string },
    options: { trustBase?: string; enforce?: boolean } = {}
  ): RunResult {
    return runAll(vendoredPolicy(fixture.command, options.enforce !== false), {
      repoRoot: fixture.root,
      staged: false,
      pathValue: tempDir(),
      env: {},
      base: 'main',
      ...(options.trustBase === undefined
        ? {}
        : { trustBase: { ref: options.trustBase, policyChanged: false, refusal: null } }),
    });
  }

  it('refuses the program the head rewrote, before the preparation spawns it', () => {
    const fixture = vendored({ rewrite: true });

    const result = vendoredRun(fixture, { trustBase: 'main' });

    expect(existsSync(fixture.marker)).toBe(false);
    expect(result.gates).toHaveLength(1);
    expect(result.gates[0].couldNotRun?.reason).toBe('gate-program-refused');
    expect(result.exitCode).toBe(2);
  });

  it('enforces that refusal even where the policy switched the gate off', () => {
    // enforce: false is a standing decision about what a gate's FINDINGS are
    // worth, and this gate produced none. Reading it here would let a pull
    // request that vendors its own gate keep the run green by unenforcing it.
    const fixture = vendored({ rewrite: true });

    const result = vendoredRun(fixture, { trustBase: 'main', enforce: false });

    expect(existsSync(fixture.marker)).toBe(false);
    expect(result.gates[0].couldNotRun?.reason).toBe('gate-program-refused');
    expect(result.gates[0].enforce).toBe(true);
    expect(result.exitCode).toBe(2);
  });

  it('prepares as usual when the branch left the vendored program alone', () => {
    // The direction that keeps the rule usable rather than a ban on
    // vendoring. An imported contract is proof the preparation actually ran:
    // it exists only because import-spec and freeze were both spawned.
    const fixture = vendored({ rewrite: false });

    const result = vendoredRun(fixture, { trustBase: 'main' });

    expect(result.gates[0].couldNotRun).toBeNull();
    expect(result.gates[0].intent?.contractSource.kind).toBe('imported');
    expect(result.exitCode).toBe(0);
  });

  it('runs the rewritten program as before when there is no trust base', () => {
    // Parity, measured the same way: outside pull-request mode the vendored
    // program is the repository's own choice about its own checkout, and it
    // must actually RUN or this proves only that nothing threw.
    const fixture = vendored({ rewrite: true });

    const result = vendoredRun(fixture);

    expect(existsSync(fixture.marker)).toBe(true);
    expect(result.gates[0].couldNotRun).toBeNull();
    expect(result.gates[0].intent?.contractSource.kind).toBe('imported');
    expect(result.exitCode).toBe(0);
  });
});

/**
 * A preparation that failed under a trust base is enforced.
 *
 * Same argument as `refusedTrustBase`: `enforce` is itself a control input,
 * this gate produced no findings for it to be a decision about, and a
 * pull-request run whose intent gate could not be prepared is a run where
 * nothing judged the intent. Reading the flag here let a base policy carrying
 * `enforce: false` report the failure and exit 0 anyway.
 */
describe('an intent preparation that failed', () => {
  function brokenBin(): string {
    const bin = tempDir();
    stubIntentGuard(bin, {
      importSpec: { stderr: 'import-spec: no.', exit: 2 },
      freeze: { stdout: FREEZE },
      check: { stdout: CHECK_PASSING },
      version: '1.4.0',
    });
    return bin;
  }

  it('is enforced under a trust base, whatever the policy says', () => {
    const result = runAll(INTENT_UNENFORCED, {
      repoRoot: repo(),
      staged: false,
      pathValue: brokenBin(),
      env: {},
      base: 'main',
      trustBase: { ref: 'main', policyChanged: false, refusal: null },
    });

    expect(result.gates[0].couldNotRun?.reason).toBe('preparation-failed');
    expect(result.gates[0].enforce).toBe(true);
    expect(result.exitCode).toBe(2);
  });

  it('still reads the policy outside pull-request mode', () => {
    // The parity direction. Off a pull request the policy is the
    // repository's own standing decision about its own checkout, and an
    // unenforced gate that could not be prepared is a note.
    const result = runAll(INTENT_UNENFORCED, {
      repoRoot: repo(),
      staged: false,
      pathValue: brokenBin(),
      env: {},
      base: 'main',
    });

    expect(result.gates[0].couldNotRun?.reason).toBe('preparation-failed');
    expect(result.gates[0].enforce).toBe(false);
    expect(result.exitCode).toBe(0);
  });
});

/**
 * The preparation takes the node_modules skip too, and it is measured.
 *
 * `runGate` declines to resolve out of `node_modules/.bin` on a pull-request
 * run, and the preparation resolves its own binary separately. Both halves
 * have to take the skip, because the preparation is what spawns first.
 */
describe('a pull-request run and the intent gate the head installed', () => {
  it('prepares with the PATH copy and never with node_modules/.bin', () => {
    const root = repo();
    const marker = path.join(tempDir(), 'node-modules-ran.txt');
    const planted = path.join(root, 'node_modules', '.bin', 'intent-guard');
    mkdirSync(path.dirname(planted), { recursive: true });
    writeFileSync(
      planted,
      [
        '#!/bin/sh',
        `printf '%s\\n' "$1" >> ${JSON.stringify(marker)}`,
        'if [ "$1" = "--version" ]; then echo "1.4.0"; exit 0; fi',
        'exit 0',
      ].join('\n') + '\n'
    );
    chmodSync(planted, 0o755);

    // The PATH copy is above every pull-request-mode minimum, so the only
    // thing this run can trip over is the node_modules copy.
    const result = runAll(INTENT_ONLY, {
      repoRoot: root,
      staged: false,
      pathValue: binWith(CHECK_PASSING, 0, '1.9.0'),
      env: {},
      base: 'main',
      trustBase: { ref: 'main', policyChanged: false, refusal: null },
    });

    expect(existsSync(marker)).toBe(false);
    expect(result.gates[0].couldNotRun).toBeNull();
    expect(result.gates[0].binary?.source).toBe('path');
    expect(result.gates[0].intent?.contractSource.kind).toBe('imported');
    expect(result.exitCode).toBe(0);
  });
});

describe('a trust base alone makes the run pull-request shaped', () => {
  const FROZEN = 'contract_id: ic-1\nfrozen_by: user\napproval:\n  approved_by: a person\n';

  /** main carries a frozen contract; the branch changes the given files. */
  function frozenOnMain(changed: string[]): { root: string; mainSha: string } {
    const root = tempDir();
    git(root, ['init', '--quiet', '-b', 'main']);
    write(root, 'README.md', '# scratch\n');
    write(root, NATIVE_CONTRACT_PATH, FROZEN);
    commit(root, 'base');
    const mainSha = git(root, ['rev-parse', 'HEAD']).trim();
    git(root, ['checkout', '--quiet', '-b', 'feat/widget-cache']);
    for (const relative of changed) {
      write(root, relative, 'export const x = 1;\n');
    }
    commit(root, 'branch work');
    return { root, mainSha };
  }

  function trustBaseRun(root: string, ref: string, argvLog: string): RunResult {
    const bin = tempDir();
    stubIntentGuard(bin, { check: { stdout: CHECK_PASSING }, version: '1.8.1', argvLog });
    return runAll(INTENT_ONLY, {
      repoRoot: root,
      staged: false,
      pathValue: bin,
      env: {},
      trustBase: { ref, policyChanged: false, refusal: null },
    });
  }

  it('judges the branch change set against the trust base with no --base and no GITHUB_BASE_REF', () => {
    const { root, mainSha } = frozenOnMain(['elsewhere/a.ts', 'elsewhere/b.ts']);
    const log = path.join(tempDir(), 'argv.log');

    const result = trustBaseRun(root, mainSha, log);

    // Every intent gate that runs on a trust-base run is new enough to read
    // the change set from git itself, so a native contract hands it --base.
    const argv = result.gates[0].argv;
    expect(argv[argv.indexOf('--base') + 1]).toBe(mainSha);
    expect(argv).not.toContain('--paths');
    expect(argv).toContain('--trust-base');
    expect(argv).not.toContain('--staged');
    expect(result.gates[0].intent?.baseRef).toBe(mainSha);
  });

  it('measures the change set from the trust base when no other base is given', () => {
    const { root, mainSha } = frozenOnMain(['src/widget/cache.ts']);
    const log = path.join(tempDir(), 'argv.log');

    const result = trustBaseRun(root, mainSha, log);

    expect(result.gates[0].intent?.baseRef).toBe(mainSha);
    expect(readFileSync(log, 'utf8')).toContain(`--base ${mainSha}`);
  });

  it('skips a first adoption, and reports the contract it adds as a proposal of the intent gate', () => {
    const root = tempDir();
    git(root, ['init', '--quiet', '-b', 'main']);
    write(root, 'README.md', '# scratch\n');
    commit(root, 'base');
    const mainSha = git(root, ['rev-parse', 'HEAD']).trim();
    git(root, ['checkout', '--quiet', '-b', 'feat/widget-cache']);
    write(root, NATIVE_CONTRACT_PATH, FROZEN);
    write(root, 'src/widget/cache.ts', 'export const x = 1;\n');
    commit(root, 'adopt the native flow');

    const result = trustBaseRun(root, mainSha, path.join(tempDir(), 'argv.log'));

    expect(result.gates).toEqual([]);
    expect(result.skipped.map((gate) => gate.reason)).toEqual(['no-contract']);
    expect(result.exitCode).toBe(0);
    expect(result.proposals).toEqual([
      {
        product: 'intent-guard',
        role: 'intent',
        line: expect.stringMatching(/^\.intent-guard\/intent-contract\.yaml is in this pull request/),
      },
    ]);
  });

  it('says in one line, even on a clean run, that --spec was not used because the base has a frozen contract', () => {
    const { root, mainSha } = frozenOnMain(['src/widget/cache.ts']);
    write(root, 'docs/superpowers/specs/2026-09-03-widget-cache-design.md', SPEC_BODY);
    commit(root, 'a spec in the pull request');
    const bin = tempDir();
    stubIntentGuard(bin, { check: { stdout: CHECK_PASSING }, version: '1.8.1' });

    const result = runAll(INTENT_ONLY, {
      repoRoot: root,
      staged: false,
      pathValue: bin,
      env: {},
      spec: 'docs/superpowers/specs/2026-09-03-widget-cache-design.md',
      trustBase: { ref: mainSha, policyChanged: false, refusal: null },
    });

    expect(result.exitCode).toBe(0);
    expect(result.gates[0].intent?.contractSource.kind).toBe('native');
    const text = renderText(result);
    expect(text).toMatch(
      /note: the spec named by --spec \(docs\/superpowers\/specs\/2026-09-03-widget-cache-design\.md\) was not used: .* has a frozen intent contract/
    );
  });

  it('prints no such line when --spec was used', () => {
    const root = repo();
    const mainSha = git(root, ['rev-parse', 'main']).trim();

    const result = run(root, binWith(CHECK_PASSING), {
      spec: 'docs/superpowers/specs/2026-09-03-widget-cache-design.md',
    });
    const withTrust = runAll(INTENT_ONLY, {
      repoRoot: root,
      staged: false,
      pathValue: binWith(CHECK_PASSING),
      env: {},
      spec: 'docs/superpowers/specs/2026-09-03-widget-cache-design.md',
      trustBase: { ref: mainSha, policyChanged: false, refusal: null },
    });

    expect(renderText(result, { verbose: true })).not.toMatch(/was not used/);
    expect(withTrust.gates[0].intent?.contractSource.kind).toBe('imported');
    expect(renderText(withTrust, { verbose: true })).not.toMatch(/was not used/);
  });
});

describe('a change set --paths cannot carry stays clearable', () => {
  const FROZEN = 'contract_id: ic-1\nfrozen_by: user\napproval:\n  approved_by: a person\n';

  /**
   * main carries a frozen contract and `baseFiles`; the branch then runs
   * `head` in the repository. Returns the base commit.
   */
  function nativeRepo(baseFiles: Record<string, string>, head: (root: string) => void): { root: string; base: string } {
    const root = tempDir();
    git(root, ['init', '--quiet', '-b', 'main']);
    write(root, NATIVE_CONTRACT_PATH, FROZEN);
    for (const [relative, body] of Object.entries(baseFiles)) {
      write(root, relative, body);
    }
    commit(root, 'base');
    const base = git(root, ['rev-parse', 'HEAD']).trim();
    git(root, ['checkout', '--quiet', '-b', 'fix/rename']);
    head(root);
    commit(root, 'the pull request');
    return { root, base };
  }

  /**
   * A trust-base run for a gate at or above the pull-request-mode minimum.
   * Below it the gate is could-not-run on a trust-base run before any change
   * set is handed over, so the --paths channel for an older gate is driven
   * on a run with an explicit --base and no trust base.
   */
  function nativeRun(root: string, base: string, version: string): RunResult {
    const bin = tempDir();
    stubIntentGuard(bin, { check: { stdout: CHECK_PASSING }, version });
    return runAll(INTENT_ONLY, {
      repoRoot: root,
      staged: false,
      pathValue: bin,
      env: {},
      ...(atLeastVersion(version, TRUST_BASE_MIN_VERSION['intent-guard'] as string)
        ? { trustBase: { ref: base, policyChanged: false, refusal: null } }
        : { base }),
    });
  }

  /** A dash-leading file renamed: the change set lists both names. */
  function renamedDashFile() {
    return nativeRepo({ '-notes.md': 'n\n' }, (root) => {
      git(root, ['mv', '--', '-notes.md', 'notes.md']);
    });
  }

  it("hands a native contract to intent-guard's own --base from 1.8.1, so a dash-leading path is judged", () => {
    const { root, base } = renamedDashFile();

    const result = nativeRun(root, base, '1.8.1');

    const argv = result.gates[0].argv;
    expect(result.gates[0].couldNotRun).toBeNull();
    expect(argv[argv.indexOf('--base') + 1]).toBe(base);
    expect(argv).not.toContain('--paths');
  });

  it('below 1.8.1, leads the --paths list with a path that does not start with a dash', () => {
    const { root, base } = renamedDashFile();

    const result = nativeRun(root, base, '1.8.0');

    const argv = result.gates[0].argv;
    expect(result.gates[0].couldNotRun).toBeNull();
    expect(argv[argv.indexOf('--paths') + 1]).toBe('notes.md,-notes.md');
    expect(argv).not.toContain('--base');
  });

  it('below 1.8.1, refuses only when every path starts with a dash, and says how to clear it', () => {
    const { root, base } = nativeRepo({}, (r) => {
      write(r, '-only.md', 'x\n');
    });

    const result = nativeRun(root, base, '1.8.0');

    expect(result.exitCode).toBe(2);
    expect(result.gates[0].couldNotRun?.detail).toMatch(/every changed path starts with "-"/);
    expect(result.gates[0].couldNotRun?.detail).toMatch(/upgrade intent-guard to 1\.8\.1 or later/);
  });

  it('judges a comma in a path through --base from 1.8.1, where --paths would split it', () => {
    const { root, base } = nativeRepo({}, (r) => {
      write(r, 'src/a,b.ts', 'x\n');
    });

    const result = nativeRun(root, base, '1.8.1');

    expect(result.gates[0].couldNotRun).toBeNull();
    expect(result.gates[0].argv).toContain('--base');
  });

  it('refuses a comma in a path for an imported contract, saying how to clear it', () => {
    const root = repo({ changed: ['src/a,b.ts'] });

    const result = run(root, binWith(CHECK_PASSING), { base: 'main' });

    expect(result.exitCode).toBe(2);
    expect(result.gates[0].couldNotRun?.detail).toMatch(/contains a comma/);
    expect(result.gates[0].couldNotRun?.detail).toMatch(/freeze the contract and commit it to the base branch/);
  });

  it('never reports a bare zero proposals when the path list refusal stopped the intent gate on a trust-base run', () => {
    // An imported contract, the one shape where the path list refusal is
    // still reached on a trust-base run: its only channel is --paths.
    const root = repo({ changed: ['src/a,b.ts'] });
    const mainSha = git(root, ['rev-parse', 'main']).trim();

    const result = runAll(INTENT_ONLY, {
      repoRoot: root,
      staged: false,
      pathValue: binWith(CHECK_PASSING, 0, '1.9.0'),
      env: {},
      trustBase: { ref: mainSha, policyChanged: false, refusal: null },
    });
    const text = renderText(result, { verbose: true });

    expect(result.gates[0].couldNotRun?.detail).toMatch(/contains a comma/);
    expect(text).toMatch(/intent \(intent-guard\) could not run, so the proposals of that gate are not known/);
    expect(text).not.toMatch(/0 control change\(s\) proposed in this pull request/);
  });
});

describe('the proposal count when the intent preparation fails on a trust-base run', () => {
  it('names the intent gate as not known rather than counting zero', () => {
    const root = tempDir();
    git(root, ['init', '--quiet', '-b', 'main']);
    write(root, 'real.yaml', 'contract_id: ic-1\nfrozen_by: user\napproval:\n  approved_by: a person\n');
    mkdirSync(path.join(root, '.intent-guard'), { recursive: true });
    symlinkSync('../real.yaml', path.join(root, NATIVE_CONTRACT_PATH));
    commit(root, 'base contract is a link');
    const base = git(root, ['rev-parse', 'HEAD']).trim();
    git(root, ['checkout', '--quiet', '-b', 'feat/widget-cache']);
    write(root, 'src/widget/cache.ts', 'export const x = 1;\n');
    commit(root, 'the pull request');
    const bin = tempDir();
    stubIntentGuard(bin, { check: { stdout: CHECK_PASSING }, version: '1.8.0' });

    const result = runAll(INTENT_ONLY, {
      repoRoot: root,
      staged: false,
      pathValue: bin,
      env: {},
      trustBase: { ref: base, policyChanged: false, refusal: null },
    });
    const text = renderText(result, { verbose: true });

    expect(result.gates[0].couldNotRun?.reason).toBe('preparation-failed');
    expect(text).toMatch(/intent \(intent-guard\) could not run, so the proposals of that gate are not known/);
    expect(text).not.toMatch(/0 control change\(s\) proposed in this pull request/);
    // The job log line says the gate could not run and was never spawned.
    const lines = gateLogLines(result);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /^conductor: gate intent \(intent-guard version unknown\): could-not-run \(preparation-failed\), no exit code, conductor said: "the intent gate could not be prepared at the contract-source step: /
    );
  });

  it('logs the path list refusal as could-not-run with the gate version it read', () => {
    const root = tempDir();
    git(root, ['init', '--quiet', '-b', 'main']);
    write(root, NATIVE_CONTRACT_PATH, 'contract_id: ic-1\nfrozen_by: user\napproval:\n  approved_by: a person\n');
    commit(root, 'base');
    const base = git(root, ['rev-parse', 'HEAD']).trim();
    git(root, ['checkout', '--quiet', '-b', 'fix/x']);
    write(root, '-only.md', 'x\n');
    commit(root, 'the pull request');
    const bin = tempDir();
    stubIntentGuard(bin, { check: { stdout: CHECK_PASSING }, version: '1.8.0' });

    // An explicit --base and no trust base: on a trust-base run an
    // intent-guard below 1.8.1 is could-not-run before the path list is
    // built, so this refusal is reached only on a run like this one.
    const result = runAll(INTENT_ONLY, {
      repoRoot: root,
      staged: false,
      pathValue: bin,
      env: {},
      base,
    });

    const lines = gateLogLines(result);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /^conductor: gate intent \(intent-guard 1\.8\.0\): could-not-run \(preparation-failed\), no exit code, conductor said: "/
    );
  });

  it('logs a first adoption as skipped, never as a gate that ran', () => {
    const root = tempDir();
    git(root, ['init', '--quiet', '-b', 'main']);
    write(root, 'README.md', '# scratch\n');
    commit(root, 'base');
    const base = git(root, ['rev-parse', 'HEAD']).trim();
    git(root, ['checkout', '--quiet', '-b', 'feat/widget-cache']);
    write(root, NATIVE_CONTRACT_PATH, 'contract_id: ic-1\nfrozen_by: user\napproval:\n  approved_by: a person\n');
    commit(root, 'adopt');
    const bin = tempDir();
    stubIntentGuard(bin, { check: { stdout: CHECK_PASSING }, version: '1.8.0' });

    const result = runAll(INTENT_ONLY, {
      repoRoot: root,
      staged: false,
      pathValue: bin,
      env: {},
      trustBase: { ref: base, policyChanged: false, refusal: null },
    });

    expect(gateLogLines(result)).toHaveLength(1);
    expect(gateLogLines(result)[0]).toMatch(/^conductor: gate intent \(intent-guard\): skipped \(/);
  });
});

// The branch-name convention on every report surface (design
// 2026-10-17-intent-spec-auto-selection, sections 5 and 9.2). The branch comes
// from GITHUB_HEAD_REF, as on a pull request, so a name git would refuse as a
// ref still reaches the rule.
describe('the branch-name convention on every report surface', () => {
  const SPECS = 'docs/superpowers/specs';
  const DEPS_AND_INTENT = parsePolicy(
    'version: 1\ngates:\n  dependencies:\n    product: dep-guard\n  intent:\n    product: intent-guard\n',
    POLICY_FILE_NAME
  );
  const DOGFOOD = [
    '2026-10-01-prepare-release-notes-design.md',
    '2026-10-02-improve-parser.md',
    '2026-10-03-fix-pr-comment.md',
    '2026-10-04-pr.md',
    '2026-10-05-review-pr.md',
  ];
  const [AMBIGUOUS_LINE, NONE_CHANGED_LINE, WINNER_CHANGED_LINE, WEAK_LINE] = INTENT_SPEC_LINES;

  interface SarifLog {
    runs: Array<{
      tool: { driver: { name: string } };
      properties?: Record<string, unknown>;
      invocations?: Array<{
        toolExecutionNotifications: Array<{
          descriptor: { id: string };
          level: string;
          message: { text: string };
          properties: { details: Record<string, unknown> };
        }>;
      }>;
    }>;
  }

  /** main carries the specs; the branch changes one file. Returns the root and main's commit. */
  function specRepo(specs: string[]): { root: string; mainSha: string } {
    const root = tempDir();
    git(root, ['init', '--quiet', '-b', 'main']);
    write(root, 'README.md', '# scratch\n');
    for (const name of specs) {
      write(root, `${SPECS}/${name}`, SPEC_BODY);
    }
    commit(root, 'base');
    const mainSha = git(root, ['rev-parse', 'HEAD']).trim();
    git(root, ['checkout', '--quiet', '-b', 'work']);
    write(root, 'src/widget/cache.ts', 'export const x = 1;\n');
    commit(root, 'branch work');
    return { root, mainSha };
  }

  function conventionRun(
    specs: string[],
    branch: string,
    options: {
      check?: string;
      exit?: number;
      second?: boolean;
      enforce?: boolean;
      trustBase?: boolean;
      prEvent?: boolean;
      argvLog?: string;
    } = {}
  ): RunResult {
    const { root, mainSha } = specRepo(specs);
    const bin = tempDir();
    stubIntentGuard(bin, {
      importSpec: { stdout: IMPORT_DRY_RUN },
      freeze: { stdout: FREEZE },
      check: { stdout: options.check ?? CHECK_PASSING, exit: options.exit ?? 0 },
      version: '1.8.1',
      ...(options.argvLog === undefined ? {} : { argvLog: options.argvLog }),
    });
    if (options.second === true) {
      stubGate(bin, 'dep-guard', { stdout: CLEAN_DEP_GUARD, exit: 0 });
    }
    const env: NodeJS.ProcessEnv = { GITHUB_HEAD_REF: branch };
    if (options.prEvent === true) {
      const event = path.join(tempDir(), 'event.json');
      writeFileSync(event, JSON.stringify({ pull_request: { body: 'No spec line here.\n' } }));
      env.GITHUB_EVENT_PATH = event;
    }
    const policy =
      options.second === true ? DEPS_AND_INTENT : options.enforce === false ? INTENT_UNENFORCED : INTENT_ONLY;
    return runAll(policy, {
      repoRoot: root,
      staged: false,
      pathValue: bin,
      env,
      ...(options.trustBase === true
        ? { trustBase: { ref: mainSha, policyChanged: false, refusal: null } }
        : { base: 'main' }),
    });
  }

  function reportLines(result: RunResult, verbose = false): string[] {
    return renderText(result, { version: '0.11.0', verbose }).split('\n');
  }

  function notifications(result: RunResult): NonNullable<SarifLog['runs'][number]['invocations']>[number]['toolExecutionNotifications'] {
    const log = JSON.parse(renderSarif(result, '0.11.0')) as SarifLog;
    return log.runs.flatMap((entry) => entry.invocations?.[0]?.toolExecutionNotifications ?? []);
  }

  // A1, run level. Kills: printing the none-changed line only for some
  // causes.
  it('skips the dogfood branch pr with exit 0, spawning nothing, and says on line 3 it chose a spec before', () => {
    for (const trustBase of [false, true]) {
      const argvLog = path.join(tempDir(), 'argv.log');
      const result = conventionRun(DOGFOOD, 'pr', { trustBase, argvLog });
      expect([trustBase, result.exitCode]).toEqual([trustBase, 0]);
      expect(result.gates).toEqual([]);
      expect(result.skipped.map((gate) => gate.reason)).toEqual(['no-contract']);
      expect(verdictToken(result, false)).toBe('nothing-checked');
      expect(reportLines(result)[2]).toBe(NONE_CHANGED_LINE);
      expect(existsSync(argvLog)).toBe(false);
    }
  });

  // A3, run level. Kills: filing the skip under no-contract; isFullyClean
  // ignoring skips.
  it('reports a tie as spec-ambiguous on every surface, with exit 0', () => {
    for (const trustBase of [false, true]) {
      const result = conventionRun(['2026-01-01-widget-cache-index.md', '2026-01-02-widget-cache-rev.md'], 'feat/widget-cache', { trustBase });
      expect([trustBase, result.exitCode]).toEqual([trustBase, 0]);
      expect(result.skipped.map((gate) => gate.reason)).toEqual(['spec-ambiguous']);
      expect(verdictToken(result, false)).toBe('nothing-checked');
      const lines = reportLines(result);
      expect(lines[2]).toBe(AMBIGUOUS_LINE);
      const text = lines.join('\n');
      expect(text).toMatch(/skipped\s+intent\s+intent-guard\s+spec ambiguous: No spec was chosen/);
      expect(text).toMatch(/verdict:.*intent matched two or more specs equally, so none was chosen/);
      expect(gateLogLines(result)[0]).toMatch(/skipped \(spec ambiguous\)/);
      const ambiguous = notifications(result).find((entry) => entry.descriptor.id === 'intent-guard/spec-ambiguous');
      expect(ambiguous?.level).toBe('note');
      expect(ambiguous?.properties.details).toMatchObject({
        reason: 'spec-ambiguous',
        tied: ['2026-01-01-widget-cache-index.md', '2026-01-02-widget-cache-rev.md'],
        tiedCount: 2,
        legacySelection: '2026-01-01-widget-cache-index.md',
      });
      expect(notifications(result).map((entry) => entry.descriptor.id)).not.toContain('intent-guard/no-contract');
    }
  });

  it('keeps a tie off the one-line summary, beside a second clean gate, while the token stays pass', () => {
    const result = conventionRun(['2026-01-01-widget-cache-index.md', '2026-01-02-widget-cache-rev.md'], 'feat/widget-cache', { second: true });
    expect(result.exitCode).toBe(0);
    expect(verdictToken(result, false)).toBe('pass');
    const text = renderText(result);
    expect(text.trimEnd().split('\n').length).toBeGreaterThan(1);
    expect(text).toContain('No spec was chosen');
  });

  // A4. Kills: no weak flag; the weak line not keeping the run off the
  // summary; a missing notification; the header line missing.
  it('labels a single-token choice weak in the gate block, --verbose, SARIF and line 3', () => {
    const result = conventionRun(['2026-01-01-widget-cache.md', '2026-01-02-cache.md'], 'fix/cache-tuning', { second: true });
    expect(result.exitCode).toBe(0);
    const summary = renderText(result);
    expect(summary.trimEnd().split('\n').length).toBeGreaterThan(1);
    const lines = reportLines(result);
    expect(lines[2]).toBe(WEAK_LINE);
    expect(lines).toContain(
      '  match: weak, the branch name shares only "cache" with this spec\'s name. To be sure this is ' +
        "the right contract, pass --spec <path> or rename the branch to the spec's name."
    );
    expect(reportLines(result, true)).toContain('  chosen by: branch name, weak, shared: cache');
    expect(lines.join('\n')).not.toMatch(/chosen by:/);
    const weak = notifications(result).find((entry) => entry.descriptor.id === 'intent-guard/spec-weak-match');
    expect(weak?.level).toBe('note');
    expect(weak?.properties.details).toEqual({
      role: 'intent',
      product: 'intent-guard',
      spec: `${SPECS}/2026-01-02-cache.md`,
      shared: ['cache'],
      weakBecause: ['single-token'],
      runnerUp: null,
    });
  });

  it('names the pull request body in the weak remedy on a pull request', () => {
    const result = conventionRun(['2026-01-02-cache.md'], 'fix/cache-tuning', { prEvent: true });
    expect(reportLines(result)).toContain(
      '  match: weak, the branch name shares only "cache" with this spec\'s name. To be sure this is ' +
        'the right contract, add a "Spec: <path>" line to the pull request body or rename the branch ' +
        "to the spec's name."
    );
  });

  // A5. Kills: omitting the runner-up.
  it('names the runner-up when the longer word decided', () => {
    const result = conventionRun(['2026-01-01-widget.md', '2026-01-02-rev.md'], 'feat/widget-rev-notes');
    const lines = reportLines(result);
    expect(lines).toContain(
      `  match: weak, the branch name shares "widget" with this spec and "rev" with ${SPECS}/2026-01-02-rev.md; ` +
        'the longer word decided it. To be sure this is the right contract, pass --spec <path> or rename ' +
        "the branch to the spec's name."
    );
    expect(reportLines(result, true)).toContain(
      `  chosen by: branch name, weak, shared: widget, runner-up ${SPECS}/2026-01-02-rev.md`
    );
  });

  it('prints the chosen-by line for an exact choice too, under --verbose only', () => {
    const result = conventionRun(['2026-09-03-widget-cache-design.md'], 'feat/widget-cache', { second: true });
    expect(renderText(result).trimEnd().split('\n')).toHaveLength(1);
    expect(reportLines(result, true)).toContain('  chosen by: branch name, exact, shared: widget cache');
    expect(reportLines(result, true).join('\n')).not.toMatch(/match: weak|intent-spec:/);
  });

  // A7, run level. Kills: dropping the legacy clause; isFullyClean ignoring
  // a skip that carries legacy.
  it('says a branch 0.10.0 bound is now skipped, on line 3, in SARIF, and off the one-line summary', () => {
    const result = conventionRun(['2026-01-01-widgets-layer.md'], 'feat/widget', { second: true });
    expect(result.exitCode).toBe(0);
    expect(result.skipped[0].detail).toContain('Before conductor 0.11.0 this branch name chose');
    expect(reportLines(result)[2]).toBe(NONE_CHANGED_LINE);
    expect(renderText(result).trimEnd().split('\n').length).toBeGreaterThan(1);
    const skipped = notifications(result).find((entry) => entry.descriptor.id === 'intent-guard/no-contract');
    expect(skipped?.properties.details).toMatchObject({ legacySelection: '2026-01-01-widgets-layer.md' });
  });

  // A8. Kills: any code path that downgrades a weak selection's enforcement
  // or verdict.
  it('keeps a weak selection blocking and enforced', () => {
    const result = conventionRun(['2026-01-02-cache.md'], 'fix/cache-tuning', { check: CHECK_BLOCKING, exit: 1 });
    const source = result.gates[0].intent?.contractSource;
    expect(source?.kind === 'imported' ? source.match?.strength : null).toBe('weak');
    expect(result.exitCode).toBe(1);
    // The blocking fixture carries two blocking findings; the token is the
    // same one an exact selection of the same spec gets.
    expect(verdictToken(result, false)).toBe('blocked (2)');
    const exact = conventionRun(['2026-01-02-cache.md'], 'feat/cache', { check: CHECK_BLOCKING, exit: 1 });
    expect(verdictToken(exact, false)).toBe('blocked (2)');
    expect(result.gates[0].enforce).toBe(true);
  });

  it('handles a weak selection under enforce: false exactly as an exact one', () => {
    const weak = conventionRun(['2026-01-02-cache.md'], 'fix/cache-tuning', { check: CHECK_BLOCKING, exit: 1, enforce: false });
    const exact = conventionRun(['2026-01-02-cache.md'], 'feat/cache', { check: CHECK_BLOCKING, exit: 1, enforce: false });
    const source = exact.gates[0].intent?.contractSource;
    expect(source?.kind === 'imported' ? source.match?.strength : null).toBe('exact');
    expect([weak.exitCode, verdictToken(weak, false), weak.gates[0].enforce]).toEqual([
      exact.exitCode,
      verdictToken(exact, false),
      exact.gates[0].enforce,
    ]);
  });

  // A10. Kills: no note line for a changed winner; the header line missing
  // or printing the weak string instead; letting legacy decide the winner.
  it('notes a changed winner in the gate block, SARIF and line 3', () => {
    const result = conventionRun(
      ['2026-01-01-alpha-and-the-beta.md', '2026-01-02-beta-gamma-omega.md'],
      'feat/alpha-and-the-beta-gamma-omega',
      { second: true }
    );
    expect(result.exitCode).toBe(0);
    // The spec actually imported is the new winner, never the legacy answer.
    const source = result.gates.find((gate) => gate.role === 'intent')?.intent?.contractSource;
    expect(source?.kind === 'imported' ? source.spec : null).toBe(`${SPECS}/2026-01-02-beta-gamma-omega.md`);
    const lines = reportLines(result);
    expect(lines[2]).toBe(WINNER_CHANGED_LINE);
    expect(lines).toContain(
      `  note: Before conductor 0.11.0 this branch name chose ${SPECS}/2026-01-01-alpha-and-the-beta.md; ` +
        'it now chooses this spec, which matches it on whole words.'
    );
    expect(lines.join('\n')).not.toMatch(/match: weak/);
    expect(renderText(result).trimEnd().split('\n').length).toBeGreaterThan(1);
    const log = JSON.parse(renderSarif(result, '0.11.0')) as SarifLog;
    const intentRun = log.runs.find((entry) => entry.tool.driver.name === 'intent-guard');
    expect(intentRun?.properties?.legacySelection).toBe('2026-01-01-alpha-and-the-beta.md');
  });

  it('prints the changed-winner line, not the weak one, when the new winner is weak', () => {
    const result = conventionRun(['2026-01-01-gamma.md', '2026-01-02-gamma-omegas-delta-long.md'], 'feat/gamma-omega');
    const lines = reportLines(result);
    expect(lines[2]).toBe(WINNER_CHANGED_LINE);
    expect(lines.filter((line) => line.startsWith('intent-spec:'))).toEqual([WINNER_CHANGED_LINE]);
    expect(lines.some((line) => line.startsWith('  match: weak, the branch name shares only "gamma"'))).toBe(true);
    expect(lines).toContain(
      `  note: Before conductor 0.11.0 this branch name chose ${SPECS}/2026-01-02-gamma-omegas-delta-long.md; ` +
        'it now chooses this spec, which matches it on whole words.'
    );
    const weak = notifications(result).find((entry) => entry.descriptor.id === 'intent-guard/spec-weak-match');
    expect(weak?.properties.details).toMatchObject({ legacySelection: '2026-01-02-gamma-omegas-delta-long.md' });
  });

  // O2. Kills: printing raw slug tokens as shared (measured red). It does NOT
  // kill dropping the charset rule, which U2 in tests/intent-spec.test.ts does.
  it('prints no character of the branch name beyond the shared words', () => {
    const result = conventionRun(['2026-01-01-cache.md'], 'feat/`x`-cache');
    const lines = reportLines(result, true);
    const matchLine = lines.find((line) => line.startsWith('  match: weak')) ?? '';
    expect(matchLine).toContain('"cache"');
    expect(matchLine).not.toContain('`');
    expect(lines.find((line) => line.startsWith('  chosen by:'))).toBe('  chosen by: branch name, weak, shared: cache');
    expect(lines[2]).toBe(WEAK_LINE);
    const weak = notifications(result).find((entry) => entry.descriptor.id === 'intent-guard/spec-weak-match');
    expect(JSON.stringify(weak)).not.toContain('`');
  });
});

/**
 * The expected version is decided BEFORE the intent preparation (residual 3,
 * 2026-10-20). The preparation spawns the resolved intent-guard twice
 * (import-spec, freeze) before runGate reaches the version check, and a
 * failed preparation then `continue`d past it. On an Action push run (no
 * trust base, so node_modules/.bin outranks the Action's install) with the
 * spec or base-ref input set and `enforce: false`, an off-pin devDependency
 * whose import-spec failed read preparation-failed, not enforced, exit 0,
 * where runGate would have said version-skew, exit 2. At the end of the file
 * so the cited lines above do not move.
 */
describe('the expected intent-guard version, before the preparation', () => {
  const PIN = { CONDUCTOR_EXPECTED_INTENT_GUARD_VERSION: '1.9.0' };

  /** The repository's own intent-guard in node_modules/.bin, logging every non-version invocation. */
  function devDependency(
    root: string,
    version: string,
    importSpec: { stdout?: string; stderr?: string; exit?: number }
  ): string {
    const log = path.join(tempDir(), 'invocations.txt');
    stubIntentGuard(path.join(root, 'node_modules', '.bin'), {
      importSpec,
      freeze: { stdout: FREEZE },
      check: { stdout: CHECK_PASSING },
      version,
      argvLog: log,
    });
    return log;
  }

  /** A push-shaped run: a base ref (the Action's base-ref input) and no trust base. */
  function pushRun(root: string, options: { env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}): RunResult {
    return runAll(INTENT_UNENFORCED, {
      repoRoot: root,
      staged: false,
      pathValue: tempDir(),
      env: options.env ?? PIN,
      base: 'main',
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    });
  }

  const FAILING = { stderr: 'import-spec: no.', exit: 2 };

  it('is version-skew and exit 2 for an off-pin intent-guard whose preparation would fail, with enforce: false and no trust base', () => {
    const root = repo();
    devDependency(root, '1.4.0', FAILING);

    const result = pushRun(root);

    expect(result.gates[0].couldNotRun?.reason).toBe('version-skew');
    expect(result.gates[0].couldNotRun?.detail).toContain(
      `intent-guard did not run: the build resolved from ${path.join('node_modules', '.bin', 'intent-guard')} reports version 1.4.0, but this run expects 1.9.0 (the version the action pinned).`
    );
    expect(result.gates[0].versionSkew).toMatchObject({ expected: '1.9.0', found: '1.4.0', source: 'node_modules' });
    expect(result.gates[0].enforce).toBe(true);
    expect(result.exitCode).toBe(2);
  });

  it('never spawns an off-pin intent-guard for import-spec or freeze, even when its preparation would succeed', () => {
    const root = repo();
    const log = devDependency(root, '1.4.0', { stdout: IMPORT_DRY_RUN });

    const result = pushRun(root);

    expect(existsSync(log)).toBe(false);
    expect(result.gates[0].couldNotRun?.reason).toBe('version-skew');
    expect(result.gates[0].productVersion).toBe('1.4.0');
    expect(result.exitCode).toBe(2);
  });

  it('is version-unverified before the preparation when the version cannot be read under the expectation', () => {
    const root = repo();
    const log = devDependency(root, 'not a version', FAILING);

    const result = pushRun(root);

    expect(existsSync(log)).toBe(false);
    expect(result.gates[0].couldNotRun?.reason).toBe('version-unverified');
    expect(result.gates[0].enforce).toBe(true);
    expect(result.exitCode).toBe(2);
  });

  it('is an enforced time-out before the preparation when the version probe is stopped under the expectation', () => {
    const root = repo();
    const log = path.join(tempDir(), 'invocations.txt');
    const planted = path.join(root, 'node_modules', '.bin', 'intent-guard');
    mkdirSync(path.dirname(planted), { recursive: true });
    writeFileSync(
      planted,
      [
        '#!/bin/sh',
        `if [ "$1" != "--version" ]; then printf '%s\\n' "$1" >> ${JSON.stringify(log)}; exit 2; fi`,
        'sleep 5',
        'echo "1.9.0"',
      ].join('\n') + '\n'
    );
    chmodSync(planted, 0o755);

    const result = pushRun(root, { timeoutMs: 300 });

    expect(existsSync(log)).toBe(false);
    expect(result.gates[0].couldNotRun?.reason).toBe('timed-out');
    expect(result.gates[0].couldNotRun?.timedOut?.step).toBe('version-probe');
    expect(result.gates[0].enforce).toBe(true);
    expect(result.exitCode).toBe(2);
  });

  it('is version-skew, not preparation-failed, for an off-pin PATH intent-guard under a trust base', () => {
    const root = repo();
    const bin = tempDir();
    const log = path.join(tempDir(), 'invocations.txt');
    stubIntentGuard(bin, {
      importSpec: FAILING,
      freeze: { stdout: FREEZE },
      check: { stdout: CHECK_PASSING },
      version: '1.8.0',
      argvLog: log,
    });

    const result = runAll(INTENT_UNENFORCED, {
      repoRoot: root,
      staged: false,
      pathValue: bin,
      env: PIN,
      base: 'main',
      trustBase: { ref: 'main', policyChanged: false, refusal: null },
    });

    expect(existsSync(log)).toBe(false);
    expect(result.gates[0].couldNotRun?.reason).toBe('version-skew');
    expect(result.exitCode).toBe(2);
  });

  it('keeps the policy enforce for an on-pin intent-guard whose preparation fails with no trust base', () => {
    // Unchanged by this fix, pinned on purpose. The build IS the pinned one,
    // so the version decision has nothing to say, and off a trust base an
    // unenforced gate that could not be prepared is a note, the same as any
    // other could-not-run of an on-pin gate under enforce: false.
    const root = repo();
    const log = devDependency(root, '1.9.0', FAILING);

    const result = pushRun(root);

    expect(readFileSync(log, 'utf8')).toContain('import-spec');
    expect(result.gates[0].couldNotRun?.reason).toBe('preparation-failed');
    expect(result.gates[0].enforce).toBe(false);
    expect(result.exitCode).toBe(0);
  });

  it('changes nothing without the expectation: an off-pin intent-guard is prepared as before', () => {
    const root = repo();
    const log = devDependency(root, '1.4.0', FAILING);

    const result = pushRun(root, { env: {} });

    expect(readFileSync(log, 'utf8')).toContain('import-spec');
    expect(result.gates[0].couldNotRun?.reason).toBe('preparation-failed');
    expect(result.gates[0].enforce).toBe(false);
    expect(result.exitCode).toBe(0);
  });

  it('is version-skew for an off-pin intent-guard even when the repository has no spec, and a skip without the expectation', () => {
    // The version is decided before preparation, so an off-pin build never
    // reaches the no-contract skip under the action: the same answer runGate
    // gives a run that is not pull-request shaped. Without the expectation
    // the skip is unchanged.
    const root = repo({ spec: false });
    const log = devDependency(root, '1.4.0', FAILING);

    const pinned = pushRun(root);

    expect(existsSync(log)).toBe(false);
    expect(pinned.gates[0].couldNotRun?.reason).toBe('version-skew');
    expect(pinned.exitCode).toBe(2);

    const unpinned = pushRun(root, { env: {} });

    expect(unpinned.gates).toHaveLength(0);
    expect(unpinned.exitCode).toBe(0);
  });
});
