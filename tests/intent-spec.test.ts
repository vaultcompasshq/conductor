import { afterEach, describe, expect, it } from '@jest/globals';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MIN_TOKEN_LENGTH,
  STOP_WORDS,
  branchSlug,
  candidateRun,
  discoverSpec,
  isSignificant,
  normalizeStem,
  prBodyFromEvent,
  selectByBranch,
  specFromPrBody,
  tokens,
} from '../src/intent-spec.js';

const temps: string[] = [];

afterEach(() => {
  while (temps.length > 0) {
    rmSync(temps.pop() as string, { recursive: true, force: true });
  }
});

/** The match record of a branch named exactly after the widget-cache spec. */
const EXACT_WIDGET_CACHE = {
  strength: 'exact',
  weakBecause: [],
  shared: ['widget', 'cache'],
  runnerUp: null,
  runnerUpShared: [],
  legacy: null,
};

/** What discoverSpec says when a branch was given and nothing matched it. */
const NO_CANDIDATE = { kind: 'none', selection: { why: 'no-candidate', tied: [], legacy: null } };

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'conductor-spec-'));
  temps.push(dir);
  return dir;
}

/** A repository tree carrying the named specs and plans, and nothing else. */
function repoWith(specs: string[], plans: string[] = []): string {
  const root = tempDir();
  const specDir = path.join(root, 'docs', 'superpowers', 'specs');
  const planDir = path.join(root, 'docs', 'superpowers', 'plans');
  mkdirSync(specDir, { recursive: true });
  mkdirSync(planDir, { recursive: true });
  for (const name of specs) {
    writeFileSync(path.join(specDir, name), '# spec\n');
  }
  for (const name of plans) {
    writeFileSync(path.join(planDir, name), '# plan\n');
  }
  return root;
}

describe('branchSlug', () => {
  it('drops the first path segment, which is the branch prefix', () => {
    expect(branchSlug('feat/widget-cache')).toBe('widget-cache');
    expect(branchSlug('fix/widget-cache')).toBe('widget-cache');
  });

  it('keeps a branch name that has no prefix at all', () => {
    expect(branchSlug('widget-cache')).toBe('widget-cache');
  });

  it('drops only the FIRST segment, so a nested branch keeps the rest', () => {
    // "alex/feat/widget-cache" is one prefix and a two-segment name, not
    // two prefixes: dropping every segment but the last would turn
    // "feat/online/cache" into "cache" and match the wrong spec.
    expect(branchSlug('feat/online/widget-cache')).toBe('online/widget-cache');
  });
});

describe('normalizeStem', () => {
  it('strips the date prefix and the -design suffix', () => {
    expect(normalizeStem('2026-09-03-widget-cache-design.md')).toBe('widget-cache');
  });

  it('strips a date prefix on its own', () => {
    expect(normalizeStem('2026-09-03-widget-cache.md')).toBe('widget-cache');
  });

  it('leaves a name with neither alone', () => {
    expect(normalizeStem('widget-cache.md')).toBe('widget-cache');
  });

  it('does not treat a number that is not a date as a prefix', () => {
    expect(normalizeStem('2026-09-widget.md')).toBe('2026-09-widget');
  });
});

describe('candidateRun', () => {
  it('matches when the stem contains the slug as a whole-token run', () => {
    expect(candidateRun('widget-cache', 'widget-cache-and-index')).not.toBeNull();
  });

  it('matches when the slug contains the stem as a whole-token run', () => {
    expect(candidateRun('widget-cache-rev2', 'widget-cache')).not.toBeNull();
  });

  it('does not match unrelated names', () => {
    expect(candidateRun('secret-scanner', 'widget-cache')).toBeNull();
  });
});

describe('specFromPrBody', () => {
  it('reads a Spec: line', () => {
    expect(specFromPrBody('Some prose.\nSpec: docs/superpowers/specs/a.md\nMore.')).toBe(
      'docs/superpowers/specs/a.md'
    );
  });

  it('returns null when there is no such line', () => {
    expect(specFromPrBody('Some prose about a spec, in passing.')).toBeNull();
  });

  it('takes the first line when a body names two, rather than the last', () => {
    expect(specFromPrBody('Spec: docs/a.md\nand later\nSpec: docs/b.md\n')).toBe('docs/a.md');
  });

  it('ignores a Spec: that is not at the start of a line', () => {
    // Otherwise a sentence mentioning "the Spec: value" in prose names a file.
    expect(specFromPrBody('See the Spec: docs/a.md in the other PR.')).toBeNull();
  });
});

describe('prBodyFromEvent', () => {
  it('reads pull_request.body out of the event payload', () => {
    const dir = tempDir();
    const file = path.join(dir, 'event.json');
    writeFileSync(file, JSON.stringify({ pull_request: { body: 'Spec: docs/a.md' } }));
    expect(prBodyFromEvent(file)).toBe('Spec: docs/a.md');
  });

  it('returns null for a payload that is not a pull request', () => {
    const dir = tempDir();
    const file = path.join(dir, 'event.json');
    writeFileSync(file, JSON.stringify({ push: { ref: 'refs/heads/main' } }));
    expect(prBodyFromEvent(file)).toBeNull();
  });

  it('returns null rather than throwing for a missing or unreadable file', () => {
    expect(prBodyFromEvent(path.join(tempDir(), 'nothing.json'))).toBeNull();
  });
});

