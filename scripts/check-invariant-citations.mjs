#!/usr/bin/env node
// Fails when docs/INVARIANTS.md cites a line range past the end of a file
// under src/, tests/ or scripts/, or past the end of action.yml. A test
// cited by title must be that exact title in the cited file, and a line
// cited with the title must fall inside that test. A citation is re-derived
// by the function or test it describes; this check only catches the drift
// that is visible without reading the claim.
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOC = 'docs/INVARIANTS.md';
const CITE =
  /(?<![\w./-])((?:src|tests)\/[A-Za-z0-9._/-]+\.ts|scripts\/[A-Za-z0-9._/-]+\.mjs|action\.yml):(\d+)(?:-(\d+))?/g;
const TEST_FILE = /^(?:tests|scripts)\/[A-Za-z0-9._/-]+\.test\.(?:ts|mjs)$/;
const NAME_IN_FILE = / in ((?:tests|scripts)\/[A-Za-z0-9._/-]+\.test\.(?:ts|mjs))/g;

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

export function lineCountsUnder(dir, extensions = ['.ts']) {
  const counts = new Map();

  function walk(current) {
    for (const name of readdirSync(current)) {
      const abs = path.join(current, name);
      if (statSync(abs).isDirectory()) {
        walk(abs);
      } else if (extensions.some((ext) => name.endsWith(ext))) {
        const rel = path.relative(ROOT, abs).split(path.sep).join('/');
        counts.set(rel, countLines(readFileSync(abs, 'utf8')));
      }
    }
  }

  walk(dir);
  return counts;
}

function lineNumberAt(text, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === '\n') {
      line++;
    }
  }
  return line;
}

function normalizeCitedName(raw) {
  return raw.replace(/[ \t]*\n[ \t]*/g, ' ').trim();
}

function skipString(text, i) {
  const quote = text[i];
  i++;
  if (quote === '`') {
    while (i < text.length) {
      if (text[i] === '\\') {
        i += 2;
        continue;
      }
      if (text[i] === '$' && text[i + 1] === '{') {
        i = skipBraces(text, i + 1);
        continue;
      }
      if (text[i] === '`') {
        return i + 1;
      }
      i++;
    }
    return i;
  }
  while (i < text.length) {
    if (text[i] === '\\') {
      i += 2;
      continue;
    }
    if (text[i] === quote || text[i] === '\n') {
      return i + (text[i] === quote ? 1 : 0);
    }
    i++;
  }
  return i;
}

function skipBraces(text, open) {
  let depth = 0;
  let i = open;
  while (i < text.length) {
    const c = text[i];
    if (c === "'" || c === '"' || c === '`') {
      i = skipString(text, i);
      continue;
    }
    if (c === '{') {
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0) {
        return i + 1;
      }
    }
    i++;
  }
  return i;
}

function skipRegex(text, i) {
  i++;
  while (i < text.length && text[i] !== '\n') {
    if (text[i] === '\\') {
      i += 2;
      continue;
    }
    if (text[i] === '[') {
      i++;
      while (i < text.length && text[i] !== ']' && text[i] !== '\n') {
        if (text[i] === '\\') {
          i += 2;
        } else {
          i++;
        }
      }
      continue;
    }
    if (text[i] === '/') {
      return i + 1;
    }
    i++;
  }
  return i;
}

function regexLikely(text, slash) {
  let j = slash - 1;
  while (j >= 0 && /\s/.test(text[j])) {
    j--;
  }
  if (j < 0) {
    return true;
  }
  return '([ {,;=!&|?:~^'.includes(text[j]);
}

function skipBalanced(text, openParen) {
  let depth = 0;
  let i = openParen;
  while (i < text.length) {
    const c = text[i];
    if (c === "'" || c === '"' || c === '`') {
      i = skipString(text, i);
      continue;
    }
    if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') {
        i++;
      }
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        i++;
      }
      i += 2;
      continue;
    }
    if (c === '/' && regexLikely(text, i)) {
      i = skipRegex(text, i);
      continue;
    }
    if (c === '(') {
      depth++;
    } else if (c === ')') {
      depth--;
      if (depth === 0) {
        return i + 1;
      }
    }
    i++;
  }
  return i;
}

