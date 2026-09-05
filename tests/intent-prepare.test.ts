import { afterEach, describe, expect, it } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  LEGACY_NATIVE_CONTRACT_PATH,
  NATIVE_CONTRACT_PATH,
  NATIVE_CONTRACT_PATHS,
  TEMP_PREFIX,
  isLegacyContractPath,
  prepareIntent,
} from '../src/intent-prepare.js';
import type { IntentPrepareResult } from '../src/intent-prepare.js';
import { resolveGateBinary } from '../src/resolve.js';
import { POLICY_FILE_NAME, parsePolicy } from '../src/policy.js';
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
const SPEC_BODY = readFileSync(
  path.join(FIXTURES, 'superpowers', 'specs', '2026-09-03-widget-cache-design.md'),
  'utf8'
);
const PLAN_BODY = readFileSync(
  path.join(FIXTURES, 'superpowers', 'plans', '2026-09-03-widget-cache.md'),
  'utf8'
);

const INTENT_GATE = parsePolicy(
  'version: 1\ngates:\n  intent:\n    product: intent-guard\n',
  POLICY_FILE_NAME
).gates.intent as NonNullable<ReturnType<typeof parsePolicy>['gates']['intent']>;

const temps: string[] = [];
const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    (cleanups.pop() as () => void)();
  }
  while (temps.length > 0) {
    rmSync(temps.pop() as string, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'conductor-prep-'));
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

/** A repository on a feature branch, with the widget spec and plan in it. */
function repoWithSpec(options: { plan?: boolean; branch?: string } = {}): string {
  const root = tempDir();
  git(root, ['init', '--quiet', '-b', 'main']);
  write(root, 'docs/superpowers/specs/2026-09-03-widget-cache-design.md', SPEC_BODY);
  if (options.plan !== false) {
    write(root, 'docs/superpowers/plans/2026-09-03-widget-cache.md', PLAN_BODY);
  }
  git(root, ['add', '-A']);
  git(root, [
    '-c',
    'user.email=test@example.invalid',
    '-c',
    'user.name=test',
    'commit',
    '--quiet',
    '-m',
    'spec',
  ]);
  git(root, ['checkout', '--quiet', '-b', options.branch ?? 'feat/widget-cache']);
  return root;
}

function stubbedBin(options: Parameters<typeof stubIntentGuard>[1] = {}): string {
  const bin = tempDir();
  stubIntentGuard(bin, {
    importSpec: { stdout: IMPORT_DRY_RUN },
    freeze: { stdout: FREEZE },
    check: { stdout: CHECK_PASSING },
    ...options,
  });
  return bin;
}

function prepare(
  repoRoot: string,
  bin: string,
  options: { base?: string; spec?: string; env?: NodeJS.ProcessEnv; tempRoot?: string } = {}
): IntentPrepareResult {
  const binary = resolveGateBinary(INTENT_GATE, repoRoot, bin);
  const result = prepareIntent({
    repoRoot,
    binary,
    env: options.env ?? {},
    ...(options.base === undefined ? {} : { base: options.base }),
    ...(options.spec === undefined ? {} : { spec: options.spec }),
    ...(options.tempRoot === undefined ? {} : { tempRoot: options.tempRoot }),
  });
  if (result.kind === 'ready') {
    cleanups.push(result.preparation.cleanup);
  }
  return result;
}

function argvLines(logFile: string): string[] {
  return readFileSync(logFile, 'utf8').trim().split('\n');
}

