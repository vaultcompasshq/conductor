import { afterEach, describe, expect, it } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderSarif } from '../src/output-sarif.js';
import { renderText } from '../src/output-text.js';
import { POLICY_FILE_NAME, parsePolicy } from '../src/policy.js';
import { runAll } from '../src/run.js';
import type { RunResult } from '../src/run.js';
import { stubIntentGuard } from './helpers/stub-gate.js';

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
  const dir = mkdtempSync(path.join(os.tmpdir(), 'conductor-intent-run-'));
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
  options: { base?: string; spec?: string; env?: NodeJS.ProcessEnv; enforce?: boolean } = {}
): RunResult {
  return runAll(options.enforce === false ? INTENT_UNENFORCED : INTENT_ONLY, {
    repoRoot: root,
    staged: false,
    pathValue: bin,
    env: options.env ?? {},
    ...(options.base === undefined ? {} : { base: options.base }),
    ...(options.spec === undefined ? {} : { spec: options.spec }),
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

  it('is one note in the umbrella SARIF run', () => {
    const log = JSON.parse(renderSarif(noSpecRun(), '0.2.0')) as {
      runs: Array<{
        tool: { driver: { name: string } };
        results: Array<{ ruleId: string; level: string; properties: { blocking: boolean } }>;
      }>;
    };

    const umbrella = log.runs.find((entry) => entry.tool.driver.name === 'conductor');
    const advisory = umbrella?.results.find((entry) => entry.ruleId === 'intent-guard/no-contract');
    expect(advisory?.level).toBe('note');
    expect(advisory?.properties.blocking).toBe(false);
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

describe('the report says where the contract came from', () => {
  it('names the spec and the plan and the base ref in the text report', () => {
    const text = renderText(run(repo(), binWith(CHECK_PASSING), { base: 'main' }));

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
