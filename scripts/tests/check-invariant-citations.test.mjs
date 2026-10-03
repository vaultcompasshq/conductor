import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  citationFindings,
  citationSources,
  countLines,
  lineCountsUnder,
  testDeclarations,
} from '../check-invariant-citations.mjs';

const DOC = 'docs/INVARIANTS.md';

describe('countLines', () => {
  it('does not count the empty string after a trailing newline as a line', () => {
    expect(countLines('a\nb\n')).toBe(2);
  });

  it('counts a last line with no trailing newline', () => {
    expect(countLines('a\nb')).toBe(2);
  });

  it('counts an empty file as zero lines', () => {
    expect(countLines('')).toBe(0);
  });

  it('is what a citation one past the end of a real file is judged against', () => {
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
    const counts = lineCountsUnder(path.join(root, 'src'));
    const cliLines = counts.get('src/cli.ts');
    expect(cliLines).toBe(countLines(readFileSync(path.join(root, 'src/cli.ts'), 'utf8')));
    const onePast = `src/cli.ts:${cliLines + 1}\n`;
    expect(citationFindings(onePast, (file) => counts.get(file))).toEqual([
      `${DOC}:1: src/cli.ts:${cliLines + 1} exceeds src/cli.ts (${cliLines} lines)`,
    ]);
  });
});

