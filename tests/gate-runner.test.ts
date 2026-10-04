import { afterEach, describe, expect, it } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  GATE_SAID_MAX_CHARS,
  TRUST_BASE_MIN_VERSION,
  decideTrustBase,
  runGate,
} from '../src/gate-runner.js';
import { useGitProgram } from '../src/git.js';
import { gateLogLines, proposalCount } from '../src/output-text.js';
import type { GatePolicy } from '../src/policy.js';
import { CLEAN_INTENT_GUARD, CLEAN_OSV_SCANNER, stubGate } from './helpers/stub-gate.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

/** The intent-guard pull-request-mode minimum, read from the table itself. */
const INTENT_MIN = TRUST_BASE_MIN_VERSION['intent-guard'] as string;

/** A version just below the given one: the previous patch, or the minor before at patch 99. */
function versionBelow(version: string): string {
  const [major, minor, patch] = version.split('.').map(Number);
  if (patch > 0) {
    return `${major}.${minor}.${patch - 1}`;
  }
  if (minor > 0) {
    return `${major}.${minor - 1}.99`;
  }
  return `${major - 1}.99.99`;
}

const temps: string[] = [];

afterEach(() => {
  while (temps.length > 0) {
    rmSync(temps.pop() as string, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'conductor-runner-'));
  temps.push(dir);
  return dir;
}

function gate(overrides: Partial<GatePolicy> = {}): GatePolicy {
  return {
    role: 'dependencies',
    product: 'dep-guard',
    enabled: true,
    options: {},
    ...overrides,
  } as GatePolicy;
}

/** A fresh repository on `main` with one commit, for gates that read git. */
function tempGitRepo(): string {
  const dir = tempDir();
  const run = (args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
  run(['init', '--quiet', '-b', 'main']);
  writeFileSync(path.join(dir, 'README.md'), '# fixture\n');
  run(['add', 'README.md']);
  run(['-c', 'user.email=test@example.invalid', '-c', 'user.name=test', 'commit', '--quiet', '-m', 'init']);
  return dir;
}

/** Commits these files, forcing past any .gitignore, so they are tracked. */
function commitFiles(repo: string, files: Record<string, string>, message: string): void {
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(repo, name)), { recursive: true });
    writeFileSync(path.join(repo, name), body);
    execFileSync('git', ['add', '-f', name], { cwd: repo });
  }
  execFileSync(
    'git',
    ['-c', 'user.email=test@example.invalid', '-c', 'user.name=test', 'commit', '--quiet', '-m', message],
    { cwd: repo }
  );
}

/** A repository with one tracked lockfile, so osv-scanner has something to be handed. */
function osvRepo(): string {
  const repo = tempGitRepo();
  commitFiles(repo, { 'package-lock.json': '{}\n' }, 'lockfile');
  return repo;
}

/** A captured fixture's text, byte for byte. */
function fixtureText(name: string): string {
  return readFileSync(path.join(FIXTURES, name), 'utf8');
}

const DEP_GUARD_JSON = readFileSync(path.join(FIXTURES, 'dep-guard-0.2.0-blocking.json'), 'utf8');
const DEP_GUARD_CLEAN = readFileSync(path.join(FIXTURES, 'dep-guard-0.2.0-clean.json'), 'utf8');

describe('running one gate', () => {
  it('normalizes a gate that ran and blocked', () => {
    const bin = tempDir();
    stubGate(bin, 'dep-guard', { stdout: DEP_GUARD_JSON, exit: 1 });

    const outcome = runGate(gate(), { repoRoot: tempDir(), staged: true, pathValue: bin });

    expect(outcome.couldNotRun).toBeNull();
    expect(outcome.exitCode).toBe(1);
    expect(outcome.findings).toHaveLength(2);
    expect(outcome.productVersion).toBe('9.9.9');
  });

  it('passes the JSON flag and --staged, and puts the passthrough block last', () => {
    const bin = tempDir();
    const log = path.join(tempDir(), 'argv.txt');
    stubGate(bin, 'dep-guard', { stdout: DEP_GUARD_CLEAN, argvLog: log });

    runGate(gate({ options: { 'fail-on': 'high', online: true } }), {
      repoRoot: tempDir(),
      staged: true,
      pathValue: bin,
    });

    expect(readFileSync(log, 'utf8').trim()).toBe(
      'scan --staged --format json --fail-on high --online'
    );
  });

  it('reports the online-flag as passed or not from its own argv, since DEP_GUARD_CLEAN carries no online object (issue #72)', () => {
    const bin = tempDir();
    stubGate(bin, 'dep-guard', { stdout: DEP_GUARD_CLEAN });

    const withFlag = runGate(gate({ options: { online: true } }), {
      repoRoot: tempDir(),
      staged: true,
      pathValue: bin,
    });
    expect(withFlag.run.details['online-flag']).toBe('passed');
    expect(withFlag.run.details.online).toBeUndefined();

    const withoutFlag = runGate(gate(), { repoRoot: tempDir(), staged: true, pathValue: bin });
    expect(withoutFlag.run.details['online-flag']).toBe('not passed');
    expect(withoutFlag.run.details.online).toBeUndefined();
  });

  it('omits --staged when the run is not a staged one', () => {
    const bin = tempDir();
    const log = path.join(tempDir(), 'argv.txt');
    stubGate(bin, 'dep-guard', { stdout: DEP_GUARD_CLEAN, argvLog: log });

    runGate(gate(), { repoRoot: tempDir(), staged: false, pathValue: bin });

    expect(readFileSync(log, 'utf8').trim()).toBe('scan --format json');
  });

  it('runs the child with the repository root as its working directory', () => {
    // vault-guard resolves its config AND its baseline from process.cwd(),
    // not from the path argument, so this is the difference between
    // scanning with the user's configuration and scanning with none.
    const bin = tempDir();
    const repo = tempDir();
    const log = path.join(tempDir(), 'cwd.txt');
    mkdirSync(bin, { recursive: true });
    const file = path.join(bin, 'vault-guard');
    writeFileSync(
      file,
      `#!/bin/sh\nif [ "$1" = "--version" ]; then echo 1.4.2; exit 0; fi\npwd > ${log}\necho '{"results":[],"run":{"fail_on":"medium","blocking_matches":0}}'\n`
    );
    chmodSync(file, 0o755);

    runGate(gate({ role: 'secrets', product: 'vault-guard' }), {
      repoRoot: repo,
      staged: true,
      pathValue: bin,
    });

    // realpath both sides: on macOS the OS temp directory resolves through
    // a symlink, so the raw strings can disagree while naming one place.
    expect(realpathSync(readFileSync(log, 'utf8').trim())).toBe(realpathSync(repo));
  });

  it('names only the configured path when a configured command does not exist', () => {
    const bin = tempDir();
    stubGate(bin, 'intent-guard', { stdout: '{}' });

    const outcome = runGate(
      gate({
        role: 'intent',
        product: 'intent-guard',
        command: '/nowhere/at/all/my-build.js',
      }),
      { repoRoot: tempDir(), staged: true, pathValue: bin }
    );

    expect(outcome.couldNotRun?.reason).toBe('configured-command-missing');
    expect(outcome.findings[0].message).toMatch(/\/nowhere\/at\/all\/my-build\.js/);
    // The candidate list is about resolution, and resolution did not happen:
    // the user named one file. Listing the names the umbrella would have
    // searched for suggests it looked for them, which it did not.
    expect(outcome.findings[0].message).not.toMatch(/conductor/);
    expect(outcome.findings[0].details.candidates).toBeUndefined();
    expect(outcome.findings[0].details.command).toBe('/nowhere/at/all/my-build.js');
  });

  it('raises the umbrella own blocking finding when an enabled gate binary is missing', () => {
    const outcome = runGate(gate(), {
      repoRoot: tempDir(),
      staged: true,
      pathValue: tempDir(),
    });

    expect(outcome.couldNotRun?.reason).toBe('binary-missing');
    expect(outcome.findings).toHaveLength(1);
    expect(outcome.findings[0].ruleId).toBe('conductor/gate-missing');
    expect(outcome.findings[0].blocking).toBe(true);
  });

  it('names the scoped @vaultcompass package for every managed gate on a LOCAL run too, never the bare name (C4)', () => {
    // The unscoped dep-guard and intent-guard names are unclaimed on npm, so
    // an agent told to "install dep-guard" could install a squatted package.
    for (const product of ['dep-guard', 'vault-guard', 'intent-guard'] as const) {
      const outcome = runGate(gate({ product }), {
        repoRoot: tempDir(),
        staged: true,
        pathValue: tempDir(),
      });
      const texts = [outcome.couldNotRun?.detail ?? '', outcome.findings[0].message];
      for (const text of texts) {
        expect(text).toContain(`@vaultcompass/${product}`);
        // Every mention of the package on an install line is the scoped one.
        expect(text).not.toMatch(new RegExp(`(?<![/@\\w-])${product}(?![\\w-]) package`));
        expect(text).not.toMatch(/Install it[.,]/);
      }
    }
  });

  it('names the two places it looked in the order it looked in them', () => {
    // The line a user reads when a gate is missing tells them where to
    // install it. Naming PATH first, after resolution was flipped to try
    // the repository's own copy first, sends them to the wrong one of the
    // two and hides that a project pin is what this tool prefers.
    const outcome = runGate(gate(), {
      repoRoot: tempDir(),
      staged: true,
      pathValue: tempDir(),
    });

    expect(outcome.couldNotRun?.detail).toMatch(
      /^no dep-guard binary in node_modules\/\.bin or on PATH\. /
    );
  });

  it('treats exit 2 as could-not-run rather than as a policy violation', () => {
    const bin = tempDir();
    stubGate(bin, 'dep-guard', { stdout: '', stderr: 'corpus unreadable', exit: 2 });

    const outcome = runGate(gate(), { repoRoot: tempDir(), staged: true, pathValue: bin });

    expect(outcome.couldNotRun?.reason).toBe('gate-error');
    expect(outcome.stderr).toMatch(/corpus unreadable/);
  });

  it('treats exit 1 with unparseable stdout as could-not-run, the rejected-config shape', () => {
    const bin = tempDir();
    stubGate(bin, 'vault-guard', {
      stdout: '',
      stderr: 'Config error: unexpected token',
      exit: 1,
    });

    const outcome = runGate(gate({ role: 'secrets', product: 'vault-guard' }), {
      repoRoot: tempDir(),
      staged: true,
      pathValue: bin,
    });

    expect(outcome.couldNotRun?.reason).toBe('unparseable-output');
    // Not an empty finding list. A gate that could not run gets no SARIF run
    // of its own, so without a finding here the published report would carry
    // no trace of the most important thing that happened.
    expect(outcome.findings.map((finding) => finding.ruleId)).toEqual([
      'conductor/gate-output-unparseable',
    ]);
    expect(outcome.findings[0].blocking).toBe(true);
  });

  it('treats output it does not recognise as could-not-run, and says which side is at fault', () => {
    const bin = tempDir();
    stubGate(bin, 'dep-guard', { stdout: '{"something":"else"}', exit: 0 });

    const outcome = runGate(gate(), { repoRoot: tempDir(), staged: true, pathValue: bin });

    expect(outcome.couldNotRun?.reason).toBe('unparseable-output');
    expect(outcome.couldNotRun?.detail).toMatch(/dep-guard/);
  });

  it('reports a version of null rather than a guess when the binary cannot be asked', () => {
    const bin = tempDir();
    // intent-guard-check ignores --version and runs the gate, so the
    // runner must not ask it. This stub answers --version anyway; the point
    // is that the runner never sends it.
    stubGate(bin, 'intent-guard-check', {
      stdout: '{"status":"ok","exitCode":0,"reasons":[],"contractFound":true,"contractFrozen":true}',
    });

    const outcome = runGate(gate({ role: 'intent', product: 'intent-guard' }), {
      repoRoot: tempDir(),
      staged: true,
      pathValue: bin,
    });

    expect(outcome.binary?.candidate).toBe('intent-guard-check');
    expect(outcome.productVersion).toBeNull();
  });

  it('runs the intent gate with an explicit project root', () => {
    const bin = tempDir();
    const log = path.join(tempDir(), 'argv.txt');
    stubGate(bin, 'intent-guard', {
      stdout: '{"status":"ok","exitCode":0,"reasons":[],"contractFound":true,"contractFrozen":true}',
      argvLog: log,
    });

    runGate(gate({ role: 'intent', product: 'intent-guard' }), {
      repoRoot: tempDir(),
      staged: true,
      pathValue: bin,
    });

    expect(readFileSync(log, 'utf8').trim()).toBe('check --project . --staged --json');
  });
});