describe('discoverSpec', () => {
  it('finds a spec by branch slug, with the date prefix and -design suffix stripped', () => {
    const root = repoWith(['2026-09-03-widget-cache-design.md']);

    const found = discoverSpec({ repoRoot: root, branch: 'feat/widget-cache' });

    expect(found).toEqual({
      kind: 'convention',
      spec: 'docs/superpowers/specs/2026-09-03-widget-cache-design.md',
      plan: null,
      match: EXACT_WIDGET_CACHE,
    });
  });

  it('pairs the plan matched by the same stem rule', () => {
    const root = repoWith(['2026-09-03-widget-cache-design.md'], ['2026-09-03-widget-cache.md']);

    const found = discoverSpec({ repoRoot: root, branch: 'feat/widget-cache' });

    expect(found).toEqual({
      kind: 'convention',
      spec: 'docs/superpowers/specs/2026-09-03-widget-cache-design.md',
      plan: 'docs/superpowers/plans/2026-09-03-widget-cache.md',
      match: EXACT_WIDGET_CACHE,
    });
  });

  it('takes the lexically newest filename when several specs match', () => {
    const root = repoWith([
      '2026-08-01-widget-cache-design.md',
      '2026-09-03-widget-cache-design.md',
      '2026-07-14-widget-cache-design.md',
    ]);

    const found = discoverSpec({ repoRoot: root, branch: 'feat/widget-cache' });

    expect(found).toMatchObject({
      spec: 'docs/superpowers/specs/2026-09-03-widget-cache-design.md',
    });
  });

  it('prefers the spec whose stem IS the branch slug over a newer looser one', () => {
    // The reproduction. On this branch the loose candidate normalizes to
    // "superpowers", which the slug contains, so it matched; it carried a
    // later date, so lexical order handed it the win over the branch's own
    // spec. A pull request was then measured against another feature's
    // requirements entirely.
    const root = repoWith([
      '2026-09-03-1.2.1-base-and-superpowers-design.md',
      '2026-09-05-superpowers-design.md',
    ]);

    const found = discoverSpec({ repoRoot: root, branch: 'feat/1.2.1-base-and-superpowers' });

    expect(found).toMatchObject({
      spec: 'docs/superpowers/specs/2026-09-03-1.2.1-base-and-superpowers-design.md',
    });
  });

  it('does not let an undated looser spec win by sorting last', () => {
    // Undated names sort after every dated one, so the old lexical rule gave
    // the win to whatever happened to have no date prefix, however little it
    // had to do with the branch.
    const root = repoWith(['2026-09-03-widget-cache-design.md', 'cache-design.md']);

    const found = discoverSpec({ repoRoot: root, branch: 'feat/widget-cache' });

    expect(found).toMatchObject({
      spec: 'docs/superpowers/specs/2026-09-03-widget-cache-design.md',
    });
  });

  it('takes the most specific match when none is exact', () => {
    const root = repoWith(['2026-09-03-cache-design.md', '2026-09-01-widget-cache-rev-design.md']);

    const found = discoverSpec({ repoRoot: root, branch: 'feat/widget-cache-rev-two' });

    expect(found).toMatchObject({
      spec: 'docs/superpowers/specs/2026-09-01-widget-cache-rev-design.md',
    });
  });

  it('pairs no plan at all rather than another feature plan', () => {
    // The worst outcome of the loose rule: one feature's requirements frozen
    // against another feature's change budget, which then blocks or passes a
    // pull request for reasons belonging to neither.
    const root = repoWith(['2026-09-03-widget-cache-design.md'], ['2026-09-03-widget.md']);

    const found = discoverSpec({ repoRoot: root, branch: 'feat/widget-cache' });

    expect(found).toMatchObject({
      spec: 'docs/superpowers/specs/2026-09-03-widget-cache-design.md',
      plan: null,
    });
  });

  it('lets a Spec: line in the PR body win over the branch-slug match', () => {
    const root = repoWith(['2026-09-03-widget-cache-design.md', '2026-09-01-other-design.md']);

    const found = discoverSpec({
      repoRoot: root,
      branch: 'feat/widget-cache',
      prBody: 'Does a thing.\nSpec: docs/superpowers/specs/2026-09-01-other-design.md\n',
    });

    expect(found).toEqual({
      kind: 'pr-body',
      spec: 'docs/superpowers/specs/2026-09-01-other-design.md',
      plan: null,
    });
  });

  it('lets --spec win over a Spec: line in the PR body', () => {
    const root = repoWith(['2026-09-03-widget-cache-design.md', '2026-09-01-other-design.md']);

    const found = discoverSpec({
      repoRoot: root,
      branch: 'feat/widget-cache',
      prBody: 'Spec: docs/superpowers/specs/2026-09-01-other-design.md\n',
      spec: 'docs/superpowers/specs/2026-09-03-widget-cache-design.md',
    });

    expect(found).toEqual({
      kind: 'flag',
      spec: 'docs/superpowers/specs/2026-09-03-widget-cache-design.md',
      plan: null,
    });
  });

  it('falls through to the convention when the PR body names a file that is not there', () => {
    // A typo in a pull request description must not be able to fail a build,
    // and it must not be able to silence the gate either.
    const root = repoWith(['2026-09-03-widget-cache-design.md']);

    const found = discoverSpec({
      repoRoot: root,
      branch: 'feat/widget-cache',
      prBody: 'Spec: docs/superpowers/specs/typo.md\n',
    });

    expect(found).toMatchObject({
      kind: 'convention',
      spec: 'docs/superpowers/specs/2026-09-03-widget-cache-design.md',
    });
  });

  describe('a PR body naming a path outside the repository', () => {
    /** A repository root with a readable file sitting beside it. */
    function rootWithOutsideFile(specs: string[]): { root: string; outside: string } {
      const parent = tempDir();
      const root = path.join(parent, 'repo');
      const specDir = path.join(root, 'docs', 'superpowers', 'specs');
      mkdirSync(specDir, { recursive: true });
      for (const name of specs) {
        writeFileSync(path.join(specDir, name), '# spec\n');
      }
      const outside = path.join(parent, 'outside-spec.md');
      writeFileSync(outside, '# not this repository\n');
      return { root, outside };
    }

    it('falls through to the convention rather than importing it', () => {
      // On a fork pull request the body is attacker-controlled, and the path
      // it names reaches the drafted contract and the approved-by string.
      const { root } = rootWithOutsideFile(['2026-09-03-widget-cache-design.md']);

      const found = discoverSpec({
        repoRoot: root,
        branch: 'feat/widget-cache',
        prBody: 'Spec: ../outside-spec.md\n',
      });

      expect(found).toMatchObject({
        kind: 'convention',
        spec: 'docs/superpowers/specs/2026-09-03-widget-cache-design.md',
      });
    });

    it('finds nothing at all when there is no convention match to fall through to', () => {
      const { root } = rootWithOutsideFile([]);

      expect(
        discoverSpec({
          repoRoot: root,
          branch: 'feat/widget-cache',
          prBody: 'Spec: ../outside-spec.md\n',
        })
      ).toEqual(NO_CANDIDATE);
    });

    it('refuses an absolute path out of the tree the same way', () => {
      const { root, outside } = rootWithOutsideFile([]);

      expect(
        discoverSpec({ repoRoot: root, branch: 'feat/widget-cache', prBody: `Spec: ${outside}\n` })
      ).toEqual(NO_CANDIDATE);
    });

    it('refuses a committed symlink that points out of the tree', () => {
      // The two-step route back to the same escape, and one pull request can
      // take both steps. On a pull_request event actions/checkout checks out
      // the merge ref, so a fork's own commits are in the tree: the same pull
      // request adds the symlink AND the Spec: line naming it, and a
      // containment test done on the path as a STRING sees an ordinary
      // relative path.
      const { root, outside } = rootWithOutsideFile(['2026-09-03-widget-cache-design.md']);
      symlinkSync(outside, path.join(root, 'docs', 'superpowers', 'specs', 'link-design.md'));

      const found = discoverSpec({
        repoRoot: root,
        branch: 'feat/widget-cache',
        prBody: 'Spec: docs/superpowers/specs/link-design.md\n',
      });

      expect(found).toMatchObject({
        kind: 'convention',
        spec: 'docs/superpowers/specs/2026-09-03-widget-cache-design.md',
      });
    });

    it('still follows a symlink that stays inside the tree', () => {
      // The check is containment, not a ban on symlinks. A repository that
      // keeps its specs behind one is doing something ordinary.
      const { root } = rootWithOutsideFile([]);
      const specDir = path.join(root, 'docs', 'superpowers', 'specs');
      const real = path.join(root, 'real-spec.md');
      writeFileSync(real, '# inside the repository\n');
      symlinkSync(real, path.join(specDir, 'linked-design.md'));

      const found = discoverSpec({
        repoRoot: root,
        branch: 'feat/anything',
        prBody: 'Spec: docs/superpowers/specs/linked-design.md\n',
      });

      expect(found).toMatchObject({
        kind: 'pr-body',
        spec: 'docs/superpowers/specs/linked-design.md',
      });
    });

    it('treats a dangling symlink as a path that is not there', () => {
      const { root } = rootWithOutsideFile(['2026-09-03-widget-cache-design.md']);
      const specDir = path.join(root, 'docs', 'superpowers', 'specs');
      symlinkSync(path.join(root, 'gone.md'), path.join(specDir, 'dangling-design.md'));

      const found = discoverSpec({
        repoRoot: root,
        branch: 'feat/widget-cache',
        prBody: 'Spec: docs/superpowers/specs/dangling-design.md\n',
      });

      expect(found).toMatchObject({
        kind: 'convention',
        spec: 'docs/superpowers/specs/2026-09-03-widget-cache-design.md',
      });
    });

    it('still lets --spec point outside, because a person typed it', () => {
      const { root, outside } = rootWithOutsideFile([]);

      expect(discoverSpec({ repoRoot: root, branch: 'feat/widget-cache', spec: outside })).toMatchObject(
        { kind: 'flag' }
      );
    });
  });

  it('reports a --spec path that is not there rather than quietly discovering another', () => {
    // The opposite call from the PR body, and deliberately so: somebody typed
    // this on the command line just now, so running a different contract than
    // the one they named is the wrong kindness.
    const root = repoWith(['2026-09-03-widget-cache-design.md']);

    const found = discoverSpec({
      repoRoot: root,
      branch: 'feat/widget-cache',
      spec: 'docs/superpowers/specs/typo.md',
    });

    expect(found).toEqual({
      kind: 'missing-flag',
      spec: 'docs/superpowers/specs/typo.md',
    });
  });

  it('finds nothing when no spec matches the branch', () => {
    const root = repoWith(['2026-09-03-secret-scanner-design.md']);

    expect(discoverSpec({ repoRoot: root, branch: 'feat/widget-cache' })).toEqual(NO_CANDIDATE);
  });

  it('finds nothing when the spec directory does not exist at all', () => {
    expect(discoverSpec({ repoRoot: tempDir(), branch: 'feat/widget-cache' })).toEqual(NO_CANDIDATE);
  });

  it('ignores a spec nested in a subdirectory, which is not the convention', () => {
    const root = repoWith([]);
    const nested = path.join(root, 'docs', 'superpowers', 'specs', 'archive');
    mkdirSync(nested, { recursive: true });
    writeFileSync(path.join(nested, '2026-09-03-widget-cache-design.md'), '# spec\n');

    expect(discoverSpec({ repoRoot: root, branch: 'feat/widget-cache' })).toEqual(NO_CANDIDATE);
  });

  it('ignores a file under the spec directory that is not markdown', () => {
    const root = repoWith(['2026-09-03-widget-cache-design.txt']);

    expect(discoverSpec({ repoRoot: root, branch: 'feat/widget-cache' })).toEqual(NO_CANDIDATE);
  });

  it('pairs a plan with a spec that came from the PR body', () => {
    const root = repoWith(['2026-09-01-other-design.md'], ['2026-09-01-other.md']);

    const found = discoverSpec({
      repoRoot: root,
      branch: 'feat/unrelated',
      prBody: 'Spec: docs/superpowers/specs/2026-09-01-other-design.md\n',
    });

    expect(found).toMatchObject({ plan: 'docs/superpowers/plans/2026-09-01-other.md' });
  });
});