describe('a repository whose own contract is frozen', () => {
  function repoWithFrozenContract(): string {
    const root = repoWithSpec();
    write(
      root,
      '.conductor/intent-contract.yaml',
      ['contract_id: ic-1', 'frozen_by: user', 'approval:', '  approved_by: a person', ''].join('\n')
    );
    return root;
  }

  it('uses the contract as-is, even with a spec sitting beside it', () => {
    const result = prepare(repoWithFrozenContract(), stubbedBin());

    expect(result.kind).toBe('ready');
    expect(result.kind === 'ready' && result.preparation.contractSource).toEqual({
      kind: 'native',
      path: '.conductor/intent-contract.yaml',
    });
  });

  it('runs the gate against the repository itself rather than a temporary copy', () => {
    const result = prepare(repoWithFrozenContract(), stubbedBin());

    expect(result.kind === 'ready' && result.preparation.projectDir).toBe('.');
  });

  it('imports nothing, so the spec is never read', () => {
    const bin = tempDir();
    const log = path.join(bin, 'argv.log');
    stubIntentGuard(bin, { argvLog: log, importSpec: { stdout: IMPORT_DRY_RUN } });

    prepare(repoWithFrozenContract(), bin);

    expect(existsSync(log)).toBe(false);
  });

  it('imports the spec when a contract has an approval block but no frozen_by', () => {
    // frozen_by is the marker the GATE reads. Accepting an approval block on
    // its own meant a half-written or hand-edited contract was treated as the
    // repository's own frozen one, the import was skipped, and the gate then
    // blocked every pull request with "exists but is not frozen by user":
    // the exact failure this check exists to prevent.
    const root = repoWithSpec();
    write(
      root,
      '.conductor/intent-contract.yaml',
      'contract_id: ic-1\napproval:\n  approved_by: a person\n'
    );

    const result = prepare(root, stubbedBin());

    expect(result.kind === 'ready' && result.preparation.contractSource.kind).toBe('imported');
  });

  it('imports the spec anyway when the contract is present but not frozen', () => {
    // "Exists" is not the test, "frozen" is. An unfrozen contract is a draft
    // somebody left behind, and running the gate against it makes every pull
    // request fail on "not frozen by user" instead of checking anything.
    const root = repoWithSpec();
    write(root, '.conductor/intent-contract.yaml', 'contract_id: ic-1\n');

    const result = prepare(root, stubbedBin());

    expect(result.kind === 'ready' && result.preparation.contractSource.kind).toBe('imported');
  });
});

describe('a --spec and a frozen native contract in the same repository', () => {
  // Which one wins is held only by branch order in prepareIntent, and nothing
  // put both in one repository to find out. A person passing --spec has named
  // the document the work was approved from, by hand, for this run; silently
  // running the repository's own contract instead would check the change
  // against a different agreement and report a clean result for it.
  function repoWithBoth(): string {
    const root = repoWithSpec();
    write(
      root,
      NATIVE_CONTRACT_PATH,
      ['contract_id: ic-native', 'frozen_by: user', 'approval:', '  approved_by: a person', ''].join(
        '\n'
      )
    );
    return root;
  }

  const FLAGGED_SPEC = 'docs/superpowers/specs/2026-09-03-widget-cache-design.md';

  it('imports the spec the flag named rather than using the native contract', () => {
    const result = prepare(repoWithBoth(), stubbedBin(), { spec: FLAGGED_SPEC });

    expect(result.kind).toBe('ready');
    expect(result.kind === 'ready' && result.preparation.contractSource).toEqual({
      kind: 'imported',
      spec: FLAGGED_SPEC,
      plan: 'docs/superpowers/plans/2026-09-03-widget-cache.md',
    });
  });

  it('actually imports and freezes it, rather than pointing the gate at the repository', () => {
    const bin = tempDir();
    const log = path.join(bin, 'argv.log');
    stubIntentGuard(bin, {
      argvLog: log,
      importSpec: { stdout: IMPORT_DRY_RUN },
      freeze: { stdout: FREEZE },
    });

    const result = prepare(repoWithBoth(), bin, { spec: FLAGGED_SPEC });

    // "." is what the native path hands the gate. A temporary directory is the
    // evidence the import ran.
    expect(result.kind === 'ready' && result.preparation.projectDir).not.toBe('.');
    expect(argvLines(log).some((line) => line.includes('import-spec'))).toBe(true);
    expect(argvLines(log).some((line) => line.includes('freeze'))).toBe(true);
  });
});