describe('citationFindings', () => {
  it('reports a range whose end is past the file', () => {
    const text = 'See src/init.ts:10-12 for the hook.\n';
    const findings = citationFindings(text, () => 11);
    expect(findings).toEqual([
      `${DOC}:1: src/init.ts:10-12 exceeds src/init.ts (11 lines)`,
    ]);
  });

  it('reports a single line past the file', () => {
    const text = 'The return is src/init.ts:40.\n';
    const findings = citationFindings(text, () => 39);
    expect(findings).toEqual([
      `${DOC}:1: src/init.ts:40 exceeds src/init.ts (39 lines)`,
    ]);
  });

  it('accepts a range that ends on the last line', () => {
    const text = 'Whole file: src/cli.ts:1-4.\n';
    expect(citationFindings(text, () => 4)).toEqual([]);
  });

  it('reports a citation whose file is not under src', () => {
    const text = 'Moved: src/gone.ts:1-2.\n';
    const findings = citationFindings(text, () => undefined);
    expect(findings).toEqual([
      `${DOC}:1: src/gone.ts:1-2 cites src/gone.ts, which is not a source file`,
    ]);
  });

  it('reports a tests citation past the end of the file', () => {
    const text = 'Pinned by tests/init.test.ts:9000.\n';
    const findings = citationFindings(text, () => 10);
    expect(findings).toEqual([
      `${DOC}:1: tests/init.test.ts:9000 exceeds tests/init.test.ts (10 lines)`,
    ]);
  });

  it('reports a scripts citation past the end of the file', () => {
    const text = 'See scripts/check-public-hygiene.mjs:3.\n';
    const findings = citationFindings(text, () => 2);
    expect(findings).toEqual([
      `${DOC}:1: scripts/check-public-hygiene.mjs:3 exceeds scripts/check-public-hygiene.mjs (2 lines)`,
    ]);
  });

  it('reports an action.yml citation past the end of the file', () => {
    const text = 'See action.yml:40-50.\n';
    const findings = citationFindings(text, (file) => (file === 'action.yml' ? 20 : undefined));
    expect(findings).toEqual([
      `${DOC}:1: action.yml:40-50 exceeds action.yml (20 lines)`,
    ]);
  });

  it('accepts in-range citations of tests, scripts and action.yml', () => {
    const text = 'See tests/cli.test.ts:2, scripts/pr-comment.mjs:1-2 and action.yml:4.\n';
    expect(citationFindings(text, () => 4)).toEqual([]);
  });

  it('ignores a path this check does not read', () => {
    const text = 'See README.md:31-33.\n';
    expect(citationFindings(text, () => 1)).toEqual([]);
  });

  it('reports a quoted test name that is not in the cited file', () => {
    const text = 'Pinned by "no such test" in tests/run.test.ts.\n';
    const findings = citationFindings(text, () => 10, DOC, () => [
      { name: 'does not throw', start: 1, end: 4 },
    ]);
    expect(findings).toEqual([
      `${DOC}:1: tests/run.test.ts has no test named "no such test"`,
    ]);
  });

  it('accepts a quoted test name wrapped onto the next line', () => {
    const text = 'Pinned by "does not\nthrow" in tests/run.test.ts.\n';
    expect(
      citationFindings(text, () => 10, DOC, () => [
        { name: 'does not throw', start: 1, end: 4 },
      ])
    ).toEqual([]);
  });

  it('reports a parenthetical test name that is not the exact title', () => {
    const text = 'Pinned by tests/run.test.ts:2 ("does not").\n';
    const findings = citationFindings(text, () => 10, DOC, () => [
      { name: 'does not throw', start: 1, end: 4 },
    ]);
    expect(findings).toEqual([
      `${DOC}:1: tests/run.test.ts has no test named "does not"`,
    ]);
  });

  it('reports a line that falls outside the named test', () => {
    const text = 'Pinned by tests/run.test.ts:9 ("does not throw").\n';
    const findings = citationFindings(text, () => 20, DOC, () => [
      { name: 'does not throw', start: 2, end: 5 },
    ]);
    expect(findings).toEqual([
      `${DOC}:1: tests/run.test.ts:9 ("does not throw") is outside that test (lines 2-5)`,
    ]);
  });

  it('accepts a line inside the named test', () => {
    const text = 'Pinned by tests/run.test.ts:3 ("does not throw").\n';
    expect(
      citationFindings(text, () => 20, DOC, () => [
        { name: 'does not throw', start: 2, end: 5 },
      ])
    ).toEqual([]);
  });

  it('checks every quoted title in a list, not only the last', () => {
    const text =
      'Pinned by "missing one", "missing two" and "present" in tests/run.test.ts.\n';
    const findings = citationFindings(text, () => 10, DOC, () => [
      { name: 'present', start: 1, end: 4 },
    ]);
    expect(findings).toEqual([
      `${DOC}:1: tests/run.test.ts has no test named "missing one"`,
      `${DOC}:1: tests/run.test.ts has no test named "missing two"`,
    ]);
  });

  it('checks a follow-on line against the same file', () => {
    const text = 'Pinned by tests/exit-codes.test.ts:2, 58, 66 and 75.\n';
    const findings = citationFindings(text, () => 10);
    expect(findings).toEqual([
      `${DOC}:1: tests/exit-codes.test.ts:58 exceeds tests/exit-codes.test.ts (10 lines)`,
      `${DOC}:1: tests/exit-codes.test.ts:66 exceeds tests/exit-codes.test.ts (10 lines)`,
      `${DOC}:1: tests/exit-codes.test.ts:75 exceeds tests/exit-codes.test.ts (10 lines)`,
    ]);
  });

  it('checks a follow-on range after a short phrase against the same file', () => {
    const text = 'See src/output-sarif.ts:1-2 for the level, and 50-60 for the run.\n';
    const findings = citationFindings(text, () => 10);
    expect(findings).toEqual([
      `${DOC}:1: src/output-sarif.ts:50-60 exceeds src/output-sarif.ts (10 lines)`,
    ]);
  });

  it('rejects a title that matches only an it.skip', () => {
    const src = "  it.skip('hidden', () => {});\n  it('shown', () => {});\n";
    const text = 'Pinned by "hidden" in tests/run.test.ts.\n';
    expect(citationFindings(text, () => 10, DOC, () => testDeclarations(src))).toEqual([
      `${DOC}:1: tests/run.test.ts has no runnable test named "hidden"`,
    ]);
  });

  it('rejects a title that matches only a test inside describe.skip', () => {
    const src = [
      "describe.skip('suite', () => {",
      "  it('hidden', () => {});",
      '});',
      "it('shown', () => {});",
      '',
    ].join('\n');
    const text = 'Pinned by "hidden" in tests/run.test.ts.\n';
    expect(citationFindings(text, () => 10, DOC, () => testDeclarations(src))).toEqual([
      `${DOC}:1: tests/run.test.ts has no runnable test named "hidden"`,
    ]);
  });

  it('rejects a title whose only it( is inside a block comment', () => {
    const src = ['/*', "  it('hidden', () => {});", '*/', ''].join('\n');
    const text = 'Pinned by "hidden" in tests/run.test.ts.\n';
    expect(citationFindings(text, () => 10, DOC, () => testDeclarations(src))).toEqual([
      `${DOC}:1: tests/run.test.ts has no test named "hidden"`,
    ]);
  });

  it('rejects a title whose only it( is inside a template literal', () => {
    const src = ['const example = `', "  it('hidden', () => {});", '`;', ''].join('\n');
    const text = 'Pinned by "hidden" in tests/run.test.ts.\n';
    expect(citationFindings(text, () => 10, DOC, () => testDeclarations(src))).toEqual([
      `${DOC}:1: tests/run.test.ts has no test named "hidden"`,
    ]);
  });

  it('rejects line 0', () => {
    const text = 'See src/init.ts:0.\n';
    expect(citationFindings(text, () => 10)).toEqual([
      `${DOC}:1: src/init.ts:0 cites a line before 1`,
    ]);
  });

  it('rejects a quoted test title that has no "in"', () => {
    const text = 'Pinned by "does not throw" tests/run.test.ts.\n';
    expect(citationFindings(text, () => 10, DOC, () => [
      { name: 'does not throw', start: 1, end: 4 },
    ])).toEqual([
      `${DOC}:1: "does not throw" tests/run.test.ts cites a test title with no "in"`,
    ]);
  });

  it('rejects a single-quoted test title', () => {
    const text = "Pinned by 'does not throw' in tests/run.test.ts.\n";
    expect(citationFindings(text, () => 10, DOC, () => [
      { name: 'does not throw', start: 1, end: 4 },
    ])).toEqual([
      `${DOC}:1: tests/run.test.ts is cited with a '-quoted title, which this check does not read`,
    ]);
  });

  it('rejects a backtick-quoted test title', () => {
    const text = 'Pinned by `does not throw` in tests/run.test.ts.\n';
    expect(citationFindings(text, () => 10, DOC, () => [
      { name: 'does not throw', start: 1, end: 4 },
    ])).toEqual([
      `${DOC}:1: tests/run.test.ts is cited with a backtick-quoted title, which this check does not read`,
    ]);
  });

  it('rejects a ./ prefixed path', () => {
    const text = 'See ./src/cli.ts:1.\n';
    expect(citationFindings(text, () => 10)).toEqual([
      `${DOC}:1: ./src/cli.ts:1 is a citation form this check does not read`,
    ]);
  });
});