/**
 * The capability gate on --trust-base.
 *
 * A gate in the version table at or above its minimum is handed the flag. A
 * gate below its minimum, or whose version does not read, is could-not-run on
 * a run with a trust base: running it without the flag would let it take its
 * rules from the tree being judged. Withholding is left only for an intent
 * gate judging an imported contract, and it always carries a reason that is
 * printed and put in the log.
 */
describe('deciding whether a gate can be put into pull-request mode', () => {
  const intentGate = gate({ role: 'intent', product: 'intent-guard' });
  const nativeIntent = {
    projectDir: '.',
    paths: ['a.ts'],
    contractSource: { kind: 'native' as const, path: '.intent-guard/intent-contract.yaml' },
    baseRef: 'origin/main',
    baseSource: 'flag' as const,
    cleanup: () => undefined,
  };

  it('says nothing at all when the run is not in pull-request mode', () => {
    expect(decideTrustBase(intentGate, nativeIntent, undefined, INTENT_MIN)).toBeUndefined();
  });

  it('puts both external products in pull-request mode at their floors instead of withholding', () => {
    const gl = gate({ role: 'secrets-history', product: 'gitleaks' });
    expect(decideTrustBase(gl, undefined, 'origin/main', '8.30.1')?.withheld).toBeNull();
    const old = decideTrustBase(gl, undefined, 'origin/main', '8.18.4');
    expect(old?.withheld).toBeNull();
    expect(old?.refused).toMatch(/8\.19\.0/);
    const osv = gate({ role: 'vulnerabilities', product: 'osv-scanner' });
    expect(decideTrustBase(osv, undefined, 'origin/main', '2.6.0')?.withheld).toBeNull();
    expect(decideTrustBase(osv, undefined, 'origin/main', null)?.refused).not.toBeNull();
  });

  it('passes the flag to an intent-guard at its pull-request-mode minimum', () => {
    expect(decideTrustBase(intentGate, nativeIntent, 'origin/main', INTENT_MIN)).toEqual({
      ref: 'origin/main',
      withheld: null,
      refused: null,
      proposals: [],
    });
  });

  const familyRoles = {
    'intent-guard': 'intent',
    'vault-guard': 'secrets',
    'dep-guard': 'dependencies',
  } as const;
  for (const product of ['intent-guard', 'vault-guard', 'dep-guard'] as const) {
    const minimum = TRUST_BASE_MIN_VERSION[product] as string;
    const older = versionBelow(minimum);
    const role = familyRoles[product];

    it(`refuses ${product} below its pull-request-mode minimum rather than withholding the flag`, () => {
      const decision = decideTrustBase(
        gate({ role, product }),
        product === 'intent-guard' ? nativeIntent : undefined,
        'origin/main',
        older
      );

      expect(decision?.withheld).toBeNull();
      expect(decision?.refused).toBe(
        `${product} did not run: the installed ${older} is older than ${minimum}, the first ` +
          'version that takes its rules from the base ref on a pull-request run, so nothing was ' +
          `checked by it. Fix: install ${product} ${minimum} or newer, or remove an explicit ` +
          'older version pin.'
      );
    });

    it(`passes the flag to ${product} at exactly its minimum`, () => {
      const decision = decideTrustBase(
        gate({ role, product }),
        product === 'intent-guard' ? nativeIntent : undefined,
        'origin/main',
        minimum
      );

      expect(decision).toEqual({ ref: 'origin/main', withheld: null, refused: null, proposals: [] });
    });

    it(`changes nothing for ${product} below its minimum when there is no trust base`, () => {
      expect(decideTrustBase(gate({ role, product }), undefined, undefined, older)).toBeUndefined();
    });
  }

  it('refuses an intent-guard below the minimum even when the contract was imported', () => {
    // The imported-contract withholding is about where --project points, not
    // about the gate's version, so it must not let an older gate run.
    const decision = decideTrustBase(
      intentGate,
      {
        ...nativeIntent,
        projectDir: '/tmp/conductor-intent-abc',
        contractSource: { kind: 'imported', spec: 'docs/spec.md', plan: null, ref: 'origin/main' },
      },
      'origin/main',
      versionBelow(INTENT_MIN)
    );

    expect(decision?.withheld).toBeNull();
    expect(decision?.refused).toMatch(/did not run: the installed/);
  });

  it('REFUSES rather than withholds when the version could not be read at all', () => {
    // A gate in the table is one this repository expects to be inside the
    // boundary. Silently dropping it back outside because a version probe
    // failed is the wrong default: the probe failing is itself unexplained,
    // and "could not establish that this gate is in pull-request mode" is
    // could-not-run, not a downgrade to trusting the head.
    const decision = decideTrustBase(intentGate, nativeIntent, 'origin/main', null);

    expect(decision?.refused).toMatch(/version could not be read/);
    expect(decision?.withheld).toBeNull();
  });

  it('names the product and the floor without the copy bug', () => {
    // The old sentence read "intent-guard reported no version does not
    // understand --trust-base", which is not a sentence and reads as a claim
    // about a version called "reported no version".
    const below = decideTrustBase(intentGate, nativeIntent, 'origin/main', versionBelow(INTENT_MIN));
    const unreadable = decideTrustBase(intentGate, nativeIntent, 'origin/main', null);

    expect(below?.refused).toMatch(new RegExp(`older than ${INTENT_MIN.replace(/\./g, '\\.')}`));
    expect(unreadable?.refused).not.toMatch(/reported no version does not understand/);
  });

  it('refuses a dep-guard whose version could not be read, like the other two', () => {
    // All three products are in the table now, so the "no pull-request mode
    // yet" branch is unreachable by any real gate. It is kept because the
    // table is the thing that decides, and a fourth role arriving without an
    // entry must not be handed a flag it would reject.
    const decision = decideTrustBase(
      gate({ role: 'dependencies', product: 'dep-guard' }),
      undefined,
      'origin/main',
      null
    );

    expect(decision?.refused).toMatch(/version could not be read/);
    expect(decision?.withheld).toBeNull();
  });

  it('withholds it when the contract was imported into a temporary directory', () => {
    // The flag names a git ref and the gate resolves it against its own
    // --project. On an imported run that directory is one the umbrella made,
    // holding a contract and nothing else, with no repository in it: the
    // child would exit 2 on a ref it could not resolve.
    const decision = decideTrustBase(
      intentGate,
      {
        ...nativeIntent,
        projectDir: '/tmp/conductor-intent-abc',
        contractSource: { kind: 'imported', spec: 'docs/spec.md', plan: null },
      },
      'origin/main',
      INTENT_MIN
    );
    expect(decision?.withheld).toMatch(/temporary directory with no repository in it/);
  });

  it('passes it on a plain run with no prepared contract, where --project is the repository', () => {
    expect(decideTrustBase(intentGate, undefined, 'origin/main', INTENT_MIN)?.withheld).toBeNull();
  });
});