describe('Spec: none, the explicit waiver', () => {
  it('beats the branch-slug convention, even with a matching spec on disk', () => {
    // An explicit statement beats an inferred one. Without this the token
    // fell through as an unusable path and the branch's own spec was
    // imported anyway, which is the opposite of what the body asked for.
    const root = repoWith(['2026-09-03-widget-cache-design.md']);

    const found = discoverSpec({
      repoRoot: root,
      branch: 'feat/widget-cache',
      prBody: 'No contract for this one.\nSpec: none\n',
    });

    expect(found).toEqual({ kind: 'waived' });
  });

  it('is waived rather than none, so the report can tell the two apart', () => {
    const root = repoWith([]);

    expect(
      discoverSpec({ repoRoot: root, branch: 'feat/widget-cache', prBody: 'Spec: none\n' })
    ).toEqual({ kind: 'waived' });
  });

  it('loses to --spec, which is the most explicit statement of all', () => {
    const root = repoWith(['2026-09-03-widget-cache-design.md']);

    const found = discoverSpec({
      repoRoot: root,
      branch: 'feat/widget-cache',
      prBody: 'Spec: none\n',
      spec: 'docs/superpowers/specs/2026-09-03-widget-cache-design.md',
    });

    expect(found).toEqual({
      kind: 'flag',
      spec: 'docs/superpowers/specs/2026-09-03-widget-cache-design.md',
      plan: null,
    });
  });

  it('is the exact lowercase token and nothing else', () => {
    // "None" is somebody writing prose, and a capital letter must not be
    // able to waive a gate. Any other unusable value keeps the old
    // behaviour: fall through to the convention, silently, by design.
    const root = repoWith(['2026-09-03-widget-cache-design.md']);

    const found = discoverSpec({
      repoRoot: root,
      branch: 'feat/widget-cache',
      prBody: 'Spec: None\n',
    });

    expect(found).toMatchObject({
      kind: 'convention',
      spec: 'docs/superpowers/specs/2026-09-03-widget-cache-design.md',
    });
  });

  it('takes the FIRST Spec: line, so a later real path does not undo it', () => {
    const root = repoWith(['2026-09-03-widget-cache-design.md']);

    const found = discoverSpec({
      repoRoot: root,
      branch: 'feat/widget-cache',
      prBody: 'Spec: none\nand later\nSpec: docs/superpowers/specs/2026-09-03-widget-cache-design.md\n',
    });

    expect(found).toEqual({ kind: 'waived' });
  });
});