function readTitle(text, paren) {
  let i = paren + 1;
  while (i < text.length && /[ \t\n\r]/.test(text[i])) {
    i++;
  }
  const quote = text[i];
  if (quote !== "'" && quote !== '"') {
    return null;
  }
  i++;
  let out = '';
  while (i < text.length && text[i] !== quote && text[i] !== '\n') {
    if (text[i] === '\\') {
      const next = text[i + 1] ?? '';
      out += next === 'n' ? '\n' : next === 't' ? '\t' : next;
      i += 2;
      continue;
    }
    out += text[i];
    i++;
  }
  if (text[i] !== quote) {
    return null;
  }
  return out;
}

export function testDeclarations(source) {
  const total = countLines(source);
  const lineStarts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') {
      lineStarts.push(i + 1);
    }
  }

  function lineText(lineIdx) {
    const from = lineStarts[lineIdx];
    const to = lineStarts[lineIdx + 1] ?? source.length;
    return source.slice(from, to).replace(/\n$/, '');
  }

  const boundaries = [];
  const boundaryRe = /^(\s*)(?:it|test|describe)(?:\.(?:each|only|skip))?\s*\(/;
  for (let lineIdx = 0; lineIdx < total; lineIdx++) {
    const line = lineText(lineIdx);
    if (/^\s*\/\//.test(line) || /^\s*\*/.test(line)) {
      continue;
    }
    const mark = line.match(boundaryRe);
    if (mark) {
      boundaries.push({ line: lineIdx + 1, indent: mark[1].length });
    }
  }

  const startRe = /^(\s*)(?:it|test)(?:\.(each|only|skip))?\s*\(/;
  const decls = [];
  for (let lineIdx = 0; lineIdx < total; lineIdx++) {
    const line = lineText(lineIdx);
    if (/^\s*\/\//.test(line) || /^\s*\*/.test(line)) {
      continue;
    }
    const mark = line.match(startRe);
    if (!mark) {
      continue;
    }
    const indent = mark[1].length;
    const openParen = lineStarts[lineIdx] + mark[0].length - 1;
    let titleParen = openParen;
    if (mark[2] === 'each') {
      const after = skipBalanced(source, openParen);
      let j = after;
      while (j < source.length && /\s/.test(source[j])) {
        j++;
      }
      if (source[j] !== '(') {
        continue;
      }
      titleParen = j;
    }
    const name = readTitle(source, titleParen);
    if (name === null) {
      continue;
    }
    const start = lineIdx + 1;
    const next = boundaries.find((b) => b.line > start && b.indent <= indent);
    decls.push({ name, start, end: next ? next.line - 1 : total });
  }
  return decls;
}

function quotedNameBefore(text, index) {
  let q = index - 1;
  while (q >= 0 && /\s/.test(text[q])) {
    q--;
  }
  if (text[q] !== '"') {
    return null;
  }
  const close = q;
  let i = close - 1;
  while (i >= 0 && text[i] !== '"') {
    if (text[i] === '\n' && text[i - 1] === '\n') {
      return null;
    }
    if (close - i > 600) {
      return null;
    }
    i--;
  }
  if (text[i] !== '"') {
    return null;
  }
  return normalizeCitedName(text.slice(i + 1, close));
}

function parentheticalName(text, from) {
  let i = from;
  while (i < text.length && /[ \t]/.test(text[i])) {
    i++;
  }
  if (text[i] === '\n') {
    i++;
    while (i < text.length && /[ \t]/.test(text[i])) {
      i++;
    }
  }
  if (!text.startsWith('("', i)) {
    return null;
  }
  const end = text.indexOf('")', i + 2);
  if (end === -1 || end - i > 600) {
    return null;
  }
  return normalizeCitedName(text.slice(i + 2, end));
}

function nameFindings(docPath, line, file, name, cite, decls, start, end) {
  const matches = (decls ?? []).filter((decl) => decl.name === name);
  if (matches.length === 0) {
    return [`${docPath}:${line}: ${file} has no test named "${name}"`];
  }
  if (start === undefined) {
    return [];
  }
  const hit = matches.find((decl) => start >= decl.start && end <= decl.end);
  if (hit) {
    return [];
  }
  const decl = matches[0];
  const where = cite ?? file;
  return [
    `${docPath}:${line}: ${where} ("${name}") is outside that test (lines ${decl.start}-${decl.end})`,
  ];
}

export function citationFindings(text, lineCount, docPath = DOC, testsIn = () => undefined) {
  const findings = [];

  for (const match of text.matchAll(CITE)) {
    const file = match[1];
    const start = Number(match[2]);
    const end = match[3] === undefined ? start : Number(match[3]);
    const cite = match[0];
    const line = lineNumberAt(text, match.index);
    const length = lineCount(file);

    if (length === undefined) {
      findings.push(`${docPath}:${line}: ${cite} cites ${file}, which is not a source file`);
    } else if (start > length || end > length || end < start) {
      findings.push(`${docPath}:${line}: ${cite} exceeds ${file} (${length} lines)`);
    }

    if (TEST_FILE.test(file)) {
      const name = parentheticalName(text, match.index + match[0].length);
      if (name !== null) {
        findings.push(...nameFindings(docPath, line, file, name, cite, testsIn(file), start, end));
      }
    }
  }

  for (const match of text.matchAll(NAME_IN_FILE)) {
    const file = match[1];
    const name = quotedNameBefore(text, match.index);
    if (name === null) {
      continue;
    }
    const line = lineNumberAt(text, match.index);
    findings.push(...nameFindings(docPath, line, file, name, null, testsIn(file)));
  }

  return findings;
}

export function citationSources(root = ROOT) {
  const counts = new Map([
    ...lineCountsUnder(path.join(root, 'src')),
    ...lineCountsUnder(path.join(root, 'tests')),
    ...lineCountsUnder(path.join(root, 'scripts'), ['.mjs']),
  ]);
  counts.set('action.yml', countLines(readFileSync(path.join(root, 'action.yml'), 'utf8')));
  const tests = new Map([
    ...indexTests(path.join(root, 'tests'), ['.ts']),
    ...indexTests(path.join(root, 'scripts'), ['.mjs']),
  ]);
  return {
    lineCount: (file) => counts.get(file),
    testsIn: (file) => tests.get(file),
  };
}

function indexTests(dir, extensions) {
  const tests = new Map();

  function walk(current) {
    for (const name of readdirSync(current)) {
      const abs = path.join(current, name);
      if (statSync(abs).isDirectory()) {
        walk(abs);
      } else if (name.endsWith('.test.ts') || name.endsWith('.test.mjs')) {
        if (!extensions.some((ext) => name.endsWith(ext))) {
          continue;
        }
        const rel = path.relative(ROOT, abs).split(path.sep).join('/');
        tests.set(rel, testDeclarations(readFileSync(abs, 'utf8')));
      }
    }
  }

  walk(dir);
  return tests;
}

function main() {
  const text = readFileSync(path.join(ROOT, DOC), 'utf8');
  const sources = citationSources();
  const findings = citationFindings(text, sources.lineCount, DOC, sources.testsIn);

  if (findings.length > 0) {
    for (const finding of findings) {
      console.error(`x ${finding}`);
    }
    console.error(
      '\ncheck-invariant-citations: a cited range runs past the end of its file, or a cited test name is not a test in that file. Re-derive it from the function or test the sentence describes.'
    );
    process.exit(1);
  }

  console.log(
    'check-invariant-citations: every citation in docs/INVARIANTS.md is inside its file, and every cited test name is a test in that file.'
  );
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