describe('a repository with a spec and no frozen contract', () => {
  it('reports the spec and plan it imported', () => {
    const result = prepare(repoWithSpec(), stubbedBin());

    expect(result.kind === 'ready' && result.preparation.contractSource).toEqual({
      kind: 'imported',
      spec: 'docs/superpowers/specs/2026-09-03-widget-cache-design.md',
      plan: 'docs/superpowers/plans/2026-09-03-widget-cache.md',
    });
  });

  it('runs import-spec against the repository, with the spec and plan named', () => {
    const bin = tempDir();
    const log = path.join(bin, 'argv.log');
    stubIntentGuard(bin, {
      argvLog: log,
      importSpec: { stdout: IMPORT_DRY_RUN },
      freeze: { stdout: FREEZE },
    });
    const root = repoWithSpec();

    prepare(root, bin);

    const importLine = argvLines(log).find((line) => line.startsWith('import-spec'));
    expect(importLine).toMatch(/--project \./);
    expect(importLine).toMatch(/--from superpowers/);
    expect(importLine).toMatch(/--dry-run/);
    expect(importLine).toMatch(/2026-09-03-widget-cache-design\.md/);
    expect(importLine).toMatch(/--plan \S*2026-09-03-widget-cache\.md/);
  });

  it('passes no --plan when there is no plan beside the spec', () => {
    const bin = tempDir();
    const log = path.join(bin, 'argv.log');
    stubIntentGuard(bin, {
      argvLog: log,
      importSpec: { stdout: IMPORT_DRY_RUN },
      freeze: { stdout: FREEZE },
    });

    prepare(repoWithSpec({ plan: false }), bin);

    const importLine = argvLines(log).find((line) => line.startsWith('import-spec')) ?? '';
    expect(importLine).not.toMatch(/--plan/);
  });

  it('writes the drafted contract into a temporary directory, never into the repository', () => {
    const root = repoWithSpec();

    const result = prepare(root, stubbedBin());

    expect(result.kind).toBe('ready');
    const project = result.kind === 'ready' ? result.preparation.projectDir : '';
    expect(project.startsWith(root)).toBe(false);
    expect(existsSync(path.join(project, '.conductor', 'intent-contract.yaml'))).toBe(true);
    // The repository is untouched.
    expect(existsSync(path.join(root, '.conductor'))).toBe(false);
  });

  it('writes exactly the contract_yaml the tool drafted', () => {
    const root = repoWithSpec();
    const drafted = (JSON.parse(IMPORT_DRY_RUN) as { contract_yaml: string }).contract_yaml;

    const result = prepare(root, stubbedBin());
    const project = result.kind === 'ready' ? result.preparation.projectDir : '';

    expect(readFileSync(path.join(project, '.conductor', 'intent-contract.yaml'), 'utf8')).toBe(
      drafted
    );
  });

  it('freezes the temporary contract, attributing it to the spec and the commit', () => {
    const bin = tempDir();
    const log = path.join(bin, 'argv.log');
    stubIntentGuard(bin, {
      argvLog: log,
      importSpec: { stdout: IMPORT_DRY_RUN },
      freeze: { stdout: FREEZE },
    });
    const root = repoWithSpec();
    const sha = git(root, ['rev-parse', '--short', 'HEAD']).trim();

    prepare(root, bin);

    const freezeLine = argvLines(log).find((line) => line.startsWith('freeze')) ?? '';
    expect(freezeLine).toMatch(/--yes/);
    expect(freezeLine).toMatch(/--json/);
    expect(freezeLine).toContain('docs/superpowers/specs/2026-09-03-widget-cache-design.md');
    expect(freezeLine).toContain(sha);
  });

  it('removes the temporary directory when the caller cleans up', () => {
    const result = prepare(repoWithSpec(), stubbedBin());
    const project = result.kind === 'ready' ? result.preparation.projectDir : '';
    expect(existsSync(project)).toBe(true);

    if (result.kind === 'ready') {
      result.preparation.cleanup();
    }

    expect(existsSync(project)).toBe(false);
  });
});

describe('a repository with neither a contract nor a spec', () => {
  it('is a skip naming the reason, not a failure', () => {
    const root = repoWithSpec({ branch: 'feat/something-else-entirely' });

    const result = prepare(root, stubbedBin());

    expect(result.kind).toBe('skip');
    expect(result.kind === 'skip' && result.detail).toMatch(/docs\/superpowers\/specs/);
  });

  it('never runs git, so a shallow checkout cannot turn a missing spec into a failure', () => {
    const root = repoWithSpec({ branch: 'feat/something-else-entirely' });

    const result = prepare(root, stubbedBin(), { base: 'origin/does-not-exist' });

    expect(result.kind).toBe('skip');
  });
});