describe('a spec or plan directory that leads out of the repository', () => {
  it('refuses a convention spec reached through a symlinked specs directory, naming it', () => {
    const root = tempDir();
    const outside = tempDir();
    writeFileSync(path.join(outside, '2026-09-03-widget-cache-design.md'), '# outside\n');
    mkdirSync(path.join(root, 'docs', 'superpowers'), { recursive: true });
    symlinkSync(outside, path.join(root, 'docs', 'superpowers', 'specs'));

    const found = discoverSpec({ repoRoot: root, branch: 'feat/widget-cache' });

    expect(found).toEqual({
      kind: 'escaped',
      path: 'docs/superpowers/specs/2026-09-03-widget-cache-design.md',
    });
  });

  it('refuses a plan reached through a symlinked plans directory, rather than dropping it', () => {
    const root = repoWith(['2026-09-03-widget-cache-design.md']);
    const outside = tempDir();
    writeFileSync(path.join(outside, '2026-09-03-widget-cache.md'), '# outside plan\n');
    rmSync(path.join(root, 'docs', 'superpowers', 'plans'), { recursive: true, force: true });
    symlinkSync(outside, path.join(root, 'docs', 'superpowers', 'plans'));

    const found = discoverSpec({ repoRoot: root, branch: 'feat/widget-cache' });

    expect(found).toEqual({ kind: 'escaped', path: 'docs/superpowers/plans/2026-09-03-widget-cache.md' });
  });

  it('still uses a specs directory linked to a place inside the repository', () => {
    const root = tempDir();
    mkdirSync(path.join(root, 'design'), { recursive: true });
    writeFileSync(path.join(root, 'design', '2026-09-03-widget-cache-design.md'), '# inside\n');
    mkdirSync(path.join(root, 'docs', 'superpowers'), { recursive: true });
    symlinkSync(path.join(root, 'design'), path.join(root, 'docs', 'superpowers', 'specs'));

    const found = discoverSpec({ repoRoot: root, branch: 'feat/widget-cache' });

    expect(found.kind).toBe('convention');
  });
});

// The token rule (design 2026-10-17-intent-spec-auto-selection, sections 3
// and 4). Each test names, in its comment, the mutation it exists to kill.

