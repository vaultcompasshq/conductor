import { afterEach, describe, expect, it } from '@jest/globals';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  branchSlug,
  discoverSpec,
  normalizeStem,
  prBodyFromEvent,
  specFromPrBody,
  stemMatches,
} from '../src/intent-spec.js';

const temps: string[] = [];

afterEach(() => {
  while (temps.length > 0) {
    rmSync(temps.pop() as string, { recursive: true, force: true });
  }
});

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

describe('stemMatches', () => {
  it('matches when the stem contains the slug', () => {
    expect(stemMatches('widget-cache-and-index', 'widget-cache')).toBe(true);
  });

  it('matches when the slug contains the stem', () => {
    expect(stemMatches('widget-cache', 'widget-cache-rev2')).toBe(true);
  });

  it('does not match unrelated names', () => {
    expect(stemMatches('widget-cache', 'secret-scanner')).toBe(false);
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
    });
  });

  it('pairs the plan matched by the same stem rule', () => {
    const root = repoWith(['2026-09-03-widget-cache-design.md'], ['2026-09-03-widget-cache.md']);

    const found = discoverSpec({ repoRoot: root, branch: 'feat/widget-cache' });

    expect(found).toEqual({
      kind: 'convention',
      spec: 'docs/superpowers/specs/2026-09-03-widget-cache-design.md',
      plan: 'docs/superpowers/plans/2026-09-03-widget-cache.md',
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
      ).toEqual({ kind: 'none' });
    });

    it('refuses an absolute path out of the tree the same way', () => {
      const { root, outside } = rootWithOutsideFile([]);

      expect(
        discoverSpec({ repoRoot: root, branch: 'feat/widget-cache', prBody: `Spec: ${outside}\n` })
      ).toEqual({ kind: 'none' });
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

    expect(discoverSpec({ repoRoot: root, branch: 'feat/widget-cache' })).toEqual({ kind: 'none' });
  });

  it('finds nothing when the spec directory does not exist at all', () => {
    expect(discoverSpec({ repoRoot: tempDir(), branch: 'feat/widget-cache' })).toEqual({
      kind: 'none',
    });
  });

  it('ignores a spec nested in a subdirectory, which is not the convention', () => {
    const root = repoWith([]);
    const nested = path.join(root, 'docs', 'superpowers', 'specs', 'archive');
    mkdirSync(nested, { recursive: true });
    writeFileSync(path.join(nested, '2026-09-03-widget-cache-design.md'), '# spec\n');

    expect(discoverSpec({ repoRoot: root, branch: 'feat/widget-cache' })).toEqual({ kind: 'none' });
  });

  it('ignores a file under the spec directory that is not markdown', () => {
    const root = repoWith(['2026-09-03-widget-cache-design.txt']);

    expect(discoverSpec({ repoRoot: root, branch: 'feat/widget-cache' })).toEqual({ kind: 'none' });
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
