// The pin check for pip requirements files (osv design, section 2.2): which
// requirements files osv-scanner is handed at all. Tests 3 and 4 of the
// design's test plan, against a fake reader so every row is one case.

import { describe, expect, it } from '@jest/globals';

import {
  checkRequirementsPins,
  describePinProblem,
  type IncludeRead,
} from '../src/requirements-pin.js';

/** A reader over an in-memory tree; anything not listed does not exist. */
function reader(files: Record<string, string>, why: Record<string, string> = {}) {
  const seen: string[] = [];
  const read = (file: string): IncludeRead => {
    seen.push(file);
    if (why[file] !== undefined) {
      return { kind: 'missing', why: why[file] };
    }
    const text = files[file];
    return text === undefined ? { kind: 'missing', why: 'does not exist' } : { kind: 'file', text };
  };
  return { read, seen };
}

function check(text: string, extra: Record<string, string> = {}) {
  const files = { 'requirements.txt': text, ...extra };
  return checkRequirementsPins('requirements.txt', reader(files).read);
}

describe('the pin check, one row of the table at a time (test 3)', () => {
  const pinned: Array<[string, string]> = [
    ['a bare pin', 'flask==2.0.1\n'],
    ['a pin with extras', 'requests[socks]==2.31.0\n'],
    ['a pin with spaces around ==', 'flask == 2.0.1\n'],
    ['a pin with an environment marker', 'flask==2.0.1 ; python_version >= "3.8"\n'],
    ['a pin with a marker and no space', 'flask==2.0.1;python_version<"3.12"\n'],
    ['a pin with --hash options', 'flask==2.0.1 --hash=sha256:aaaa --hash=sha256:bbbb\n'],
    [
      'a pin continued over lines with hashes',
      'flask==2.0.1 \\\n    --hash=sha256:aaaa \\\n    --hash=sha256:bbbb\n',
    ],
    ['comments and blank lines', '# top comment\n\nflask==2.0.1  # why this pin\n   \n#another\n'],
    ['a dotted and dashed name', 'zope.interface==6.0\npython-dateutil==2.8.2\n'],
  ];
  for (const [what, text] of pinned) {
    it(`reads ${what} as pinned`, () => {
      const out = check(text);
      expect(out.problems).toEqual([]);
      expect(out.pinned).toBe(true);
    });
  }

  const unpinned: Array<[string, string]> = [
    ['a prefix match', 'flask==1.2.*\n'],
    ['an arbitrary-equality pin', 'flask===1.2.3\n'],
    ['>=', 'flask>=2.0\n'],
    ['<=', 'flask<=2.0\n'],
    ['~=', 'flask~=2.0\n'],
    ['!=', 'flask!=2.0\n'],
    ['>', 'flask>2.0\n'],
    ['<', 'flask<2.0\n'],
    ['a range', 'flask>=2.0,<3\n'],
    ['two specifiers', 'flask==2.0.1,==2.0.2\n'],
    ['no specifier', 'flask\n'],
    ['an environment substitution', 'flask==${FLASK_VERSION}\n'],
    ['a dollar in the version', 'flask==2.$X\n'],
    ['an option conductor does not know', '--no-index\n'],
    ['a requirement carrying an unknown option', 'flask==2.0.1 --global-option=x\n'],
    ['a line that is not a requirement', 'this is ! not a requirement\n'],
  ];
  for (const [what, text] of unpinned) {
    it(`reads ${what} as not pinned`, () => {
      const out = check(`six==1.16.0\n${text}`);
      expect(out.pinned).toBe(false);
      expect(out.problems).toHaveLength(1);
      expect(out.problems[0]!.line).toBe(2);
    });
  }

  it('names === in its own reason', () => {
    const out = check('flask===1.2.3\n');
    expect(describePinProblem('requirements.txt', out.problems[0]!)).toBe(
      'line 1 "flask===1.2.3" is pinned with ===, not ==, so any version osv-scanner reported would be a guess'
    );
  });

  it('words an ordinary unpinned line the way the design states it', () => {
    const top = 'services/api/requirements.txt';
    const out = checkRequirementsPins(top, reader({ [top]: 'six==1.16.0\n\n\nflask>=2.0\n' }).read);
    expect(describePinProblem(top, out.problems[0]!)).toBe(
      'line 4 "flask>=2.0" is not pinned with ==, so any version osv-scanner reported would be a guess'
    );
  });

  const ignored = [
    '-c constraints.txt',
    '--constraint constraints.txt',
    '--constraint=constraints.txt',
    '-i https://example.invalid/simple',
    '--index-url https://example.invalid/simple',
    '--extra-index-url https://example.invalid/simple',
    '-f ./wheels',
    '--find-links ./wheels',
    '--trusted-host example.invalid',
    '--pre',
    '--prefer-binary',
    '--only-binary :all:',
    '--no-binary :none:',
    '--require-hashes',
    '--use-feature truststore',
  ];
  for (const line of ignored) {
    it(`ignores "${line}" for the check and never reads it as a requirement or an include`, () => {
      const r = reader({ 'requirements.txt': `${line}\nflask==2.0.1\n` });
      const out = checkRequirementsPins('requirements.txt', r.read);
      expect(out.problems).toEqual([]);
      expect(out.pinned).toBe(true);
      expect(r.seen).toEqual(['requirements.txt']);
    });
  }

  const direct = [
    '-e .',
    '--editable ./packages/core',
    '--editable=./packages/core',
    './local/pkg',
    '../sibling/pkg',
    'packages/core',
    'https://example.invalid/pkg-1.0-py3-none-any.whl',
    'git+https://example.invalid/org/repo.git@v1#egg=pkg',
    'pkg @ https://example.invalid/pkg-1.0.tar.gz',
    'pkg[extra] @ file:///opt/pkg',
    'dist/pkg-1.0-py3-none-any.whl',
  ];
  for (const line of direct) {
    it(`excludes the direct reference "${line}" from the check and counts it`, () => {
      const out = check(`${line}\nflask==2.0.1\n`);
      expect(out.problems).toEqual([]);
      expect(out.pinned).toBe(true);
      expect(out.excluded).toBe(1);
    });
  }
});

