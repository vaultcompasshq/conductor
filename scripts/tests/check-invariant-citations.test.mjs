import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { citationFindings, countLines, lineCountsUnder } from '../check-invariant-citations.mjs';

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

  it('ignores citations that are not src TypeScript', () => {
    const text = 'Pinned by tests/init.test.ts:9000 and README.md:31-33.\n';
    expect(citationFindings(text, () => 1)).toEqual([]);
  });
});

describe('docs/INVARIANTS.md against src', () => {
  it('cites no src range past the end of its file', () => {
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
    const text = readFileSync(path.join(root, DOC), 'utf8');
    const counts = lineCountsUnder(path.join(root, 'src'));
    expect(citationFindings(text, (file) => counts.get(file))).toEqual([]);
  });
});
