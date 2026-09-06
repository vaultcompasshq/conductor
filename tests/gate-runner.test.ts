import { afterEach, describe, expect, it } from '@jest/globals';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { decideTrustBase, runGate } from '../src/gate-runner.js';
import type { GatePolicy } from '../src/policy.js';
import { stubGate } from './helpers/stub-gate.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

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

    expect(outcome.couldNotRun?.detail).toBe(
      'no dep-guard binary in node_modules/.bin or on PATH'
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
 * Two failures are possible here and they are opposite, which is why the
 * decision is its own function rather than a condition inside gateArgs.
 * Handing the flag to a gate that does not parse it makes that gate exit
 * non-zero with no JSON, which the umbrella correctly reports as
 * could-not-run: a wrong guess turns a working repository's pull requests
 * red. WITHHOLDING it silently leaves that gate reading its own control
 * inputs out of the tree under judgment, which is the hole pull-request mode
 * exists to close. So every withholding carries a reason, and the reason is
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
    expect(decideTrustBase(intentGate, nativeIntent, undefined, '1.4.0')).toBeUndefined();
  });

  it('passes the flag to an intent-guard at the version it arrived in', () => {
    expect(decideTrustBase(intentGate, nativeIntent, 'origin/main', '1.4.0')).toEqual({
      ref: 'origin/main',
      withheld: null,
      refused: null,
      proposals: [],
    });
  });

  it('withholds it from an intent-guard below that version, and says which', () => {
    const decision = decideTrustBase(intentGate, nativeIntent, 'origin/main', '1.3.1');
    expect(decision?.withheld).toMatch(/1\.3\.1 does not understand --trust-base/);
    expect(decision?.withheld).toMatch(/1\.4\.0/);
    expect(decision?.withheld).toMatch(/tree being judged/);
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
    const below = decideTrustBase(intentGate, nativeIntent, 'origin/main', '1.3.1');
    const unreadable = decideTrustBase(intentGate, nativeIntent, 'origin/main', null);

    expect(below?.withheld).toBe(
      'intent-guard 1.3.1 does not understand --trust-base, which arrived in 1.4.0, so it read ' +
        'its own control inputs from the tree being judged. Upgrade it to put this gate into ' +
        'pull-request mode.'
    );
    expect(unreadable?.refused).not.toMatch(/reported no version does not understand/);
  });

  it('passes the flag to a dep-guard at the version it arrived in', () => {
    const decision = decideTrustBase(
      gate({ role: 'dependencies', product: 'dep-guard' }),
      undefined,
      'origin/main',
      '0.6.0'
    );

    expect(decision).toEqual({
      ref: 'origin/main',
      withheld: null,
      refused: null,
      proposals: [],
    });
  });

  it('withholds it from a dep-guard below that version', () => {
    const decision = decideTrustBase(
      gate({ role: 'dependencies', product: 'dep-guard' }),
      undefined,
      'origin/main',
      '0.5.0'
    );

    expect(decision?.withheld).toMatch(/dep-guard 0\.5\.0 does not understand --trust-base/);
    expect(decision?.withheld).toMatch(/0\.6\.0/);
    expect(decision?.refused).toBeNull();
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

  it('passes the flag to a vault-guard at the version it arrived in', () => {
    const decision = decideTrustBase(
      gate({ role: 'secrets', product: 'vault-guard' }),
      undefined,
      'origin/main',
      '1.7.0'
    );

    expect(decision).toEqual({
      ref: 'origin/main',
      withheld: null,
      refused: null,
      proposals: [],
    });
  });

  it('withholds it from a vault-guard below that version', () => {
    const decision = decideTrustBase(
      gate({ role: 'secrets', product: 'vault-guard' }),
      undefined,
      'origin/main',
      '1.6.0'
    );

    expect(decision?.withheld).toMatch(/vault-guard 1\.6\.0 does not understand --trust-base/);
    expect(decision?.withheld).toMatch(/1\.7\.0/);
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
      '1.4.0'
    );
    expect(decision?.withheld).toMatch(/temporary directory with no repository in it/);
  });

  it('passes it on a plain run with no prepared contract, where --project is the repository', () => {
    expect(decideTrustBase(intentGate, undefined, 'origin/main', '1.4.0')?.withheld).toBeNull();
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
    stubGate(bin, 'intent-guard', { stdout: CLEAN_INTENT, argvLog: log, version: '1.4.0' });

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

  it('writes no such flag for a gate below the floor, and says so on the outcome', () => {
    const bin = tempDir();
    const log = path.join(tempDir(), 'argv.txt');
    stubGate(bin, 'intent-guard', {
      stdout: '{"status":"ok","exitCode":0,"reasons":[],"contractFound":true,"contractFrozen":true}',
      argvLog: log,
      version: '1.3.1',
    });

    const outcome = runGate(gate({ role: 'intent', product: 'intent-guard' }), {
      repoRoot: tempDir(),
      staged: true,
      pathValue: bin,
      trustBase: 'origin/main',
    });

    expect(readFileSync(log, 'utf8').trim()).toBe('check --project . --staged --json');
    expect(outcome.trustBase?.withheld).toMatch(/1\.3\.1/);
    expect(outcome.couldNotRun).toBeNull();
  });

  it('keeps the withheld reason rather than replacing it with an empty proposal list', () => {
    // A gate that was not in pull-request mode reports no proposals. Reading
    // that as "nothing was proposed" would let the loudest fact in the log,
    // that this gate read its own rules out of the tree being judged, be
    // replaced by silence.
    const bin = tempDir();
    stubGate(bin, 'intent-guard', {
      stdout: '{"status":"ok","exitCode":0,"reasons":[],"contractFound":true,"contractFrozen":true}',
      version: '1.3.1',
    });

    const outcome = runGate(gate({ role: 'intent', product: 'intent-guard' }), {
      repoRoot: tempDir(),
      staged: false,
      pathValue: bin,
      trustBase: 'origin/main',
    });

    expect(outcome.trustBase?.withheld).not.toBeNull();
    expect(outcome.trustBase?.proposals).toEqual([]);
  });

  it('carries the decision on a gate that could not run at all', () => {
    // Which contract a gate WOULD have judged against is exactly as
    // interesting when it broke as when it did not.
    const bin = tempDir();
    stubGate(bin, 'intent-guard', { stdout: 'not json', exit: 1, version: '1.4.0' });

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