describe('every step of the chain names itself when it fails', () => {
  it('names the base step when git cannot resolve the ref', () => {
    const result = prepare(repoWithSpec(), stubbedBin(), { base: 'origin/nope' });

    expect(result.kind).toBe('failed');
    expect(result.kind === 'failed' && result.step).toBe('base');
    expect(result.kind === 'failed' && result.detail).toMatch(/origin\/nope/);
  });

  it('names the spec step when --spec points at nothing', () => {
    const result = prepare(repoWithSpec(), stubbedBin(), { spec: 'docs/nope.md' });

    expect(result.kind).toBe('failed');
    expect(result.kind === 'failed' && result.step).toBe('spec');
    expect(result.kind === 'failed' && result.detail).toMatch(/docs\/nope\.md/);
  });

  it('names the import-spec step when the import exits non-zero', () => {
    const result = prepare(
      repoWithSpec(),
      stubbedBin({ importSpec: { stdout: '', stderr: 'no spec dir', exit: 1 } })
    );

    expect(result.kind === 'failed' && result.step).toBe('import-spec');
    expect(result.kind === 'failed' && result.detail).toMatch(/no spec dir/);
  });

  it('names the import-spec step when the import prints something unreadable', () => {
    const result = prepare(repoWithSpec(), stubbedBin({ importSpec: { stdout: 'not json' } }));

    expect(result.kind === 'failed' && result.step).toBe('import-spec');
  });

  it('names the import-spec step when the draft carries no contract', () => {
    const result = prepare(
      repoWithSpec(),
      stubbedBin({ importSpec: { stdout: JSON.stringify({ valid: false }) } })
    );

    expect(result.kind === 'failed' && result.step).toBe('import-spec');
    expect(result.kind === 'failed' && result.detail).toMatch(/contract_yaml/);
  });

  it('names the freeze step when the approval fails', () => {
    const result = prepare(
      repoWithSpec(),
      stubbedBin({ freeze: { stdout: '', stderr: 'refused', exit: 1 } })
    );

    expect(result.kind === 'failed' && result.step).toBe('freeze');
    expect(result.kind === 'failed' && result.detail).toMatch(/refused/);
  });

  it('leaves no temporary directory behind when a step fails', () => {
    // A failed run still created a directory and wrote a contract into it.
    // Counting them either side is the only way to see that from out here,
    // and a leak here is a leak per pull request on a CI runner.
    //
    // Counted in a temporary root of this test's OWN, never in the shared
    // one. This half and the success half in tests/intent-run.test.ts both
    // used to count entries in os.tmpdir() itself, and the two files can run
    // in parallel jest workers, so each was counting the other's directories
    // and the number could move in either direction between the two reads.
    // TMPDIR cannot steer this from here: node reads that from the real
    // process environment and a jest test's process.env is a copy, so the
    // root is injected instead, the same way the environment already is.
    const tempRoot = tempDir();

    const result = prepare(
      repoWithSpec(),
      stubbedBin({ freeze: { stdout: '', stderr: 'refused', exit: 1 } }),
      { tempRoot }
    );

    // The chain has to have got as far as writing the contract, or this
    // would pass on a directory that was never created.
    expect(result.kind === 'failed' && result.step).toBe('freeze');
    expect(readdirSync(tempRoot).filter((entry) => entry.startsWith(TEMP_PREFIX))).toEqual([]);
  });

  it('names the import-spec step when only the per-command binary is installed', () => {
    // intent-guard-check has no import-spec subcommand, so the imported
    // contract flow genuinely cannot run there. Saying so beats spawning it
    // and reading whatever a wrong argv prints.
    const bin = tempDir();
    stubIntentGuard(bin, {});
    const perCommand = tempDir();
    execFileSync('cp', [path.join(bin, 'intent-guard'), path.join(perCommand, 'intent-guard-check')]);

    const result = prepare(repoWithSpec(), perCommand);

    expect(result.kind === 'failed' && result.step).toBe('import-spec');
    expect(result.kind === 'failed' && result.detail).toMatch(/intent-guard-check/);
  });
});