describe('the trust base on the command line and on the outcome', () => {
  const CLEAN_INTENT = JSON.stringify({
    status: 'ok',
    exitCode: 0,
    reasons: [],
    contractFound: true,
    contractFrozen: true,
    trustBase: {
      ref: 'origin/main',
      proposals: ['contract changed in this pull request'],
      contractChanged: true,
      configChanged: false,
      baseContractFound: true,
      selfApproval: false,
      contractShapeChange: null,
    },
  });

  it('writes --trust-base for a gate at the floor, and carries what it proposed', () => {
    const bin = tempDir();
    const log = path.join(tempDir(), 'argv.txt');
    stubGate(bin, 'intent-guard', { stdout: CLEAN_INTENT, argvLog: log, version: INTENT_MIN });

    const outcome = runGate(gate({ role: 'intent', product: 'intent-guard' }), {
      repoRoot: tempDir(),
      staged: true,
      pathValue: bin,
      trustBase: 'origin/main',
    });

    expect(readFileSync(log, 'utf8').trim()).toBe(
      'check --project . --staged --trust-base origin/main --json'
    );
    expect(outcome.trustBase).toEqual({
      ref: 'origin/main',
      withheld: null,
      refused: null,
      proposals: ['contract changed in this pull request'],
    });
  });

  for (const [role, product] of [
    ['intent', 'intent-guard'],
    ['secrets', 'vault-guard'],
    ['dependencies', 'dep-guard'],
  ] as const) {
    it(`is could-not-run for ${product} below its pull-request-mode minimum on a trust-base run`, () => {
      const minimum = TRUST_BASE_MIN_VERSION[product] as string;
      const older = versionBelow(minimum);
      const bin = tempDir();
      const log = path.join(tempDir(), 'argv.txt');
      stubGate(bin, product, { stdout: '{}', argvLog: log, version: older });

      // enforce: false on purpose: the gate produced nothing for that setting
      // to be a decision about, so the refusal is enforced.
      const outcome = runGate(gate({ role, product, enforce: false }), {
        repoRoot: tempDir(),
        staged: false,
        pathValue: bin,
        trustBase: 'origin/main',
      });

      expect(outcome.couldNotRun?.reason).toBe('gate-version-unsupported');
      expect(outcome.couldNotRun?.detail).toMatch(
        new RegExp(`^${product} did not run: the installed ${older.replace(/\./g, '\\.')} is older`)
      );
      expect(outcome.couldNotRun?.detail).toMatch(
        /Fix: install .* or newer, or remove an explicit older version pin\.$/
      );
      expect(outcome.enforce).toBe(true);
      expect(outcome.trustBase?.withheld).toBeNull();
      // Nothing was spawned beyond the version probe.
      expect(existsSync(log)).toBe(false);
    });
  }

  it('runs a gate below the minimum exactly as before when there is no trust base', () => {
    const bin = tempDir();
    const log = path.join(tempDir(), 'argv.txt');
    stubGate(bin, 'intent-guard', {
      stdout: '{"status":"ok","exitCode":0,"reasons":[],"contractFound":true,"contractFrozen":true}',
      argvLog: log,
      version: versionBelow(INTENT_MIN),
    });

    const outcome = runGate(gate({ role: 'intent', product: 'intent-guard' }), {
      repoRoot: tempDir(),
      staged: true,
      pathValue: bin,
    });

    expect(readFileSync(log, 'utf8').trim()).toBe('check --project . --staged --json');
    expect(outcome.trustBase).toBeUndefined();
    expect(outcome.couldNotRun).toBeNull();
  });

  it('carries the decision on a gate that could not run at all', () => {
    // Which contract a gate WOULD have judged against is exactly as
    // interesting when it broke as when it did not.
    const bin = tempDir();
    stubGate(bin, 'intent-guard', { stdout: 'not json', exit: 1, version: INTENT_MIN });

    const outcome = runGate(gate({ role: 'intent', product: 'intent-guard' }), {
      repoRoot: tempDir(),
      staged: false,
      pathValue: bin,
      trustBase: 'origin/main',
    });

    expect(outcome.couldNotRun?.reason).toBe('unparseable-output');
    expect(outcome.trustBase).toEqual({
      ref: 'origin/main',
      withheld: null,
      refused: null,
      proposals: [],
    });
  });

  it('is could-not-run, not a silent downgrade, when a gate in the table has no readable version', () => {
    const bin = tempDir();
    const log = path.join(tempDir(), 'argv.txt');
    // A binary that answers --version with something unparseable. The probe
    // returns null and the gate is inside the table, so the run refuses.
    writeFileSync(
      path.join(bin, 'intent-guard'),
      '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "a banner, not a version"; exit 0; fi\n' +
        `printf '%s\\n' "$*" >> ${log}\n` +
        'echo \'{"status":"ok","exitCode":0,"reasons":[],"contractFound":true,"contractFrozen":true}\'\n'
    );
    chmodSync(path.join(bin, 'intent-guard'), 0o755);

    const outcome = runGate(gate({ role: 'intent', product: 'intent-guard' }), {
      repoRoot: tempDir(),
      staged: false,
      pathValue: bin,
      trustBase: 'origin/main',
    });

    expect(outcome.couldNotRun?.reason).toBe('trust-base-unverified');
    expect(outcome.couldNotRun?.detail).toMatch(/version could not be read/);
    // Nothing was spawned beyond the probe: the gate never ran at all.
    expect(existsSync(log)).toBe(false);
  });

  it('enforces that refusal whatever the policy says, as a refused program is', () => {
    // The gate produced no findings for enforce: false to be a decision
    // about. With the directory-subtree rule a pull request can no longer
    // reach this state, so what is left is a packaging problem, and one that
    // fails a build loudly beats a boundary that quietly downgrades itself.
    const bin = tempDir();
    writeFileSync(
      path.join(bin, 'intent-guard'),
      '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "a banner, not a version"; exit 0; fi\n' +
        'echo \'{"status":"ok","exitCode":0,"reasons":[],"contractFound":true,"contractFrozen":true}\'\n'
    );
    chmodSync(path.join(bin, 'intent-guard'), 0o755);

    const outcome = runGate(
      gate({ role: 'intent', product: 'intent-guard', enforce: false }),
      { repoRoot: tempDir(), staged: false, pathValue: bin, trustBase: 'origin/main' }
    );

    expect(outcome.couldNotRun?.reason).toBe('trust-base-unverified');
    expect(outcome.enforce).toBe(true);
  });

  it('runs that same gate normally when the run is not in pull-request mode', () => {
    // An unreadable version is not itself an error. It only stops the run
    // when the umbrella had promised to put that gate inside the boundary.
    const bin = tempDir();
    writeFileSync(
      path.join(bin, 'intent-guard'),
      '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "a banner, not a version"; exit 0; fi\n' +
        'echo \'{"status":"ok","exitCode":0,"reasons":[],"contractFound":true,"contractFrozen":true}\'\n'
    );
    chmodSync(path.join(bin, 'intent-guard'), 0o755);

    const outcome = runGate(gate({ role: 'intent', product: 'intent-guard' }), {
      repoRoot: tempDir(),
      staged: false,
      pathValue: bin,
    });

    expect(outcome.couldNotRun).toBeNull();
    expect(outcome.productVersion).toBeNull();
  });
});

/**
 * A pull-request run never reaches into node_modules/.bin, and says so.
 *
 * MEASURED WITH A MARKER, never with a source assertion. Each of these plants
 * a binary under the repository's own node_modules/.bin that writes a file
 * when it is executed, so "the other one ran" is a fact about the filesystem
 * rather than about which branch a reader thinks was taken. That matters more
 * here than usual: the whole point is that a program the head chose is not
 * executed, and a probe for --version executes it just as thoroughly as a
 * scan does.
 */
