#!/usr/bin/env node
// Fails when docs/INVARIANTS.md cites a src/*.ts line range past the end of
// that file. A citation is re-derived by the function it describes; this
// check only catches the drift that is visible without reading the claim,
// which is a range the file no longer has.
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOC = 'docs/INVARIANTS.md';
const CITE = /src\/[A-Za-z0-9._/-]+\.ts:\d+(?:-\d+)?/g;

// The number of lines an editor shows for the text: a trailing newline ends
// the last line rather than starting an empty one, so "a\nb\n" is two lines,
// not three. Splitting on "\n" alone counts that phantom line and lets a
// citation one past the end of the file through.
export function countLines(text) {
  if (text.length === 0) {
    return 0;
  }
  const parts = text.split('\n');
  return text.endsWith('\n') ? parts.length - 1 : parts.length;
}

export function lineCountsUnder(dir) {
  const counts = new Map();

  function walk(current) {
    for (const name of readdirSync(current)) {
      const abs = path.join(current, name);
      if (statSync(abs).isDirectory()) {
        walk(abs);
      } else if (name.endsWith('.ts')) {
        const rel = path.relative(ROOT, abs).split(path.sep).join('/');
        counts.set(rel, countLines(readFileSync(abs, 'utf8')));
      }
    }
  }

  walk(dir);
  return counts;
}

export function citationFindings(text, lineCount, docPath = DOC) {
  const findings = [];
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    for (const match of lines[i].matchAll(CITE)) {
      const cite = match[0];
      const colon = cite.lastIndexOf(':');
      const file = cite.slice(0, colon);
      const range = cite.slice(colon + 1);
      const [startText, endText] = range.split('-');
      const start = Number(startText);
      const end = endText === undefined ? start : Number(endText);
      const length = lineCount(file);

      if (length === undefined) {
        findings.push(`${docPath}:${i + 1}: ${cite} cites ${file}, which is not a source file`);
      } else if (start > length || end > length) {
        findings.push(`${docPath}:${i + 1}: ${cite} exceeds ${file} (${length} lines)`);
      }
    }
  }

  return findings;
}

function main() {
  const text = readFileSync(path.join(ROOT, DOC), 'utf8');
  const counts = lineCountsUnder(path.join(ROOT, 'src'));
  const findings = citationFindings(text, (file) => counts.get(file));

  if (findings.length > 0) {
    for (const finding of findings) {
      console.error(`x ${finding}`);
    }
    console.error(
      '\ncheck-invariant-citations: a cited range runs past the end of its file. Re-derive it from the function the sentence describes.'
    );
    process.exit(1);
  }

  console.log('check-invariant-citations: every src citation in docs/INVARIANTS.md is inside its file.');
}

function isMainModule() {
  if (process.argv[1] === undefined) {
    return false;
  }
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  main();
}