describe('the changed-path set handed to the gate', () => {
  it('is the branch diff when a base ref was resolved', () => {
    const root = repoWithSpec();
    write(root, 'src/widget/cache.ts', 'export const cache = 1;\n');
    git(root, ['add', '-A']);
    git(root, [
      '-c',
      'user.email=test@example.invalid',
      '-c',
      'user.name=test',
      'commit',
      '--quiet',
      '-m',
      'work',
    ]);

    const result = prepare(root, stubbedBin(), { base: 'main' });

    expect(result.kind === 'ready' && result.preparation.paths).toEqual(['src/widget/cache.ts']);
    expect(result.kind === 'ready' && result.preparation.baseRef).toBe('main');
  });

  it('is null with no base ref at all, which leaves the v0.1 staged behaviour alone', () => {
    const result = prepare(repoWithSpec(), stubbedBin());

    expect(result.kind === 'ready' && result.preparation.paths).toBeNull();
    expect(result.kind === 'ready' && result.preparation.baseRef).toBeNull();
  });

  it('takes the base from the pull request environment when no --base was given', () => {
    const root = repoWithSpec();

    const result = prepare(root, stubbedBin(), {
      env: { GITHUB_BASE_REF: 'main' },
    });

    // origin/main does not exist in this scratch repository, so this fails
    // closed rather than quietly checking nothing, which is the point.
    expect(result.kind === 'failed' && result.step).toBe('base');
    expect(result.kind === 'failed' && result.detail).toMatch(/origin\/main/);
  });

  it('takes the branch from GITHUB_HEAD_REF, since a CI checkout is on a detached head', () => {
    const root = repoWithSpec({ branch: 'ci-detached-stand-in' });

    const result = prepare(root, stubbedBin(), {
      env: { GITHUB_HEAD_REF: 'feat/widget-cache' },
    });

    expect(result.kind === 'ready' && result.preparation.contractSource.kind).toBe('imported');
  });
});

describe('a pull request body that waives the spec', () => {
  /** An environment pointing at an event payload carrying this body. */
  function eventWith(body: string): NodeJS.ProcessEnv {
    const file = path.join(tempDir(), 'event.json');
    writeFileSync(file, JSON.stringify({ pull_request: { body } }));
    return { GITHUB_EVENT_PATH: file };
  }

  it('is a skip whose reason is the waiver, not a missing spec', () => {
    // The branch's own spec IS on disk here, so a run that reported
    // no-contract would be reporting the wrong thing twice over: the spec
    // exists, and the body said not to use one.
    const root = repoWithSpec();

    const result = prepare(root, stubbedBin(), { env: eventWith('Spec: none\n') });

    expect(result.kind).toBe('skip');
    expect(result.kind === 'skip' && result.reason).toBe('contract-waived');
    expect(result.kind === 'skip' && result.detail).toMatch(/pull request body/);
  });

  it('still loses to a frozen contract the repository has of its own', () => {
    // A waiver says there is nothing to IMPORT. It does not switch off a
    // contract somebody in this repository froze and committed.
    const root = repoWithSpec();
    write(
      root,
      NATIVE_CONTRACT_PATH,
      ['contract_id: ic-native', 'frozen_by: user', 'approval:', '  approved_by: a person', ''].join(
        '\n'
      )
    );

    const result = prepare(root, stubbedBin(), { env: eventWith('Spec: none\n') });

    expect(result.kind).toBe('ready');
    expect(result.kind === 'ready' && result.preparation.contractSource).toEqual({
      kind: 'native',
      path: NATIVE_CONTRACT_PATH,
    });
  });
});

/**
 * intent-guard 1.3.0 renamed its per-project state directory.
 *
 * `.conductor` became `.intent-guard`, because `.conductor` is now the name
 * of a different product in the same family and a repository adopting both
 * showed `.conductor/` and `.guardrails/` side by side. The two versions will
 * be installed across repositories at the same time for as long as anybody is
 * slow to upgrade, so the umbrella reads both. A gate whose contract the
 * umbrella cannot find is a pull request blocked on nothing.
 */