describe('a pull-request run and the repository own node_modules', () => {
  /** A gate binary that records having been run, and answers --version. */
  function markerGate(dir: string, name: string, marker: string): void {
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, name);
    writeFileSync(
      file,
      [
        '#!/bin/sh',
        `printf 'ran\\n' >> ${JSON.stringify(marker)}`,
        'if [ "$1" = "--version" ]; then echo "9.9.9"; exit 0; fi',
        `echo '${DEP_GUARD_CLEAN.replace(/'/g, "'\\''")}'`,
        'exit 0',
      ].join('\n') + '\n'
    );
    chmodSync(file, 0o755);
  }

  it('runs the PATH copy and never the one the head installed', () => {
    const repo = tempDir();
    const bin = tempDir();
    const plantMarker = path.join(repo, 'planted-ran.txt');
    markerGate(path.join(repo, 'node_modules', '.bin'), 'dep-guard', plantMarker);
    stubGate(bin, 'dep-guard', { stdout: DEP_GUARD_CLEAN });

    const outcome = runGate(gate(), {
      repoRoot: repo,
      staged: false,
      pathValue: bin,
      trustBase: 'origin/main',
    });

    expect(existsSync(plantMarker)).toBe(false);
    expect(outcome.couldNotRun).toBeNull();
    expect(outcome.binary?.source).toBe('path');
  });

  it('is could-not-run, with the install remedy, when the only copy is the head own', () => {
    const repo = tempDir();
    const plantMarker = path.join(repo, 'planted-ran.txt');
    markerGate(path.join(repo, 'node_modules', '.bin'), 'dep-guard', plantMarker);

    const outcome = runGate(gate(), {
      repoRoot: repo,
      staged: false,
      pathValue: tempDir(),
      trustBase: 'origin/main',
    });

    expect(existsSync(plantMarker)).toBe(false);
    // The EXISTING reason, not a new one: nothing was found, which is what
    // binary-missing has always meant. What is new is the sentence after it.
    expect(outcome.couldNotRun?.reason).toBe('binary-missing');
    expect(outcome.couldNotRun?.detail).toMatch(/npm install -g/);
    expect(outcome.couldNotRun?.detail).toMatch(/dep-guard-version/);
    expect(outcome.findings[0]?.message).toMatch(/npm install -g/);
    // And it names the copy it declined to take, or the reader is told the
    // gate is missing while looking straight at it.
    expect(outcome.couldNotRun?.detail).toMatch(/node_modules\/\.bin\/dep-guard/);
  });

  it('carries the skipped candidate on the outcome, so one line can report the run', () => {
    const repo = tempDir();
    const bin = tempDir();
    markerGate(path.join(repo, 'node_modules', '.bin'), 'dep-guard', path.join(repo, 'ran.txt'));
    stubGate(bin, 'dep-guard', { stdout: DEP_GUARD_CLEAN });

    const skipped = runGate(gate(), {
      repoRoot: repo,
      staged: false,
      pathValue: bin,
      trustBase: 'origin/main',
    });
    expect(skipped.nodeModulesSkipped).toBe('node_modules/.bin/dep-guard');

    // Nothing to skip: no claim that anything was skipped.
    const nothingThere = runGate(gate(), {
      repoRoot: tempDir(),
      staged: false,
      pathValue: bin,
      trustBase: 'origin/main',
    });
    expect(nothingThere.nodeModulesSkipped).toBeUndefined();
  });

  it('says nothing and changes nothing outside pull-request mode', () => {
    // The parity case, and it is measured the same way: the planted binary
    // must actually RUN, or this proves only that no exception was thrown.
    const repo = tempDir();
    const bin = tempDir();
    const plantMarker = path.join(repo, 'planted-ran.txt');
    markerGate(path.join(repo, 'node_modules', '.bin'), 'dep-guard', plantMarker);
    stubGate(bin, 'dep-guard', { stdout: DEP_GUARD_CLEAN });

    const outcome = runGate(gate(), { repoRoot: repo, staged: false, pathValue: bin });

    expect(existsSync(plantMarker)).toBe(true);
    expect(outcome.binary?.source).toBe('node_modules');
    expect(outcome.nodeModulesSkipped).toBeUndefined();
  });
});

/**
 * The version probe is a SPAWN of its own, and not always of the same file.
 *
 * A per-command binary ignores `--version` and runs the gate instead, so
 * resolution asks a version-safe SIBLING instead, which can live anywhere on
 * PATH. Vetting only `binary.program` therefore left one executed path
 * unchecked: the program a base policy names is byte for byte what the base
 * approved, and the file the probe runs a moment later is whatever the head
 * put beside it.
 */