describe('tokens', () => {
  // U1. Kills: no case fold; not splitting on underscore or slash; splitting
  // on dot.
  it('folds ASCII case and splits on hyphen, underscore, slash and ASCII whitespace', () => {
    expect(tokens('Feat/Online/Widget_Cache')).toEqual(['feat', 'online', 'widget', 'cache']);
    expect(tokens('a--b//c')).toEqual(['a', 'b', 'c']);
    expect(tokens('widget cache\tnow')).toEqual(['widget', 'cache', 'now']);
  });

  it('keeps a dot inside a token', () => {
    expect(tokens('1.2.1-base')).toEqual(['1.2.1', 'base']);
  });

  it('yields no empty token for a leading, trailing or doubled delimiter', () => {
    expect(tokens('-widget-cache-')).toEqual(['widget', 'cache']);
    expect(tokens('__widget__')).toEqual(['widget']);
    expect(tokens('')).toEqual([]);
  });

  it('folds no character outside ASCII and splits on no Unicode whitespace', () => {
    // U+212A KELVIN SIGN lower-cases to an ASCII k under toLowerCase, and
    // U+00A0 is whitespace to \s; neither may do either here.
    expect(tokens('Key-rotation')).toEqual(['Key', 'rotation']);
    expect(tokens('widget cache')).toEqual(['widget cache']);
  });
});

describe('isSignificant', () => {
  // U2. Kills: MIN_TOKEN_LENGTH 2; dropping the letter requirement; dropping
  // the charset rule.
  it('rejects short tokens', () => {
    expect(MIN_TOKEN_LENGTH).toBe(3);
    for (const token of ['pr', 'ci', 'v2']) {
      expect([token, isSignificant(token)]).toEqual([token, false]);
    }
  });

  it('rejects stop words', () => {
    for (const token of ['fix', 'wip', 'and', 'design']) {
      expect([token, isSignificant(token)]).toEqual([token, false]);
    }
  });

  it('rejects a token with no letter', () => {
    for (const token of ['2026', '0.10.0']) {
      expect([token, isSignificant(token)]).toEqual([token, false]);
    }
  });

  it('rejects a token outside letters, digits and dots', () => {
    for (const token of ['`cache`', 'cache@', 'ca+he', 'Key', 'widget cache']) {
      expect([token, isSignificant(token)]).toEqual([token, false]);
    }
  });

  it('accepts a short domain word, a word, and words carrying digits or dots', () => {
    for (const token of ['api', 'cache', '1.2.1a', 'rev2']) {
      expect([token, isSignificant(token)]).toEqual([token, true]);
    }
  });
});

describe('STOP_WORDS', () => {
  // U3. Kills: an entry added or removed without editing this test, and so
  // without review. Two-letter words (pr, ci, ux, up) are NOT here and need
  // not be: the length rule already excludes them. Do not add them "for
  // safety"; the list is not the reason they never count.
  it('is exactly the closed list of the design', () => {
    expect([...STOP_WORDS]).toEqual([
      // Change-type words
      'feat', 'feature', 'fix', 'bugfix', 'hotfix', 'chore', 'docs',
      'refactor', 'test', 'tests', 'wip', 'release', 'build', 'perf',
      'style', 'revert', 'deps', 'bump',
      // Convention words
      'design', 'spec', 'specs', 'plan', 'draft', 'review', 'followup',
      'temp', 'tmp',
      // Function words
      'and', 'the', 'for', 'with', 'from', 'into', 'onto', 'per', 'via', 'not',
      'add', 'use', 'new', 'more', 'misc',
    ]);
  });
});

describe('candidacy on whole tokens', () => {
  // U4. Kills: restoring includes; any-shared-token; set containment;
  // deleting stop words from the sequence.
  it('accepts a slug that is a whole-token run of the stem', () => {
    expect(candidateRun('widget-cache', 'widget-cache-index')).toEqual({
      exact: false,
      shared: ['widget', 'cache'],
    });
  });

  it('accepts a stem that is a whole-token run of the slug', () => {
    expect(candidateRun('widget-cache-rev-two', 'cache')).toEqual({ exact: false, shared: ['cache'] });
  });

  it('rejects a match inside a word, which the substring rule accepted', () => {
    expect(candidateRun('widget-caches', 'widget-cache')).toBeNull();
  });

  it('rejects the same words in another order', () => {
    expect(candidateRun('cache-widget', 'widget-cache')).toBeNull();
  });

  it('rejects tokens that are all present but not one contiguous run', () => {
    expect(candidateRun('spec-selection', 'intent-spec-auto-selection')).toBeNull();
  });

  it('keeps a stop word in the sequence for the contiguity test', () => {
    expect(candidateRun('per-gate-timeout-stated-reason', 'per-gate-timeout-and-stated-reason')).toBeNull();
  });

  it('rejects an equal name made only of non-significant tokens', () => {
    // Open point 2: nothing auto-selects without a significant token.
    expect(candidateRun('pr', 'pr')).toBeNull();
  });
});