describe('the intent-guard state directory, under both of its names', () => {
  const FROZEN = ['contract_id: ic-1', 'frozen_by: user', 'approval:', '  approved_by: a person', ''].join(
    '\n'
  );
  /** Present, and deliberately NOT frozen: a draft somebody left behind. */
  const DRAFT = 'contract_id: ic-draft\n';

  it('declares the two paths canonical first', () => {
    // The order IS the rule, and this pins the DECLARATION of it rather than
    // each use: every consumer reads NATIVE_CONTRACT_PATHS instead of
    // spelling the pair itself. It is worth saying what this does not prove.
    // On the repository side the order is not observable, because two frozen
    // contracts is a refusal rather than a choice; the place it decides
    // anything is the lookup inside a prepared temporary project, where the
    // freeze may have left a file under either name.
    expect(NATIVE_CONTRACT_PATHS).toEqual([NATIVE_CONTRACT_PATH, LEGACY_NATIVE_CONTRACT_PATH]);
  });

  it('reads the canonical directory', () => {
    const root = repoWithSpec();
    write(root, NATIVE_CONTRACT_PATH, FROZEN);

    const result = prepare(root, stubbedBin());

    expect(result.kind).toBe('ready');
    expect(result.kind === 'ready' && result.preparation.contractSource).toEqual({
      kind: 'native',
      path: NATIVE_CONTRACT_PATH,
    });
    expect(isLegacyContractPath(NATIVE_CONTRACT_PATH)).toBe(false);
  });

  it('falls back to the legacy directory, and says which one it read', () => {
    // The repository that has not upgraded intent-guard yet. Its contract is
    // used exactly as a canonical one is; the only difference is that the
    // source path says where it came from, which is what the report and the
    // SARIF notification are built out of.
    const root = repoWithSpec();
    write(root, LEGACY_NATIVE_CONTRACT_PATH, FROZEN);

    const result = prepare(root, stubbedBin());

    expect(result.kind).toBe('ready');
    expect(result.kind === 'ready' && result.preparation.contractSource).toEqual({
      kind: 'native',
      path: LEGACY_NATIVE_CONTRACT_PATH,
    });
    expect(isLegacyContractPath(LEGACY_NATIVE_CONTRACT_PATH)).toBe(true);
    expect(result.kind === 'ready' && result.preparation.projectDir).toBe('.');
  });

  it('refuses when both directories hold a frozen contract, and names both', () => {
    // The state intent-guard 1.3.0 itself refuses to run any command in.
    // Picking one would silently discard the other, and the two can disagree
    // about what was approved, so the gate cannot run at all.
    const root = repoWithSpec();
    write(root, NATIVE_CONTRACT_PATH, FROZEN);
    write(root, LEGACY_NATIVE_CONTRACT_PATH, FROZEN);

    const result = prepare(root, stubbedBin());

    expect(result.kind).toBe('failed');
    expect(result.kind === 'failed' && result.step).toBe('contract-source');
    const detail = result.kind === 'failed' ? result.detail : '';
    expect(detail).toContain(NATIVE_CONTRACT_PATH);
    expect(detail).toContain(LEGACY_NATIVE_CONTRACT_PATH);
  });

  it('lets the canonical one win over a leftover DRAFT in the legacy directory', () => {
    // The narrower ambiguity test, and the reason for it. intent-guard
    // refuses when both DIRECTORIES exist; this refuses only when both hold a
    // contract somebody approved. A stale unfrozen draft beside a real
    // contract has an obvious right answer, and refusing to give it would
    // fail pull requests over a file nobody has looked at in months.
    const root = repoWithSpec();
    write(root, NATIVE_CONTRACT_PATH, FROZEN);
    write(root, LEGACY_NATIVE_CONTRACT_PATH, DRAFT);

    const result = prepare(root, stubbedBin());

    expect(result.kind).toBe('ready');
    expect(result.kind === 'ready' && result.preparation.contractSource).toEqual({
      kind: 'native',
      path: NATIVE_CONTRACT_PATH,
    });
  });

  it('imports the spec when neither directory holds a frozen contract', () => {
    const root = repoWithSpec();
    write(root, NATIVE_CONTRACT_PATH, DRAFT);
    write(root, LEGACY_NATIVE_CONTRACT_PATH, DRAFT);

    const result = prepare(root, stubbedBin());

    expect(result.kind === 'ready' && result.preparation.contractSource.kind).toBe('imported');
  });

  it('names both paths when there is nothing to check against at all', () => {
    const root = repoWithSpec({ plan: false });
    rmSync(path.join(root, 'docs'), { recursive: true, force: true });

    const result = prepare(root, stubbedBin());

    expect(result.kind).toBe('skip');
    const detail = result.kind === 'skip' ? result.detail : '';
    expect(detail).toContain(NATIVE_CONTRACT_PATH);
    expect(detail).toContain(LEGACY_NATIVE_CONTRACT_PATH);
  });

  it('refuses on the ambiguity even when --spec would have taken the import path', () => {
    // The check sits ABOVE the flag on purpose. The import path runs
    // "import-spec --project ." in this same repository, where a 1.3.0
    // intent-guard fails closed on the same ambiguity and reports it as an
    // opaque non-zero exit from a subcommand. One sentence naming both paths
    // beats that, and it is the same answer either way.
    const root = repoWithSpec();
    write(root, NATIVE_CONTRACT_PATH, FROZEN);
    write(root, LEGACY_NATIVE_CONTRACT_PATH, FROZEN);

    const result = prepare(root, stubbedBin(), {
      spec: 'docs/superpowers/specs/2026-09-03-widget-cache-design.md',
    });

    expect(result.kind === 'failed' && result.step).toBe('contract-source');
  });

  it('writes the drafted contract under the legacy name, which both versions find', () => {
    // Version independence, in the one direction that works. A 1.2.x
    // intent-guard reads only the legacy directory; a 1.3.0 one reads it as
    // the fallback and renames it to the canonical name on its first write,
    // which the freeze is. Writing the canonical name instead would work on
    // 1.3.0 and leave 1.2.x freezing an empty project.
    const result = prepare(repoWithSpec(), stubbedBin());

    const project = result.kind === 'ready' ? result.preparation.projectDir : '';
    expect(existsSync(path.join(project, LEGACY_NATIVE_CONTRACT_PATH))).toBe(true);
  });

  it('fails closed when freeze reports success but leaves no contract behind', () => {
    // Exit 0 is not proof there is a contract to hand the gate. freeze writes
    // through intent-guard's own state directory, so a build that put it
    // somewhere neither name covers has to be a named preparation failure
    // here rather than a confusing verdict from the gate three steps later.
    const bin = stubFreezeThatWritesNowhere();

    const result = prepare(repoWithSpec(), bin);

    expect(result.kind).toBe('failed');
    expect(result.kind === 'failed' && result.step).toBe('freeze');
    const detail = result.kind === 'failed' ? result.detail : '';
    expect(detail).toContain(NATIVE_CONTRACT_PATH);
    expect(detail).toContain(LEGACY_NATIVE_CONTRACT_PATH);
  });

  /**
   * A stub whose freeze exits 0 and removes both state directories.
   *
   * Written here rather than through stubIntentGuard, which only prints
   * canned payloads: the case being tested is a freeze that succeeds and
   * leaves the project without a contract, which no amount of canned stdout
   * can express.
   */
  function stubFreezeThatWritesNowhere(): string {
    const bin = tempDir();
    const file = path.join(bin, 'intent-guard');
    const importPayload = path.join(bin, 'import.json');
    writeFileSync(importPayload, IMPORT_DRY_RUN);
    writeFileSync(
      file,
      [
        '#!/bin/sh',
        'if [ "$1" = "--version" ]; then echo "1.3.0"; exit 0; fi',
        'case "$1" in',
        `  import-spec) cat ${JSON.stringify(importPayload)}; exit 0 ;;`,
        // $3 is the --project argument. Only the two known state directories
        // are removed, never the temporary project itself.
        '  freeze) rm -rf "$3/.intent-guard" "$3/.conductor"; exit 0 ;;',
        '  *) exit 2 ;;',
        'esac',
        '',
      ].join('\n')
    );
    chmodSync(file, 0o755);
    return bin;
  }
});