describe('a pull-request run and the file the version probe would spawn', () => {
  function git(cwd: string, args: string[]): string {
    return execFileSync('git', args, { cwd, encoding: 'utf8' });
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

  /** Something that answers --version, records having been asked, and exits. */
  function probeSibling(file: string, marker: string, version: string): void {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(
      file,
      [
        '#!/bin/sh',
        `printf '%s\\n' "$1" >> ${JSON.stringify(marker)}`,
        `if [ "$1" = "--version" ]; then echo "${version}"; exit 0; fi`,
        'exit 0',
      ].join('\n') + '\n'
    );
    chmodSync(file, 0o755);
  }

  /**
   * A repository vendoring intent-guard-check, which cannot be asked its own
   * version, with the version-safe intent-guard on PATH beside it in the
   * tree. The branch rewrites only the second one.
   */
  function vendored(): { root: string; command: string; toolsDir: string; marker: string } {
    const root = tempDir();
    const marker = path.join(tempDir(), 'probe-ran.txt');
    const toolsDir = path.join(root, 'tools');
    const command = path.join(root, 'vendor', 'check', 'intent-guard-check');

    git(root, ['init', '--quiet', '-b', 'main']);
    writeFileSync(path.join(root, 'README.md'), '# scratch\n');
    mkdirSync(path.dirname(command), { recursive: true });
    writeFileSync(command, `#!/bin/sh\necho '${CLEAN_INTENT_GUARD.replace(/'/g, "'\\''")}'\n`);
    chmodSync(command, 0o755);
    probeSibling(path.join(toolsDir, 'intent-guard'), marker, '1.9.0');
    commit(root, 'base');

    git(root, ['checkout', '--quiet', '-b', 'feat/work']);
    probeSibling(path.join(toolsDir, 'intent-guard'), marker, '1.9.1');
    commit(root, 'branch work');

    return { root, command, toolsDir, marker };
  }

  it('refuses when the head rewrote the sibling the probe would run', () => {
    const fixture = vendored();

    const outcome = runGate(
      gate({ role: 'intent', product: 'intent-guard', command: fixture.command }),
      {
        repoRoot: fixture.root,
        staged: false,
        pathValue: fixture.toolsDir,
        trustBase: 'main',
      }
    );

    // Never asked, which is the whole claim: a probe RUNS the file.
    expect(existsSync(fixture.marker)).toBe(false);
    expect(outcome.couldNotRun?.reason).toBe('gate-program-refused');
    expect(outcome.couldNotRun?.detail).toMatch(/tools\/intent-guard/);
    expect(outcome.enforce).toBe(true);
  });

  it('runs as usual when the branch left that sibling alone', () => {
    // The direction that keeps the rule usable. Same fixture, with the
    // branch commit reverted to the bytes the base approved.
    const fixture = vendored();
    probeSibling(path.join(fixture.toolsDir, 'intent-guard'), fixture.marker, '1.9.0');
    commit(fixture.root, 'put it back');

    const outcome = runGate(
      gate({ role: 'intent', product: 'intent-guard', command: fixture.command }),
      {
        repoRoot: fixture.root,
        staged: false,
        pathValue: fixture.toolsDir,
        trustBase: 'main',
      }
    );

    expect(existsSync(fixture.marker)).toBe(true);
    expect(outcome.couldNotRun).toBeNull();
    expect(outcome.productVersion).toBe('1.9.0');
  });
});

describe('external gate exit semantics', () => {
  const gl = () => gate({ role: 'secrets-history', product: 'gitleaks', stage: 'ci' });
  const osv = () => gate({ role: 'vulnerabilities', product: 'osv-scanner', stage: 'ci' });

  it('reads gitleaks findings from the report file and treats exit 3 as blocked', () => {
    const bin = tempDir();
    stubGate(bin, 'gitleaks', { versionSubcommand: true, versionLine: '8.30.1', reportFlag: '--report-path', reportBody: fixtureText('gitleaks-8.30.1-history-blocking.json'), exit: 3, stdout: '' });
    const out = runGate(gl(), { repoRoot: tempGitRepo(), staged: false, pathValue: bin, tempRoot: tempDir() });
    expect(out.couldNotRun).toBeNull();
    expect(out.exitCode).toBe(3);
    expect(out.findings.length).toBeGreaterThan(0);
    expect(out.findings.every((f) => f.blocking)).toBe(true);
    expect(out.productVersion).toBe('8.30.1');
  });

  it('reads a clean gitleaks report as no findings and nothing blocking', () => {
    const bin = tempDir();
    stubGate(bin, 'gitleaks', { versionSubcommand: true, versionLine: '8.30.1', reportFlag: '--report-path', reportBody: fixtureText('gitleaks-8.30.1-history-clean.json'), exit: 0, stdout: '' });
    const out = runGate(gl(), { repoRoot: tempGitRepo(), staged: false, pathValue: bin, tempRoot: tempDir() });
    expect(out.couldNotRun).toBeNull();
    expect(out.exitCode).toBe(0);
    expect(out.findings).toEqual([]);
  });

  it('strips ANSI colour codes from gitleaks stderr before it reaches the report or the gate-failed message', () => {
    const bin = tempDir();
    stubGate(bin, 'gitleaks', {
      versionSubcommand: true,
      versionLine: '8.30.1',
      exit: 1,
      stdout: '',
      stderr: '\u001b[90m6:36PM\u001b[0m \u001b[31mFTL\u001b[0m \u001b[1munable to load gitleaks config\u001b[0m\n',
    });
    const out = runGate(gl(), { repoRoot: tempGitRepo(), staged: false, pathValue: bin, tempRoot: tempDir() });
    expect(out.couldNotRun?.reason).toBe('gate-error');
    expect(out.stderr).toContain('FTL unable to load gitleaks config');
    expect(out.stderr).not.toContain('\u001b');
    expect(JSON.stringify(out.findings)).not.toContain('\\u001b');
    expect(out.findings.some((f) => f.message.includes('unable to load gitleaks config'))).toBe(true);
  });

  it('treats gitleaks exit 1 as an error, not a leak', () => {
    const bin = tempDir();
    stubGate(bin, 'gitleaks', { versionSubcommand: true, versionLine: '8.30.1', exit: 1, stdout: '', stderr: 'fatal: not a git repository' });
    const out = runGate(gl(), { repoRoot: tempGitRepo(), staged: false, pathValue: bin, tempRoot: tempDir() });
    expect(out.couldNotRun?.reason).toBe('gate-error');
    expect(out.findings.some((f) => f.ruleId === 'conductor/gate-failed')).toBe(true);
  });

  it('reports report-missing when gitleaks exits clean but wrote no report', () => {
    const bin = tempDir();
    stubGate(bin, 'gitleaks', { versionSubcommand: true, versionLine: '8.30.1', exit: 0, stdout: '' });
    const out = runGate(gl(), { repoRoot: tempGitRepo(), staged: false, pathValue: bin, tempRoot: tempDir() });
    expect(out.couldNotRun?.reason).toBe('report-missing');
    expect(out.findings.some((f) => f.ruleId === 'conductor/gate-failed')).toBe(true);
  });

  it('treats a clean gitleaks exit that logged a git error as an error, never as a clean scan of nothing', () => {
    // Captured from gitleaks 8.30.1 with --log-opts naming a base ref the
    // checkout never fetched: exit 0, report [], and these ERR lines.
    const bin = tempDir();
    stubGate(bin, 'gitleaks', {
      versionSubcommand: true,
      versionLine: '8.30.1',
      reportFlag: '--report-path',
      reportBody: fixtureText('gitleaks-8.30.1-history-clean.json'),
      exit: 0,
      stdout: '',
      stderr: fixtureText('gitleaks-8.30.1-unknown-base-ref.stderr.txt'),
    });
    const out = runGate(gl(), { repoRoot: tempGitRepo(), staged: false, pathValue: bin, tempRoot: tempDir() });
    expect(out.couldNotRun?.reason).toBe('gate-error');
    expect(out.couldNotRun?.detail).toMatch(/ERR/);
  });

  it('treats osv-scanner exit 128 on handed lockfiles as lockfiles that parsed to no packages, naming them', () => {
    // osvRepo's lockfile is "{}": handed over, it yields zero packages and
    // osv-scanner exits 128. That is not the same news as "no lockfile".
    const bin = tempDir();
    stubGate(bin, 'osv-scanner', { versionLine: 'osv-scanner version: 2.6.0', exit: 128, stdout: '', stderr: 'No package sources found, --help for usage information.' });
    const out = runGate(osv(), { repoRoot: osvRepo(), staged: false, pathValue: bin, tempRoot: tempDir() });
    expect(out.couldNotRun).toBeNull();
    expect(out.exitCode).toBe(0);
    expect(out.findings).toEqual([]);
    const diagnostic = out.diagnostics.find((d) => d.code === 'conductor/lockfiles-empty');
    expect(diagnostic?.message).toContain('package-lock.json');
    expect(out.diagnostics.some((d) => d.code === 'conductor/nothing-to-scan')).toBe(false);
  });

  it('reports a nested osv-scanner.toml the pull request adds as a proposal, like the root one', () => {
    const repo = osvRepo();
    execFileSync('git', ['checkout', '--quiet', '-b', 'pr'], { cwd: repo });
    commitFiles(repo, { 'web/package-lock.json': '{}\n', 'web/osv-scanner.toml': '[[PackageOverrides]]\nname = "lodash"\nignore = true\n' }, 'nested config');
    const bin = tempDir();
    stubGate(bin, 'osv-scanner', { versionLine: 'osv-scanner version: 2.6.0', exit: 0, stdout: CLEAN_OSV_SCANNER });
    const out = runGate(osv(), { repoRoot: repo, staged: false, pathValue: bin, tempRoot: tempDir(), trustBase: 'main' });
    expect(out.couldNotRun).toBeNull();
    // The base carries no nested file, so the line says what was used instead.
    expect(
      out.trustBase?.proposals.some((p) => /^web\/osv-scanner\.toml is not on the base ref; the root config was used/.test(p))
    ).toBe(true);
    // Overridden for this run by the base-ref --config.
    expect(out.argv).toContain('--config');
  });

  it('runs gitleaks from its own work directory on a pull request, and from the repository locally', () => {
    const repo = tempGitRepo();
    const bin = tempDir();
    const prLog = path.join(tempDir(), 'pr-cwd.txt');
    stubGate(bin, 'gitleaks', { versionSubcommand: true, versionLine: '8.30.1', reportFlag: '--report-path', reportBody: '[]', exit: 0, stdout: '', cwdLog: prLog });
    runGate(gl(), { repoRoot: repo, staged: false, pathValue: bin, tempRoot: tempDir(), trustBase: 'main' });
    // Relative [extend] paths resolve against it; the head tree must not be it.
    const prCwd = readFileSync(prLog, 'utf8').trim();
    expect(prCwd.startsWith(realpathSync(repo))).toBe(false);
    expect(path.basename(prCwd)).toBe('cwd');

    const localBin = tempDir();
    const localLog = path.join(tempDir(), 'local-cwd.txt');
    stubGate(localBin, 'gitleaks', { versionSubcommand: true, versionLine: '8.30.1', reportFlag: '--report-path', reportBody: '[]', exit: 0, stdout: '', cwdLog: localLog });
    runGate(gl(), { repoRoot: repo, staged: false, pathValue: localBin, tempRoot: tempDir() });
    expect(readFileSync(localLog, 'utf8').trim()).toBe(realpathSync(repo));
  });

  it('is preparation-failed on a pull request whose base config extends a file the base does not have', () => {
    const repo = tempGitRepo();
    commitFiles(repo, { '.gitleaks.toml': '[extend]\npath = "gl-extra.toml"\n' }, 'extend a missing file');
    const bin = tempDir();
    stubGate(bin, 'gitleaks', { versionSubcommand: true, versionLine: '8.30.1', reportFlag: '--report-path', reportBody: '[]', exit: 0, stdout: '' });
    const out = runGate(gl(), { repoRoot: repo, staged: false, pathValue: bin, tempRoot: tempDir(), trustBase: 'main' });
    expect(out.couldNotRun?.reason).toBe('preparation-failed');
    expect(out.couldNotRun?.detail).toContain('gl-extra.toml');
  });

  it('is could-not-run, and never spawns gitleaks, when the base config exists but cannot be read', () => {
    // Only an ABSENT base config selects the neutral stand-in. A link at the
    // config path is a file the base carries that cannot be read as one.
    const repo = tempGitRepo();
    writeFileSync(path.join(repo, 'real.toml'), '[[rules]]\nid = "acme"\nregex = "ACME_[A-Z]{8}"\n');
    symlinkSync('real.toml', path.join(repo, '.gitleaks.toml'));
    execFileSync('git', ['add', '-f', 'real.toml', '.gitleaks.toml'], { cwd: repo });
    commitFiles(repo, {}, 'base config is a link');
    const bin = tempDir();
    const log = path.join(tempDir(), 'argv.log');
    stubGate(bin, 'gitleaks', { versionSubcommand: true, versionLine: '8.30.1', reportFlag: '--report-path', reportBody: '[]', exit: 0, stdout: '', argvLog: log });
    const out = runGate(gl(), { repoRoot: repo, staged: false, pathValue: bin, tempRoot: tempDir(), trustBase: 'main' });
    expect(out.couldNotRun?.reason).toBe('preparation-failed');
    expect(out.couldNotRun?.detail).toMatch(/\.gitleaks\.toml could not be read from the base ref/);
    expect(existsSync(log)).toBe(false);
  });

  it('treats osv-scanner exit 127 as an error', () => {
    const bin = tempDir();
    stubGate(bin, 'osv-scanner', { versionLine: 'osv-scanner version: 2.6.0', exit: 127, stdout: '' });
    const out = runGate(osv(), { repoRoot: osvRepo(), staged: false, pathValue: bin, tempRoot: tempDir() });
    expect(out.couldNotRun?.reason).toBe('gate-error');
  });

  it('reads the osv-scanner version from its prefixed version line', () => {
    const bin = tempDir();
    stubGate(bin, 'osv-scanner', { versionLine: 'osv-scanner version: 2.6.0', exit: 0, stdout: CLEAN_OSV_SCANNER });
    const out = runGate(osv(), { repoRoot: osvRepo(), staged: false, pathValue: bin, tempRoot: tempDir() });
    expect(out.productVersion).toBe('2.6.0');
  });

  it('reports an osv-scanner manifest relative to the repository, whichever spelling of the root it printed', () => {
    // osv-scanner prints source.path absolute (tests/fixtures/README.md),
    // with --lockfile as with a scan root. The captured report, re-rooted at
    // this test's repository in its resolved spelling, which on macOS differs
    // from the tmpdir spelling.
    const repo = osvRepo();
    const report = JSON.parse(fixtureText('osv-scanner-2.6.0-blocking.json')) as {
      results: Array<{ source: { path: string } }>;
    };
    report.results[0]!.source.path = path.join(realpathSync(repo), 'package-lock.json');
    const bin = tempDir();
    stubGate(bin, 'osv-scanner', { versionLine: 'osv-scanner version: 2.6.0', exit: 1, stdout: JSON.stringify(report) });
    const out = runGate(osv(), { repoRoot: repo, staged: false, pathValue: bin, tempRoot: tempDir() });
    expect(out.couldNotRun).toBeNull();
    expect(out.findings.length).toBeGreaterThan(0);
    expect(out.findings.every((f) => f.blocking)).toBe(true);
    expect(out.findings[0]!.subject).toEqual({ kind: 'package', name: 'lodash', manifest: 'package-lock.json' });
  });

  it('on a pull request, hands gitleaks the base config and ignore file and scopes history to base..HEAD', () => {
    const repo = tempGitRepo();
    const commitAll = (message: string) => {
      execFileSync('git', ['add', '-A'], { cwd: repo });
      execFileSync('git', ['-c', 'user.email=test@example.invalid', '-c', 'user.name=test', 'commit', '--quiet', '-m', message], { cwd: repo });
    };
    writeFileSync(path.join(repo, '.gitleaks.toml'), '[extend]\nuseDefault = true\n');
    commitAll('base config');
    execFileSync('git', ['checkout', '--quiet', '-b', 'pr'], { cwd: repo });
    writeFileSync(path.join(repo, '.gitleaks.toml'), '[allowlist]\npaths = ["src/"]\n');
    commitAll('head widens the allowlist');

    const bin = tempDir();
    const log = path.join(tempDir(), 'argv.txt');
    stubGate(bin, 'gitleaks', { versionSubcommand: true, versionLine: '8.30.1', reportFlag: '--report-path', reportBody: '[]', exit: 0, stdout: '', argvLog: log });
    const out = runGate(gl(), { repoRoot: repo, staged: false, pathValue: bin, tempRoot: tempDir(), trustBase: 'main' });

    expect(out.couldNotRun).toBeNull();
    const argv = out.argv;
    expect(argv[argv.indexOf('--log-opts') + 1]).toBe('--diff-merges=first-parent main..HEAD');
    expect(argv).toContain('--config');
    expect(argv).toContain('--gitleaks-ignore-path');
    // Scanned from the git directory, not ".": gitleaks loads the scan
    // root's own .gitleaksignore whatever --gitleaks-ignore-path says.
    expect(argv[argv.length - 1]).toBe(realpathSync(path.join(repo, '.git')));
    expect(argv).not.toContain('--trust-base');
    expect(out.trustBase?.withheld).toBeNull();
    expect(out.trustBase?.proposals.some((p) => /\.gitleaks\.toml differs/.test(p))).toBe(true);
  });

  it('hands osv-scanner every tracked lockfile by name, gitignored or not, and nothing untracked or under node_modules', () => {
    const repo = tempGitRepo();
    // The .gitignore names the root lockfile: osv-scanner's own walk would
    // skip it, which is the hole handing lockfiles by name closes.
    commitFiles(
      repo,
      {
        '.gitignore': 'package-lock.json\nyarn.lock\n',
        'package-lock.json': '{}\n',
        'web/pnpm-lock.yaml': 'lockfileVersion: 9.0\n',
        'node_modules/left-pad/package-lock.json': '{}\n',
      },
      'lockfiles'
    );
    writeFileSync(path.join(repo, 'yarn.lock'), '# untracked\n');
    const bin = tempDir();
    stubGate(bin, 'osv-scanner', { versionLine: 'osv-scanner version: 2.6.0', exit: 0, stdout: CLEAN_OSV_SCANNER });
    const out = runGate(osv(), { repoRoot: repo, staged: false, pathValue: bin, tempRoot: tempDir() });
    expect(out.couldNotRun).toBeNull();
    const handed = out.argv.flatMap((token, i) => (out.argv[i - 1] === '--lockfile' ? [token] : []));
    expect(handed).toEqual(['package-lock.json', 'web/pnpm-lock.yaml']);
    expect(out.argv).not.toContain('--recursive');
  });

  it('reports nothing-to-scan without spawning osv-scanner when no lockfile is tracked', () => {
    const bin = tempDir();
    const log = path.join(tempDir(), 'argv.txt');
    stubGate(bin, 'osv-scanner', { versionLine: 'osv-scanner version: 2.6.0', exit: 1, stdout: '', argvLog: log });
    const out = runGate(osv(), { repoRoot: tempGitRepo(), staged: false, pathValue: bin, tempRoot: tempDir() });
    expect(out.couldNotRun).toBeNull();
    expect(out.exitCode).toBe(0);
    expect(out.findings).toEqual([]);
    expect(out.productVersion).toBe('2.6.0');
    expect(out.diagnostics.some((d) => d.code === 'conductor/nothing-to-scan')).toBe(true);
    // EMPTY_RUN: no lockfile fact at all, which is what the text report
    // relies on to tell "scanned one, clean" from "scanned nothing" (issue
    // #72; pinned on the rendering side by "the vulnerabilities line tells a
    // clean scan from nothing to scan" in tests/output-text.test.ts).
    expect(out.run.details).toEqual({});
    // Only the version probe ran; a scan would have been logged.
    expect(existsSync(log)).toBe(false);
  });

  it('is could-not-run when the tracked lockfiles cannot be listed', () => {
    const bin = tempDir();
    stubGate(bin, 'osv-scanner', { versionLine: 'osv-scanner version: 2.6.0', exit: 0, stdout: CLEAN_OSV_SCANNER });
    // Not a repository: git ls-files fails, and that is not "no lockfiles".
    const out = runGate(osv(), { repoRoot: tempDir(), staged: false, pathValue: bin, tempRoot: tempDir() });
    expect(out.couldNotRun?.reason).toBe('preparation-failed');
  });

  it('names the lockfiles it handed osv-scanner and counts zero sources with findings, on a clean scan (issue #72)', () => {
    const bin = tempDir();
    stubGate(bin, 'osv-scanner', { versionLine: 'osv-scanner version: 2.6.0', exit: 0, stdout: CLEAN_OSV_SCANNER });
    const out = runGate(osv(), { repoRoot: osvRepo(), staged: false, pathValue: bin, tempRoot: tempDir() });
    expect(out.couldNotRun).toBeNull();
    expect(out.run.details.lockfiles).toBe('1 (package-lock.json)');
    expect(out.run.details['sources-with-findings']).toBe(0);
  });

  it('on a pull request, tells gitleaks to ignore inline gitleaks:allow comments; locally it does not', () => {
    const repo = tempGitRepo();
    const bin = tempDir();
    stubGate(bin, 'gitleaks', { versionSubcommand: true, versionLine: '8.30.1', reportFlag: '--report-path', reportBody: '[]', exit: 0, stdout: '' });
    const pr = runGate(gl(), { repoRoot: repo, staged: false, pathValue: bin, tempRoot: tempDir(), trustBase: 'main' });
    expect(pr.argv).toContain('--ignore-gitleaks-allow');
    const local = runGate(gl(), { repoRoot: repo, staged: false, pathValue: bin, tempRoot: tempDir() });
    expect(local.argv).not.toContain('--ignore-gitleaks-allow');
  });

  it('never hands an external tool a config on a local run, so it reads the repository own', () => {
    const bin = tempDir();
    stubGate(bin, 'osv-scanner', { versionLine: 'osv-scanner version: 2.6.0', exit: 0, stdout: CLEAN_OSV_SCANNER });
    const out = runGate(osv(), { repoRoot: osvRepo(), staged: false, pathValue: bin, tempRoot: tempDir() });
    expect(out.argv).not.toContain('--config');
  });

  it('refuses a gitleaks older than the floor as could-not-run, naming the floor', () => {
    const bin = tempDir();
    stubGate(bin, 'gitleaks', { versionSubcommand: true, versionLine: '8.18.4', exit: 0, stdout: '' });
    const out = runGate(gl(), { repoRoot: tempGitRepo(), staged: false, pathValue: bin, tempRoot: tempDir() });
    expect(out.couldNotRun?.reason).toBe('gate-version-unsupported');
    expect(out.couldNotRun?.detail).toContain('8.19.0');
    expect(out.findings.some((f) => f.ruleId === 'conductor/gate-failed')).toBe(true);
  });

  it('leaves nothing behind in the temporary root it was given', () => {
    const bin = tempDir();
    const root = tempDir();
    stubGate(bin, 'gitleaks', { versionSubcommand: true, versionLine: '8.30.1', reportFlag: '--report-path', reportBody: '[]', exit: 0, stdout: '' });
    runGate(gl(), { repoRoot: tempGitRepo(), staged: false, pathValue: bin, tempRoot: root });
    expect(readdirSync(root)).toEqual([]);
  });

  it('keeps the npm gates on the old exit reading: exit 2 is gate-error', () => {
    const bin = tempDir();
    stubGate(bin, 'vault-guard', { exit: 2, stdout: '' });
    const out = runGate(gate({ role: 'secrets', product: 'vault-guard' }), { repoRoot: tempGitRepo(), staged: false, pathValue: bin });
    expect(out.couldNotRun?.reason).toBe('gate-error');
    expect(out.couldNotRun?.detail).toBe('the gate exited 2, which it uses for "could not run".');
  });
});

describe('a gate that reads history, in a shallow checkout (C2)', () => {
  const gl = (overrides: Partial<GatePolicy> = {}) =>
    gate({ role: 'secrets-history', product: 'gitleaks', stage: 'ci', ...overrides });

  /**
   * A real depth-1 clone: main has one commit, branch pr adds a secret and
   * removes it again, and the clone holds only the tip of pr.
   */
  function shallowClone(): string {
    const source = tempGitRepo();
    const git = (cwd: string, args: string[]) =>
      execFileSync(
        'git',
        ['-c', 'user.email=test@example.invalid', '-c', 'user.name=test', ...args],
        { cwd, encoding: 'utf8' }
      );
    git(source, ['checkout', '--quiet', '-b', 'pr']);
    commitFiles(source, { 'leak.txt': 'secret\n' }, 'add a secret');
    git(source, ['rm', '--quiet', 'leak.txt']);
    git(source, ['commit', '--quiet', '-m', 'remove it again']);
    const dest = path.join(tempDir(), 'clone');
    execFileSync('git', ['clone', '--quiet', '--depth', '1', '--branch', 'pr', `file://${source}`, dest]);
    execFileSync('git', ['fetch', '--quiet', '--depth=1', 'origin', '+refs/heads/main:refs/remotes/origin/main'], { cwd: dest });
    expect(git(dest, ['rev-parse', '--is-shallow-repository']).trim()).toBe('true');
    return dest;
  }

  it('is could-not-run and ENFORCED under a trust base, naming fetch-depth: 0, without spawning gitleaks', () => {
    const bin = tempDir();
    const log = path.join(tempDir(), 'argv.txt');
    stubGate(bin, 'gitleaks', { versionSubcommand: true, versionLine: '8.30.1', reportFlag: '--report-path', reportBody: '[]', exit: 0, stdout: '', argvLog: log });
    const out = runGate(gl({ enforce: false }), { repoRoot: shallowClone(), staged: false, pathValue: bin, tempRoot: tempDir(), trustBase: 'origin/main' });
    expect(out.couldNotRun?.reason).toBe('history-shallow');
    expect(out.couldNotRun?.detail).toContain('fetch-depth: 0');
    expect(out.enforce).toBe(true);
    expect(out.argv).toEqual([]);
    expect(existsSync(log)).toBe(false);
    expect(out.findings.some((f) => f.ruleId === 'conductor/gate-failed')).toBe(true);
  });

  it('is could-not-run on a local run too, keeping the policy enforce value', () => {
    const bin = tempDir();
    stubGate(bin, 'gitleaks', { versionSubcommand: true, versionLine: '8.30.1', reportFlag: '--report-path', reportBody: '[]', exit: 0, stdout: '' });
    const out = runGate(gl({ enforce: false }), { repoRoot: shallowClone(), staged: false, pathValue: bin, tempRoot: tempDir() });
    expect(out.couldNotRun?.reason).toBe('history-shallow');
    expect(out.enforce).toBe(false);
  });

  it('spawns gitleaks with GIT_NO_REPLACE_OBJECTS=1, so replace refs and grafts cannot cut the history it reads', () => {
    const bin = tempDir();
    const envLog = path.join(tempDir(), 'env.txt');
    stubGate(bin, 'gitleaks', { versionSubcommand: true, versionLine: '8.30.1', reportFlag: '--report-path', reportBody: '[]', exit: 0, stdout: '', envLog });
    runGate(gl(), { repoRoot: tempGitRepo(), staged: false, pathValue: bin, tempRoot: tempDir() });
    expect(readFileSync(envLog, 'utf8')).toContain('GIT_NO_REPLACE_OBJECTS=1');
  });

  it('does not touch a gate that reads the tree, or a full clone', () => {
    const bin = tempDir();
    stubGate(bin, 'dep-guard', { exit: 0, stdout: '{"findings":[]}' });
    const tree = runGate(gate(), { repoRoot: shallowClone(), staged: false, pathValue: bin, tempRoot: tempDir() });
    expect(tree.couldNotRun?.reason).not.toBe('history-shallow');

    const bin2 = tempDir();
    stubGate(bin2, 'gitleaks', { versionSubcommand: true, versionLine: '8.30.1', reportFlag: '--report-path', reportBody: '[]', exit: 0, stdout: '' });
    const full = runGate(gl(), { repoRoot: tempGitRepo(), staged: false, pathValue: bin2, tempRoot: tempDir() });
    expect(full.couldNotRun).toBeNull();
  });
});

describe('the git floor for a history gate on a pull-request run', () => {
  const REAL_GIT = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();

  /** A git that reports `version` and otherwise is the real one. */
  /** A git that reports `version`, and appends to `probeLog` each time it is asked. */
  function gitReporting(version: string, probeLog = path.join(tempDir(), 'probe.log')): string {
    const bin = tempDir();
    const file = path.join(bin, 'git');
    writeFileSync(
      file,
      `#!/bin/sh\nif [ "$1" = "--version" ]; then echo probed >> ${JSON.stringify(probeLog)}; echo "git version ${version}"; exit 0; fi\nexec ${REAL_GIT} "$@"\n`
    );
    chmodSync(file, 0o755);
    return file;
  }

  function historyRun(options: { trustBase?: string; git: string }) {
    const repo = tempGitRepo();
    const bin = tempDir();
    const log = path.join(tempDir(), 'argv.log');
    stubGate(bin, 'gitleaks', { versionSubcommand: true, versionLine: '8.30.1', reportFlag: '--report-path', reportBody: '[]', exit: 0, stdout: '', argvLog: log });
    useGitProgram(options.git);
    try {
      const out = runGate(gate({ role: 'secrets-history', product: 'gitleaks', stage: 'ci' }), {
        repoRoot: repo,
        staged: false,
        pathValue: bin,
        tempRoot: tempDir(),
        ...(options.trustBase === undefined ? {} : { trustBase: options.trustBase }),
      });
      return { out, spawned: existsSync(log) };
    } finally {
      useGitProgram('git');
    }
  }

  it('is a named could-not-run, enforced, when git is older than 2.31, and gitleaks is never spawned', () => {
    const { out, spawned } = historyRun({ trustBase: 'main', git: gitReporting('2.25.1') });

    expect(out.couldNotRun?.reason).toBe('preparation-failed');
    expect(out.couldNotRun?.detail).toMatch(/git 2\.25\.1 is older than 2\.31\.0/);
    expect(out.couldNotRun?.detail).toMatch(/--diff-merges/);
    expect(out.enforce).toBe(true);
    expect(spawned).toBe(false);
    const result = {
      trustBase: { ref: 'main', policyChanged: false, refusal: null },
      gates: [out],
      proposals: [],
    } as unknown as Parameters<typeof proposalCount>[0];
    expect(proposalCount(result)).toMatch(/secrets-history \(gitleaks\) could not run, so the proposals of that gate are not known/);
    // conductor's own reason is carried into the job log line, cleaned, on
    // one line, capped and quoted, the way a gate's stated reason is.
    const [line] = gateLogLines({ ...result, deferred: [], skipped: [], excluded: [], treeUnchanged: [] });
    expect(line).toMatch(
      /^conductor: gate secrets-history \(gitleaks version unknown\): could-not-run \(preparation-failed\), no exit code, conductor said: "git 2\.25\.1 is older than 2\.31\.0, which gitleaks needs on a pull-request run: /
    );
    const said = /conductor said: "(.*)"$/.exec(line ?? '')?.[1] ?? '';
    expect(said.length).toBeLessThanOrEqual(GATE_SAID_MAX_CHARS);
    expect(said).toMatch(/\.\.\.$/);
    expect(said).not.toMatch(/"/);
  });

  it('carries a refusal of its own into the job log line with markers broken and newlines flattened', () => {
    const result = {
      trustBase: { ref: 'main', policyChanged: false, refusal: null },
      gates: [
        {
          role: 'intent',
          product: 'intent-guard',
          stage: 'pre-push',
          enforce: true,
          productVersion: '1.8.1',
          argv: [],
          binary: null,
          exitCode: null,
          durationMs: 0,
          stderr: '',
          couldNotRun: { reason: 'preparation-failed', detail: 'line one\n::error::"two"' },
          findings: [],
          run: { suppressed: 0, ignored: 0, details: {} },
          diagnostics: [],
        },
      ],
      proposals: [],
      deferred: [],
      skipped: [],
      excluded: [],
      treeUnchanged: [],
    } as unknown as Parameters<typeof gateLogLines>[0];

    expect(gateLogLines(result)).toEqual([
      "conductor: gate intent (intent-guard 1.8.1): could-not-run (preparation-failed), no exit code, conductor said: \"line one : :error: :'two'\"",
    ]);
  });

  it('runs as usual at the floor', () => {
    const { out, spawned } = historyRun({ trustBase: 'main', git: gitReporting('2.31.0') });

    expect(out.couldNotRun).toBeNull();
    expect(spawned).toBe(true);
  });

  it('does not probe on a run without a trust base', () => {
    const probeLog = path.join(tempDir(), 'probe.log');
    const { out } = historyRun({ git: gitReporting('2.25.1', probeLog) });

    expect(out.couldNotRun).toBeNull();
    expect(existsSync(probeLog)).toBe(false);
  });

  it('asks git for its version once on a trust-base run', () => {
    const probeLog = path.join(tempDir(), 'probe.log');
    historyRun({ trustBase: 'main', git: gitReporting('2.31.0', probeLog) });

    expect(readFileSync(probeLog, 'utf8')).toBe('probed\n');
  });
});

describe('what a gate says when it could not run', () => {
  it('carries the first stderr line of an exit 2 gate as a bounded, sanitised excerpt', () => {
    const bin = tempDir();
    const long = 'x'.repeat(500);
    stubGate(bin, 'dep-guard', {
      stdout: '',
      stderr: `\u001b[31m\u001b[1mcorpus\u0007 unreadable ${long}\u001b[0m\nsecond line\n`,
      exit: 2,
    });

    const outcome = runGate(gate(), { repoRoot: tempDir(), staged: true, pathValue: bin });

    expect(outcome.exitCode).toBe(2);
    expect(outcome.couldNotRun?.reason).toBe('gate-error');
    const said = outcome.couldNotRun?.gateSaid ?? '';
    expect(said.startsWith('corpus unreadable xxx')).toBe(true);
    expect(said.length).toBe(GATE_SAID_MAX_CHARS);
    expect(said.endsWith('...')).toBe(true);
    expect(said).not.toContain('second line');
    expect(said).not.toMatch(/[^\x20-\x7e]/);
  });

  it('falls back to a reason field in stdout JSON when stderr is empty, and never changes the exit 2', () => {
    const bin = tempDir();
    stubGate(bin, 'vault-guard', {
      stdout: JSON.stringify({ run: { reason: 'two files could not be read' } }),
      stderr: '',
      exit: 2,
    });

    const outcome = runGate(gate({ role: 'secrets', product: 'vault-guard' }), {
      repoRoot: tempDir(),
      staged: true,
      pathValue: bin,
    });

    expect(outcome.exitCode).toBe(2);
    expect(outcome.couldNotRun?.reason).toBe('gate-error');
    expect(outcome.couldNotRun?.gateSaid).toBe('two files could not be read');
  });

  it('carries no excerpt, and does not throw, when an exit 2 gate printed nothing usable', () => {
    const bin = tempDir();
    stubGate(bin, 'vault-guard', { stdout: '{not json at all', stderr: '  \n', exit: 2 });

    const outcome = runGate(gate({ role: 'secrets', product: 'vault-guard' }), {
      repoRoot: tempDir(),
      staged: true,
      pathValue: bin,
    });

    expect(outcome.exitCode).toBe(2);
    expect(outcome.couldNotRun?.reason).toBe('gate-error');
    expect(outcome.couldNotRun?.gateSaid).toBeUndefined();
  });
});

describe('the gate stated reason, continued', () => {
  const vault = () => gate({ role: 'secrets', product: 'vault-guard' });

  it('breaks up workflow-command markers, stays one line and stays capped', () => {
    const bin = tempDir();
    stubGate(bin, 'vault-guard', {
      stdout: '',
      stderr: `##[error]x ::add-mask::x ###[y :::z "quoted" ${'::'.repeat(200)}\nnext\n`,
      exit: 2,
    });

    const said = runGate(vault(), { repoRoot: tempDir(), staged: true, pathValue: bin }).couldNotRun?.gateSaid ?? '';

    expect(said).toContain('error');
    expect(said).toContain('add-mask');
    expect(said).not.toContain('##[');
    expect(said).not.toContain('::');
    expect(said).not.toContain('"');
    expect(said).not.toContain('\n');
    expect(said.length).toBeLessThanOrEqual(GATE_SAID_MAX_CHARS);
  });

  it('breaks markers in a reason read from stdout JSON as well', () => {
    const bin = tempDir();
    stubGate(bin, 'vault-guard', { stdout: JSON.stringify({ reason: '::warning::a ##[error]b' }), stderr: '', exit: 2 });

    const said = runGate(vault(), { repoRoot: tempDir(), staged: true, pathValue: bin }).couldNotRun?.gateSaid ?? '';

    expect(said).not.toContain('##[');
    expect(said).not.toContain('::');
  });

  it('reads a top-level reason and a run.reason alike', () => {
    const top = tempDir();
    stubGate(top, 'vault-guard', { stdout: JSON.stringify({ reason: 'top reason' }), stderr: '', exit: 2 });
    const nested = tempDir();
    stubGate(nested, 'vault-guard', { stdout: JSON.stringify({ run: { reason: 'nested reason' } }), stderr: '', exit: 2 });

    expect(runGate(vault(), { repoRoot: tempDir(), staged: true, pathValue: top }).couldNotRun?.gateSaid).toBe('top reason');
    expect(runGate(vault(), { repoRoot: tempDir(), staged: true, pathValue: nested }).couldNotRun?.gateSaid).toBe('nested reason');
  });

  it('is not taken from stdout for a gate whose output is a report file', () => {
    const bin = tempDir();
    stubGate(bin, 'gitleaks', {
      versionSubcommand: true,
      versionLine: '8.30.1',
      exit: 2,
      stdout: JSON.stringify({ reason: 'from stdout' }),
      stderr: '',
    });

    const out = runGate(gate({ role: 'secrets-history', product: 'gitleaks', stage: 'ci' }), {
      repoRoot: tempGitRepo(),
      staged: false,
      pathValue: bin,
      tempRoot: tempDir(),
    });

    expect(out.couldNotRun?.reason).toBe('gate-error');
    expect(out.couldNotRun?.gateSaid).toBeUndefined();
  });

  it('carries none when the gate timed out', () => {
    const bin = tempDir();
    const file = path.join(bin, 'vault-guard');
    writeFileSync(
      file,
      '#!/bin/sh\nif [ "$1" = "--version" ]; then echo 1.9.0; exit 0; fi\necho stated-reason >&2\n/bin/sleep 5\n'
    );
    chmodSync(file, 0o755);

    const out = runGate(vault(), { repoRoot: tempDir(), staged: true, pathValue: bin, timeoutMs: 300 });

    expect(out.exitCode).toBeNull();
    expect(out.couldNotRun).not.toBeNull();
    expect(out.couldNotRun?.gateSaid).toBeUndefined();
  });

  it('never reaches the findings or their fingerprints', () => {
    const run = (reason: string) => {
      const bin = tempDir();
      stubGate(bin, 'vault-guard', { stdout: JSON.stringify({ reason }), stderr: '', exit: 2 });
      return runGate(vault(), { repoRoot: tempDir(), staged: true, pathValue: bin });
    };
    const first = run('first distinctive reason');
    const second = run('second distinctive reason');

    expect(first.couldNotRun?.gateSaid).toBe('first distinctive reason');
    expect(JSON.stringify(first.findings)).not.toContain('distinctive');
    expect(JSON.stringify(first.findings)).toBe(JSON.stringify(second.findings));
  });

  it('records no version skew for a gate that was not found, and none when versions agree', () => {
    const missing = runGate(vault(), { repoRoot: tempDir(), staged: true, pathValue: tempDir(), expectedVersion: '1.9.0' });
    expect(missing.couldNotRun?.reason).toBe('binary-missing');
    expect(missing.versionSkew).toBeUndefined();

    const bin = tempDir();
    stubGate(bin, 'vault-guard', { stdout: '', exit: 2, version: '1.9.0' });
    const same = runGate(vault(), { repoRoot: tempDir(), staged: true, pathValue: bin, expectedVersion: '1.9.0' });
    expect(same.versionSkew).toBeUndefined();
  });
});

describe('the wording of the reworded refusals', () => {
  it('tells a shallow checkout what to do, in the Fix sentence', () => {
    const repo = tempGitRepo();
    const source = tempDir();
    execFileSync('git', ['clone', '--quiet', '--depth=1', `file://${repo}`, source]);
    const bin = tempDir();
    stubGate(bin, 'gitleaks', { versionSubcommand: true, versionLine: '8.30.1', exit: 0, stdout: '' });

    const out = runGate(gate({ role: 'secrets-history', product: 'gitleaks', stage: 'ci' }), {
      repoRoot: source,
      staged: false,
      pathValue: bin,
      tempRoot: tempDir(),
    });

    expect(out.couldNotRun?.reason).toBe('history-shallow');
    expect(out.couldNotRun?.detail).toMatch(/^gitleaks did not run, because this checkout is shallow/);
    expect(out.couldNotRun?.detail).toContain('Fix: check out with fetch-depth: 0');
  });

  it('tells a too-old gate which version to upgrade to, in the Fix sentence', () => {
    const bin = tempDir();
    stubGate(bin, 'gitleaks', { versionSubcommand: true, versionLine: '8.18.4', exit: 0, stdout: '' });

    const out = runGate(gate({ role: 'secrets-history', product: 'gitleaks', stage: 'ci' }), {
      repoRoot: tempGitRepo(),
      staged: false,
      pathValue: bin,
      tempRoot: tempDir(),
    });

    expect(out.couldNotRun?.detail).toMatch(/^gitleaks did not run: the installed 8\.18\.4 is older than 8\.19\.0, /);
    expect(out.couldNotRun?.detail).toContain('Fix: upgrade it to 8.19.0 or later.');
  });
});