describe('includes (test 4)', () => {
  it('follows -r and requires the included file to be pinned too', () => {
    const ok = checkRequirementsPins(
      'requirements.txt',
      reader({ 'requirements.txt': '-r base.txt\nflask==2.0.1\n', 'base.txt': 'six==1.16.0\n' }).read
    );
    expect(ok.pinned).toBe(true);
    expect(ok.files).toEqual(['requirements.txt', 'base.txt']);

    const bad = checkRequirementsPins(
      'requirements.txt',
      reader({ 'requirements.txt': '--requirement base.txt\nflask==2.0.1\n', 'base.txt': 'six>=1\n' }).read
    );
    expect(bad.pinned).toBe(false);
    expect(describePinProblem('requirements.txt', bad.problems[0]!)).toBe(
      'line 1 of base.txt "six>=1" is not pinned with ==, so any version osv-scanner reported would be a guess'
    );
  });

  it('accepts the attached and = spellings of -r', () => {
    for (const spelling of ['-rbase.txt', '--requirement=base.txt']) {
      const out = checkRequirementsPins(
        'requirements.txt',
        reader({ 'requirements.txt': `${spelling}\n`, 'base.txt': 'six>=1\n' }).read
      );
      expect([spelling, out.pinned]).toEqual([spelling, false]);
    }
  });

  const unscanned: Array<[string, Record<string, string>, Record<string, string>, string]> = [
    ['a missing include', { 'requirements.txt': '-r base.txt\n' }, {}, 'includes base.txt, which does not exist'],
    [
      'an include outside the repository',
      { 'requirements.txt': '-r ../shared.txt\n' },
      {},
      'includes ../shared.txt, which is outside the repository',
    ],
    [
      'an include that climbs out from a subdirectory',
      { 'requirements.txt': '-r sub/../../shared.txt\n' },
      {},
      'includes sub/../../shared.txt, which is outside the repository',
    ],
    [
      'an absolute include',
      { 'requirements.txt': '-r /etc/shared.txt\n' },
      {},
      'includes /etc/shared.txt, which is an absolute path',
    ],
    [
      'a URL include',
      { 'requirements.txt': '-r https://example.invalid/r.txt\n' },
      {},
      'includes https://example.invalid/r.txt, which is a URL',
    ],
    [
      'an untracked include',
      { 'requirements.txt': '-r base.txt\n' },
      { 'base.txt': 'is not tracked' },
      'includes base.txt, which is not tracked',
    ],
  ];
  for (const [what, files, why, reason] of unscanned) {
    it(`leaves the top file unscanned for ${what}`, () => {
      const out = checkRequirementsPins('requirements.txt', reader(files, why).read);
      expect(out.pinned).toBe(false);
      expect(describePinProblem('requirements.txt', out.problems[0]!)).toBe(reason);
    });
  }

  function chain(length: number): Record<string, string> {
    const files: Record<string, string> = { 'requirements.txt': '-r r1.txt\n' };
    for (let i = 1; i < length; i += 1) {
      files[`r${i}.txt`] = `-r r${i + 1}.txt\n`;
    }
    files[`r${length}.txt`] = 'six==1.16.0\n';
    return files;
  }

  it('follows includes eight deep and refuses a ninth', () => {
    expect(checkRequirementsPins('requirements.txt', reader(chain(8)).read).pinned).toBe(true);
    const deep = checkRequirementsPins('requirements.txt', reader(chain(9)).read);
    expect(deep.pinned).toBe(false);
    expect(describePinProblem('requirements.txt', deep.problems[0]!)).toBe(
      'includes r9.txt (from r8.txt), more than 8 includes deep'
    );
  });

  it('scans a cycle and a self-include of pinned files, visiting each file once', () => {
    const cycle = reader({
      'requirements.txt': '-r base.txt\nflask==2.0.1\n',
      'base.txt': '-r requirements.txt\nsix==1.16.0\n',
    });
    const out = checkRequirementsPins('requirements.txt', cycle.read);
    expect(out.pinned).toBe(true);
    expect(cycle.seen).toEqual(['requirements.txt', 'base.txt']);

    const self = reader({ 'requirements.txt': '-r requirements.txt\nflask==2.0.1\n' });
    expect(checkRequirementsPins('requirements.txt', self.read).pinned).toBe(true);
    expect(self.seen).toEqual(['requirements.txt']);
  });

  it('resolves an include against the including file directory, not the working directory', () => {
    const r = reader({
      'sub/requirements-dev.txt': '-r base.txt\n-r requirements-dev.txt\n',
      'sub/base.txt': 'six==1.16.0\n',
      'base.txt': 'six>=1\n',
    });
    const out = checkRequirementsPins('sub/requirements-dev.txt', r.read);
    expect(out.pinned).toBe(true);
    expect(out.files).toEqual(['sub/requirements-dev.txt', 'sub/base.txt']);
    expect(r.seen).not.toContain('base.txt');
  });

  it('collects every problem, not only the first, for the ratchet diagnostic', () => {
    const out = check('flask>=2\nsix==1.16.0\nrequests\n');
    expect(out.problems.map((p) => p.line)).toEqual([1, 3]);
  });
});