describe('testDeclarations', () => {
  it('reads an it title and ends the test at the next one', () => {
    const src = ["  it('one', () => {", '  });', "  it('two', () => {});"].join('\n');
    expect(testDeclarations(src)).toEqual([
      { name: 'one', start: 1, end: 2 },
      { name: 'two', start: 3, end: 3 },
    ]);
  });

  it('reads an it.each title from the following line', () => {
    const src = ['  it.each(CASES)(', "    'refuses on a bare clone',", '    () => {}', '  );'].join('\n');
    expect(testDeclarations(src)).toEqual([
      { name: 'refuses on a bare clone', start: 1, end: 4 },
    ]);
  });

  it('reads an it.each title when the cases are an inline array', () => {
    const src = [
      '  it.each([',
      "    ['dep-guard', 'hook'],",
      "  ])('stops on a %s hook', () => {});",
    ].join('\n');
    expect(testDeclarations(src)).toEqual([
      { name: 'stops on a %s hook', start: 1, end: 3 },
    ]);
  });

  it('reads an it.each title when a case contains a regular expression', () => {
    const src = [
      '  it.each([',
      '    [/lefthook-local\\.yml/],',
      "  ])('refuses to write over %s own generated hook', () => {});",
    ].join('\n');
    expect(testDeclarations(src)).toEqual([
      { name: 'refuses to write over %s own generated hook', start: 1, end: 3 },
    ]);
  });
});

describe('docs/INVARIANTS.md', () => {
  it('cites no range past the end of its file and no missing test name', () => {
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
    const text = readFileSync(path.join(root, DOC), 'utf8');
    const sources = citationSources(root);
    expect(citationFindings(text, sources.lineCount, DOC, sources.testsIn)).toEqual([]);
  });
});