describe('the token rule only removes bindings, on the normalised strings', () => {
  // U5. The old rule, verbatim, for the comparison: a character substring
  // test in either direction.
  function oldStemMatches(stem: string, slug: string): boolean {
    if (stem === '' || slug === '') {
      return false;
    }
    return stem.includes(slug) || slug.includes(stem);
  }
  const norm = (text: string): string => tokens(text).join('-');

  // The five foldings of section 3.3, written independently of tokens():
  // ASCII case, underscore, slash and ASCII whitespace for a hyphen, and a
  // doubled, leading or trailing delimiter.
  function fiveFoldings(text: string): string {
    return text
      .replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32))
      .replace(/[_/ \t\n\r\f\v]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }
  function foldingKinds(text: string): string[] {
    const kinds: string[] = [];
    if (/[A-Z]/.test(text)) kinds.push('case');
    if (text.includes('_')) kinds.push('underscore');
    if (text.includes('/')) kinds.push('slash');
    if (/[ \t\n\r\f\v]/.test(text)) kinds.push('whitespace');
    const hyphened = text.replace(/[_/ \t\n\r\f\v]/g, '-');
    if (/--|^-|-$/.test(hyphened)) kinds.push('delimiter');
    return kinds;
  }

  const SLUGS = [
    'widget-cache', 'widget', 'cache', 'Widget-Cache', 'widget_cache', 'online/widget-cache',
    'widget--cache', '-widget-cache-', 'widget-', 'widget cache', 'widget-caches', 'cache-widget',
    'pr', 'fix-pr', 'ci', 'fix-docs-wip', 'feature-release', 'widget-cache-rev-two',
    'spec-selection', 'per-gate-timeout-stated-reason', '1.2.1-base-and-superpowers', '116-cache',
    'v2-widget', 'api', 'api-cli', 'osv-baseline', 'WIDGET_CACHE', 'Online/Widget_Cache',
    'feat/widget cache', 'widget cache', 'Key-rotation', 'key-rotation',
    'alpha-and-the-beta-gamma-omega', 'gamma-omega', 'widget-rev-notes', 'cache-tuning',
    '`x`-cache', 'release-notes', 'superpowers', '2026', 'big-widget',
  ];
  const STEMS = [
    'widget-cache', 'widget-cache-index', 'widget-cache-and-index', 'widget-cache-rev',
    'online-widget-cache', 'big-widget', 'widget cache', 'widget', 'cache', 'widgets',
    'caches-layer', 'prepare-release-notes', 'improve-parser', 'fix-pr-comment', 'pr', 'review-pr',
    'fix-docs-wip-cleanup', 'feature-release-notes', 'intent-spec-auto-selection',
    'per-gate-timeout-and-stated-reason', '1.2.1-base-and-superpowers', 'superpowers',
    'secret-scanner', '2026-9-03-widget-cache', 'key-rotation', 'Key-Rotation', 'alpha-and-the-beta',
    'beta-gamma-omega', 'gamma', 'gamma-omegas-delta-long', 'rev', 'api-cli', 'osv', 'Widget_Cache',
    'widget__cache', '-widget-cache', 'widget-cache-', 'widget\tcache', 'cache-widget', 'notes',
  ];

  it('runs over a corpus of about forty slugs and forty stems', () => {
    expect(SLUGS.length).toBeGreaterThanOrEqual(40);
    expect(STEMS.length).toBeGreaterThanOrEqual(40);
  });

  it('makes no candidate the substring rule rejects on the hyphen-joined tokens of both sides', () => {
    const violations: string[] = [];
    for (const slug of SLUGS) {
      for (const stem of STEMS) {
        if (candidateRun(slug, stem) !== null && !oldStemMatches(norm(stem), norm(slug))) {
          violations.push(`${slug} | ${stem}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('gains, on the raw strings, only pairs that differ from their normalised form by the five foldings', () => {
    const unexplained: string[] = [];
    const seen = new Set<string>();
    for (const slug of SLUGS) {
      for (const stem of STEMS) {
        if (candidateRun(slug, stem) === null || oldStemMatches(stem, slug)) {
          continue;
        }
        const kinds = [...foldingKinds(slug), ...foldingKinds(stem)];
        const explained =
          kinds.length > 0 && fiveFoldings(slug) === norm(slug) && fiveFoldings(stem) === norm(stem);
        if (!explained) {
          unexplained.push(`${slug} | ${stem}`);
        }
        for (const kind of kinds) {
          seen.add(kind);
        }
      }
    }
    expect(unexplained).toEqual([]);
    // The corpus exercises every one of the five, so the assertion above is
    // not vacuous for any of them.
    expect([...seen].sort()).toEqual(['case', 'delimiter', 'slash', 'underscore', 'whitespace']);
  });

  it('does not let a Kelvin sign fold into an ASCII k', () => {
    // Kills toLowerCase() in place of ASCII-only folding.
    expect(candidateRun(branchSlug('feat/Key-rotation'), 'key-rotation')).toBeNull();
    expect(selectByBranch(['2026-01-01-key-rotation.md'], 'feat/Key-rotation').kind).toBe('none');
  });

  it('does not let a no-break space act as a delimiter', () => {
    // Kills restoring \s in the delimiter class.
    const branch = 'feat/widget cache';
    expect(candidateRun(branchSlug(branch), 'widget-cache')).toBeNull();
    const selection = selectByBranch(['2026-01-01-widget-cache.md'], branch);
    expect(selection.kind).toBe('none');
  });
});

describe('selectByBranch: ranking', () => {
  // R1. Kills: grouping by filename instead of stem; restoring the
  // longer-stem key.
  it('lets an exact stem beat a candidate it ties on count and length', () => {
    // An exact candidate's run is the whole slug, so no other candidate can
    // carry MORE significant tokens; the case that exercises key 1 is a tie
    // on keys 2 and 3, which without it would be ambiguous.
    const selection = selectByBranch(['2026-01-01-widget-cache.md', '2026-01-02-widget-cache-index.md'], 'feat/widget-cache');
    expect(selection).toMatchObject({ kind: 'selected', name: '2026-01-01-widget-cache.md', strength: 'exact' });
  });

  it('lets a higher count beat a longer token', () => {
    const selection = selectByBranch(['2026-01-01-api-cli.md', '2026-01-02-superlongword.md'], 'feat/api-cli-superlongword');
    expect(selection).toMatchObject({
      kind: 'selected',
      name: '2026-01-01-api-cli.md',
      strength: 'strong',
      runnerUp: '2026-01-02-superlongword.md',
    });
  });

  it('treats two files with one stem and different dates as one group, the lexically greatest winning', () => {
    const selection = selectByBranch(
      ['2026-08-01-widget-cache.md', '2026-09-03-widget-cache.md'],
      'feat/widget-cache-tuning'
    );
    expect(selection).toMatchObject({ kind: 'selected', name: '2026-09-03-widget-cache.md', strength: 'strong' });
  });

  it('puts a plain .md after its -design.md twin, by lexical order', () => {
    const selection = selectByBranch(['2026-09-03-widget-design.md', '2026-09-03-widget.md'], 'feat/widget');
    expect(selection).toMatchObject({ kind: 'selected', name: '2026-09-03-widget.md' });
  });

  it('reports a malformed date as a different stem, and so an ambiguous pair', () => {
    const selection = selectByBranch(['2026-09-03-widget-cache.md', '2026-9-03-widget-cache.md'], 'fix/cache');
    expect(selection).toEqual({
      kind: 'none',
      why: 'ambiguous',
      tied: ['2026-09-03-widget-cache.md', '2026-9-03-widget-cache.md'],
      legacy: '2026-9-03-widget-cache.md',
    });
  });

  it('says ambiguous where the longer-stem key would have picked one', () => {
    const selection = selectByBranch(
      ['2026-01-01-widget-cache-and-index.md', '2026-01-02-widget-cache-rev.md'],
      'feat/widget-cache'
    );
    expect(selection).toMatchObject({
      kind: 'none',
      why: 'ambiguous',
      tied: ['2026-01-01-widget-cache-and-index.md', '2026-01-02-widget-cache-rev.md'],
    });
  });
});

describe('selectByBranch: adversarial shapes', () => {
  const DOGFOOD = [
    '2026-10-01-prepare-release-notes-design.md',
    '2026-10-02-improve-parser.md',
    '2026-10-03-fix-pr-comment.md',
    '2026-10-04-pr.md',
    '2026-10-05-review-pr.md',
  ];

  // A1. Kills: MIN_TOKEN_LENGTH below 3; letting an exact stem select
  // without a significant token; a wholesale return to the 0.10.0 rule. It
  // does NOT kill restoring includes in candidacy alone: the pr slug returns
  // no-usable-token before candidacy is reached. U4 (widget-caches) and the
  // A10 weak variant kill that one.
  it('selects nothing for the dogfood branch pr, and names what 0.10.0 chose', () => {
    for (const branch of ['pr', 'fix/pr']) {
      expect([branch, selectByBranch(DOGFOOD, branch)]).toEqual([
        branch,
        { kind: 'none', why: 'no-usable-token', tied: [], legacy: '2026-10-04-pr.md' },
      ]);
    }
  });

  it('selects nothing for pr through discoverSpec either, with the legacy answer carried', () => {
    const root = repoWith(DOGFOOD);
    expect(discoverSpec({ repoRoot: root, branch: 'fix/pr' })).toEqual({
      kind: 'none',
      selection: { why: 'no-usable-token', tied: [], legacy: '2026-10-04-pr.md' },
    });
  });

  // A2. Kills: removing any of fix, docs, wip, feature, release from the
  // list. One assertion per word, so each removal is its own red.
  it.each(['fix', 'docs', 'wip', 'feature', 'release'])('treats %s as a stop word that cannot choose a spec', (word) => {
    expect(isSignificant(word)).toBe(false);
    const names = ['2026-01-01-fix-docs-wip-cleanup.md', '2026-01-02-feature-release-notes.md'];
    const branch = ['fix', 'docs', 'wip'].includes(word) ? 'fix-docs-wip' : 'feature-release';
    expect(selectByBranch(names, branch)).toMatchObject({ kind: 'none', why: 'no-usable-token' });
  });

  // A3, unit half. Kills: choosing the longer stem; choosing the newest;
  // choosing the first lexically.
  it('names both of two equally matching specs and chooses neither', () => {
    const names = ['2026-01-01-widget-cache-rev.md', '2026-01-02-widget-cache-index.md'];
    expect(selectByBranch(names, 'feat/widget-cache')).toEqual({
      kind: 'none',
      why: 'ambiguous',
      tied: ['2026-01-01-widget-cache-rev.md', '2026-01-02-widget-cache-index.md'],
      legacy: '2026-01-02-widget-cache-index.md',
    });
  });

  it('answers ambiguous through discoverSpec, importing nothing', () => {
    const root = repoWith(['2026-01-01-widget-cache-rev.md', '2026-01-02-widget-cache-index.md']);
    expect(discoverSpec({ repoRoot: root, branch: 'feat/widget-cache' })).toMatchObject({
      kind: 'none',
      selection: { why: 'ambiguous' },
    });
  });

  // A4, unit half. Kills: no weak flag.
  it('labels a single shared token weak', () => {
    const selection = selectByBranch(['2026-01-01-widget-cache.md', '2026-01-02-cache.md'], 'fix/cache-tuning');
    expect(selection).toEqual({
      kind: 'selected',
      name: '2026-01-02-cache.md',
      strength: 'weak',
      weakBecause: ['single-token'],
      shared: ['cache'],
      runnerUp: null,
      runnerUpShared: [],
      legacy: null,
    });
  });

  // A5. Kills: reporting the win as strong; omitting the runner-up; treating
  // the length-only win as ambiguous.
  it('labels a win on token length alone weak, naming the runner-up', () => {
    const selection = selectByBranch(['2026-01-01-widget.md', '2026-01-02-rev.md'], 'feat/widget-rev-notes');
    expect(selection).toEqual({
      kind: 'selected',
      name: '2026-01-01-widget.md',
      strength: 'weak',
      weakBecause: ['single-token', 'length-tiebreak'],
      shared: ['widget'],
      runnerUp: '2026-01-02-rev.md',
      runnerUpShared: ['rev'],
      legacy: null,
    });
  });

  // A10, unit half. Kills: computing legacy but letting it decide the winner.
  it('chooses on count where 0.10.0 chose the longer stem, and says what 0.10.0 chose', () => {
    const selection = selectByBranch(
      ['2026-01-01-alpha-and-the-beta.md', '2026-01-02-beta-gamma-omega.md'],
      'feat/alpha-and-the-beta-gamma-omega'
    );
    expect(selection).toEqual({
      kind: 'selected',
      name: '2026-01-02-beta-gamma-omega.md',
      strength: 'strong',
      weakBecause: [],
      shared: ['beta', 'gamma', 'omega'],
      runnerUp: '2026-01-01-alpha-and-the-beta.md',
      runnerUpShared: ['alpha', 'beta'],
      legacy: '2026-01-01-alpha-and-the-beta.md',
    });
  });

  it('chooses a weak whole-word match where 0.10.0 chose a partial-word one', () => {
    const selection = selectByBranch(['2026-01-01-gamma.md', '2026-01-02-gamma-omegas-delta-long.md'], 'feat/gamma-omega');
    expect(selection).toMatchObject({
      kind: 'selected',
      name: '2026-01-01-gamma.md',
      strength: 'weak',
      weakBecause: ['single-token'],
      legacy: '2026-01-02-gamma-omegas-delta-long.md',
    });
  });

  // O2, unit half. Kills: printing raw slug tokens as shared (measured red).
  // It does NOT kill dropping the charset rule: the backtick token is never
  // in the shared run here. U2's charset test kills that one.
  it('reports only charset-restricted words as shared, whatever the branch carries', () => {
    const selection = selectByBranch(['2026-01-01-cache.md'], 'feat/`x`-cache');
    expect(selection).toMatchObject({ kind: 'selected', shared: ['cache'] });
  });

  it('says no-candidate for a usable slug nothing matches', () => {
    expect(selectByBranch(['2026-01-01-secret-scanner.md'], 'feat/widget-cache')).toEqual({
      kind: 'none',
      why: 'no-candidate',
      tied: [],
      legacy: null,
    });
  });
});

describe('the real-artifact baseline', () => {
  // E1. The section 8.1 table, measured against the four public guard
  // repositories and committed, replayed here so a later rule change shows
  // its diff against real names rather than only against fixtures written
  // for it.
  interface Baseline {
    repositories: Array<{ repo: string; specs: string[]; hitLimit: boolean; limit: number; branchesListed: number }>;
    pairs: Array<{
      repo: string;
      branch: string;
      old: string | null;
      new: { kind: 'selected'; name: string; strength: string } | { kind: 'none'; why: string; tied: string[] };
    }>;
  }
  const baseline = JSON.parse(
    readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'intent-spec-selection-baseline.json'),
      'utf8'
    )
  ) as Baseline;

  it('covers every merged branch name, never a prefix of the history', () => {
    expect(baseline.repositories.map((entry) => entry.repo).sort()).toEqual([
      'vaultcompasshq/conductor',
      'vaultcompasshq/dep-guard',
      'vaultcompasshq/intent-guard',
      'vaultcompasshq/vault-guard',
    ]);
    for (const entry of baseline.repositories) {
      expect([entry.repo, entry.hitLimit, entry.branchesListed < entry.limit]).toEqual([entry.repo, false, true]);
    }
  });

  it('replays every committed pair to its committed outcome under both rules', () => {
    const specsOf = new Map(baseline.repositories.map((entry) => [entry.repo, entry.specs]));
    const replayed = baseline.pairs.map((pair) => {
      const selection = selectByBranch(specsOf.get(pair.repo) ?? [], pair.branch);
      return {
        repo: pair.repo,
        branch: pair.branch,
        old: selection.kind === 'selected' ? (selection.legacy ?? selection.name) : selection.legacy,
        new:
          selection.kind === 'selected'
            ? { kind: 'selected', name: selection.name, strength: selection.strength }
            : { kind: 'none', why: selection.why, tied: selection.tied },
      };
    });
    expect(replayed).toEqual(baseline.pairs);
  });
});

describe('one selector', () => {
  // O4. Kills: a second selection rule growing back in one path.
  const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

  it('leaves no stemMatches or bestMatch in src, and calls selectByBranch from the two selection paths', () => {
    const sources = readdirSync(SRC)
      .filter((name) => name.endsWith('.ts'))
      .map((name) => ({ name, text: readFileSync(path.join(SRC, name), 'utf8') }));
    for (const { name, text } of sources) {
      expect([name, /\bstemMatches\b|\bbestMatch\b/.test(text)]).toEqual([name, false]);
    }
    const calls = sources.flatMap(({ name, text }) =>
      [...text.matchAll(/(?<!function )\bselectByBranch\(/g)].map(() => name)
    );
    // discoverSpec on the working tree (which the trust-base head-proposal
    // line reuses) and discoverSpecAtRef at the trust base.
    expect(calls.sort()).toEqual(['intent-prepare.ts', 'intent-spec.ts']);
  });
});
