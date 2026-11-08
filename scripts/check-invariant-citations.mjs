#!/usr/bin/env node
// Checks three things about docs/INVARIANTS.md: every cited symbol
// (FILE#name) is a top-level declaration in that file, or for action.yml a
// key path in it; every cited test title exists in the cited file; and, while
// line citations are still read, every cited line or range into src/,
// tests/, scripts/ or action.yml lies inside that file.
//
// A symbol citation is FILE#name for a top-level function, const, let, var,
// class, type, interface, enum or namespace, or FILE#Class.member for a
// member of a top-level class. In action.yml it is a dotted key path,
// action.yml#inputs.trust-base or action.yml#runs.steps.gates, where a list
// entry is named by its id. A rename fails the check; a moved line does not
// matter.
//
// Once LINE_CITATIONS_REFUSED is true, a FILE:LINE citation into src/,
// tests/, scripts/ or action.yml fails outright, because a line that exists
// is not evidence that it is the code the sentence is about.
//
// A range is "10-12", "10 to 12" or "10 through 12", and a number that
// continues a citation is checked against the same file. A title in
// parentheses after a line must be the exact title of a runnable it or test
// that contains that line. A title with no line, before the file ("t" in
// FILE, "t", also in FILE, "t" in the same file) must be a runnable it or
// test; after the file (FILE ("t"), FILE's "t") it may also be a runnable
// describe. Every name in a list is checked. A citation form this check
// cannot read fails.
//
// Passing means the cited symbols, key paths and titles exist. Whether the
// cited code or test is what the claim beside it is about is read when the
// citation is written or changed; this check does not judge it.
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMap, isScalar, isSeq, parseDocument } from 'yaml';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOC = 'docs/INVARIANTS.md';
// True: every FILE:LINE citation into src/, tests/, scripts/ or action.yml
// is a finding of its own. False would restore the old reading, where a
// line is only range-checked.
export const LINE_CITATIONS_REFUSED = true;
const SOURCE_PATH = String.raw`(?:src|tests)\/[A-Za-z0-9._/-]+\.ts|scripts\/[A-Za-z0-9._/-]+\.mjs|action\.yml`;
// FILE#name, FILE#Class.member, or action.yml#dotted.key-path. A trailing
// full stop ends the sentence, not the name, because every segment after a
// dot must start with a name character.
const SYMBOL_NAME = String.raw`[A-Za-z_$][\w$-]*(?:\.[A-Za-z_$][\w$-]*)*`;
const SYMBOL_CITE = new RegExp(String.raw`(?<![\w./-])(${SOURCE_PATH})#(${SYMBOL_NAME})`, 'g');
const DOT_SLASH_SYMBOL = new RegExp(String.raw`(?<![\w.-])\.\/(?:${SOURCE_PATH})#${SYMBOL_NAME}`, 'g');
// A line number written in prose beside a cited path rather than as
// FILE:LINE: "src/run.ts line 10", "src/run.ts (line 10)", "src/run.ts at
// lines 10-12", "src/run.ts#runAll, line 10", "src/run.ts:L10",
// "src/run.ts#runAll:10", and "line 10 of src/run.ts". Refused with the
// FILE:LINE form, since each one drifts the same way. Only these common
// forms are caught; CONTRIBUTING.md says not to write a line number beside
// a path at all.
const PROSE_LINE = new RegExp(
  String.raw`(?<![\w./-])(?:${SOURCE_PATH})(?::L\d+|#${SYMBOL_NAME}:L?\d+(?:\s*-\s*\d+)?|(?:#${SYMBOL_NAME})?,?\s+\(?(?:at\s+)?lines?\s+\d+(?:\s*-\s*\d+)?)` +
    String.raw`|\blines?\s+\d+(?:\s*-\s*\d+)?\s+(?:of|in)\s+(?:${SOURCE_PATH})(?![\w/-])`,
  'g'
);
// A range is written "10-12", "10 to 12" or "10 through 12"; all three are
// read as the same range, so a worded range is checked rather than ending
// the chain of follow-on lines after it.
const RANGE = String.raw`(\d+)(?:(?:-|\s+(?:to|through)\s+)(\d+))?`;
const RANGE_AT_END = new RegExp(`${RANGE}$`);
const TEST_PATH = String.raw`(?:tests|scripts)\/[A-Za-z0-9._/-]+\.test\.(?:ts|mjs)`;
const CITE = new RegExp(
  String.raw`(?<![\w./-])((?:src|tests)\/[A-Za-z0-9._/-]+\.ts|scripts\/[A-Za-z0-9._/-]+\.mjs|action\.yml):` +
    RANGE,
  'g'
);
const TEST_FILE = new RegExp(`^${TEST_PATH}$`);
// A test file named anywhere, with or without a line number after it. Used to
// find a title cited with no line number, and the file "the same file" means.
const TEST_MENTION = new RegExp(String.raw`(?<![\w./-])(${TEST_PATH})(?![\w/-])`, 'g');
// "title" in FILE, "title", also in FILE, and "title" in the same file.
const NAME_IN_FILE = new RegExp(
  String.raw`[ \t\n]+(also[ \t]*(?:\n[ \t]*)?)?in[ \t]*(?:\n[ \t]*)?(?:(${TEST_PATH})|(the same file))`,
  'g'
);
const DOT_SLASH =
  /(?<![\w.-])\.\/((?:src|tests)\/[A-Za-z0-9._/-]+\.ts|scripts\/[A-Za-z0-9._/-]+\.mjs|action\.yml):\d+(?:-\d+)?/g;
const TITLE_WITHOUT_IN =
  /"[^"\n]{1,400}"\s+(?:tests|scripts)\/[A-Za-z0-9._/-]+\.test\.(?:ts|mjs)/g;
// A line number in parentheses straight after a quoted title, "title" (line
// 43). The line is relative to nothing this check can name, so it fails; the
// form that is checked is FILE:43 ("title").
const LINE_AFTER_TITLE = /"\s*\(\s*lines?\s+\d+/g;
const TIGHT_FOLLOW = new RegExp(
  String.raw`^(?:\s*,\s*and\s+(?:by\s+)?|\s+and\s+(?:by\s+)?|\s*,\s*)` + RANGE
);
const FOR_THE_FOLLOW = new RegExp(String.raw`^\s+for the [a-z][a-z ]{0,40}?,?\s+and\s+` + RANGE);
const AND_BY_FOLLOW = new RegExp(String.raw`^,\s+[^.]{0,400}?,\s+and\s+by\s+` + RANGE);

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
    if (c === '/' && text[i + 1] !== '/' && text[i + 1] !== '*' && regexLikely(text, i)) {
      i = skipRegex(text, i);
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

function countNewlines(text, from, to) {
  let n = 0;
  for (let k = from; k < to && k < text.length; k++) {
    if (text[k] === '\n') {
      n++;
    }
  }
  return n;
}

export function testDeclarations(source) {
  const total = countLines(source);
  const found = [];
  let i = 0;
  let line = 1;
  let atLineStart = true;
  let indent = 0;

  while (i < source.length) {
    const c = source[i];
    if (c === '\n') {
      line++;
      atLineStart = true;
      indent = 0;
      i++;
      continue;
    }
    if (atLineStart && (c === ' ' || c === '\t')) {
      indent++;
      i++;
      continue;
    }
    if (c === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') {
        i++;
      }
      continue;
    }
    if (c === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === '\n') {
          line++;
        }
        i++;
      }
      i = Math.min(source.length, i + 2);
      atLineStart = false;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const next = skipString(source, i);
      line += countNewlines(source, i, next);
      i = next;
      atLineStart = false;
      continue;
    }
    if (c === '/' && regexLikely(source, i)) {
      const next = skipRegex(source, i);
      line += countNewlines(source, i, next);
      i = next;
      atLineStart = false;
      continue;
    }
    if (atLineStart) {
      const head = source.slice(i).match(/^(it|test|describe)((?:\.(?:each|only|skip))*)\s*\(/);
      if (head) {
        found.push({
          line,
          indent,
          kind: head[1] === 'describe' ? 'describe' : 'it',
          skipped: head[2].includes('.skip'),
          each: head[2].includes('.each'),
          openParen: i + head[0].length - 1,
        });
        i += head[0].length;
        atLineStart = false;
        continue;
      }
    }
    atLineStart = false;
    i++;
  }

  function blockEnd(item) {
    const next = found.find((b) => b.line > item.line && b.indent <= item.indent);
    return next ? next.line - 1 : total;
  }

  const decls = [];
  for (const item of found) {
    if (item.kind === 'describe') {
      if (item.each) {
        continue;
      }
      const name = readTitle(source, item.openParen);
      if (name === null) {
        continue;
      }
      const skipped =
        item.skipped ||
        found.some(
          (block) =>
            block.kind === 'describe' &&
            block.skipped &&
            block.line < item.line &&
            block.indent < item.indent &&
            blockEnd(block) >= item.line
        );
      const decl = { name, start: item.line, end: blockEnd(item), kind: 'describe' };
      if (skipped) {
        decl.skipped = true;
      }
      decls.push(decl);
      continue;
    }
    let titleParen = item.openParen;
    if (item.each) {
      const after = skipBalanced(source, item.openParen);
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
    const enclosedSkip = found.some(
      (block) =>
        block.kind === 'describe' &&
        block.skipped &&
        block.line < item.line &&
        block.indent < item.indent &&
        blockEnd(block) >= item.line
    );
    const next = found.find((b) => b.line > item.line && b.indent <= item.indent);
    const decl = { name, start: item.line, end: next ? next.line - 1 : total };
    if (item.skipped || enclosedSkip) {
      decl.skipped = true;
    }
    decls.push(decl);
  }
  return decls;
}

const TOP_LEVEL_DECLARATION =
  /^(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:async\s+)?(?:abstract\s+)?(?:(function)\s*\*?\s*|(class|const\s+enum|const|let|var|type|interface|enum|namespace)\s+)([A-Za-z_$][\w$]*)/;
const CLASS_MEMBER =
  /^(?:(?:public|private|protected|static|readonly|async|override|abstract|declare|get|set)\s+)*(#?[A-Za-z_$][\w$]*)\s*(?:[(<]|[?!]?\s*[:=;])/;

// The names a symbol citation may use for a source file: every top-level
// declaration, read only at brace depth zero and outside strings, comments
// and regular expressions, so a declaration-shaped line inside a template
// literal or a function body is not taken for one. A member of a top-level
// class is named Class.member.
export function topLevelDeclarations(source) {
  const found = [];
  let i = 0;
  let line = 1;
  let atLineStart = true;
  let indent = 0;
  let depth = 0;
  let pendingClass = null;
  let classBody = null;

  while (i < source.length) {
    const c = source[i];
    if (c === '\n') {
      line++;
      atLineStart = true;
      indent = 0;
      i++;
      continue;
    }
    if (atLineStart && (c === ' ' || c === '\t')) {
      indent++;
      i++;
      continue;
    }
    if (c === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') {
        i++;
      }
      continue;
    }
    if (c === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === '\n') {
          line++;
        }
        i++;
      }
      i = Math.min(source.length, i + 2);
      atLineStart = false;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const next = skipString(source, i);
      line += countNewlines(source, i, next);
      i = next;
      atLineStart = false;
      continue;
    }
    if (c === '/' && regexLikely(source, i)) {
      const next = skipRegex(source, i);
      line += countNewlines(source, i, next);
      i = next;
      atLineStart = false;
      continue;
    }
    if (atLineStart) {
      const rest = source.slice(i, source.indexOf('\n', i) === -1 ? source.length : source.indexOf('\n', i));
      if (depth === 0 && indent === 0) {
        const decl = rest.match(TOP_LEVEL_DECLARATION);
        if (decl) {
          found.push({ name: decl[3], line });
          pendingClass = decl[2] === 'class' ? decl[3] : null;
        }
      } else if (classBody !== null && depth === 1) {
        const member = rest.match(CLASS_MEMBER);
        if (member) {
          found.push({ name: `${classBody}.${member[1]}`, line });
        }
      }
    }
    atLineStart = false;
    if (c === '{' || c === '(' || c === '[') {
      if (c === '{' && depth === 0 && pendingClass !== null) {
        classBody = pendingClass;
        pendingClass = null;
      }
      depth++;
    } else if (c === '}' || c === ')' || c === ']') {
      depth = Math.max(0, depth - 1);
      if (depth === 0) {
        classBody = null;
      }
    } else if (c === ';' && depth === 0) {
      pendingClass = null;
    }
    i++;
  }
  return found;
}

// Every key path an action.yml citation may use: mapping keys joined by
// dots, with a list entry named by its id. An entry with no id has no key
// path, so nothing under it can be cited this way.
export function yamlKeyPaths(source) {
  const paths = [];

  function walk(node, prefix) {
    if (isMap(node)) {
      for (const pair of node.items) {
        const key = isScalar(pair.key) ? pair.key.value : pair.key;
        if (typeof key !== 'string' && typeof key !== 'number') {
          continue;
        }
        const here = prefix === '' ? String(key) : `${prefix}.${key}`;
        paths.push(here);
        walk(pair.value, here);
      }
      return;
    }
    if (isSeq(node)) {
      for (const item of node.items) {
        const id = isMap(item) ? item.get('id') : undefined;
        if (typeof id !== 'string' || id === '') {
          continue;
        }
        const here = prefix === '' ? id : `${prefix}.${id}`;
        paths.push(here);
        walk(item, here);
      }
    }
  }

  walk(parseDocument(source).contents, '');
  return paths;
}

function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length];
}

export function nearestNames(name, names, count = 3) {
  return [...new Set(names)]
    .map((candidate) => ({ candidate, distance: editDistance(name.toLowerCase(), candidate.toLowerCase()) }))
    .sort((x, y) => x.distance - y.distance || x.candidate.localeCompare(y.candidate))
    .slice(0, count)
    .map((entry) => entry.candidate);
}

export function symbolFindings(text, symbolsIn, docPath = DOC) {
  const findings = [];
  for (const match of text.matchAll(DOT_SLASH_SYMBOL)) {
    const line = lineNumberAt(text, match.index);
    findings.push(`${docPath}:${line}: ${match[0]} is a citation form this check does not read`);
  }
  for (const match of text.matchAll(SYMBOL_CITE)) {
    const [cite, file, name] = match;
    const line = lineNumberAt(text, match.index);
    const names = symbolsIn(file);
    if (names === undefined) {
      findings.push(`${docPath}:${line}: ${cite} cites ${file}, which is not a source file`);
      continue;
    }
    if (names.includes(name)) {
      continue;
    }
    const what = file === 'action.yml' ? 'key path' : 'top-level declaration';
    const nearest = nearestNames(name, names);
    const hint = nearest.length > 0 ? `; nearest: ${nearest.join(', ')}` : '';
    findings.push(`${docPath}:${line}: ${file} has no ${what} named "${name}"${hint}`);
  }
  return findings;
}

// Every FILE:LINE citation into a source file, as a finding. Used once
// LINE_CITATIONS_REFUSED is true; a follow-on number always comes after one
// of these, so reporting the first is enough to fail the sentence.
export function lineCitationFindings(text, docPath = DOC) {
  const findings = [];
  for (const match of text.matchAll(CITE)) {
    const line = lineNumberAt(text, match.index);
    findings.push(
      `${docPath}:${line}: ${match[0]} cites a line; cite a symbol (FILE#name), a test title, or an action.yml key path (action.yml#key.path) instead`
    );
  }
  for (const match of text.matchAll(PROSE_LINE)) {
    const line = lineNumberAt(text, match.index);
    findings.push(
      `${docPath}:${line}: ${match[0]} names a line in prose; cite a symbol (FILE#name), a test title, or an action.yml key path (action.yml#key.path) instead`
    );
  }
  return findings;
}

function skipSpaceBack(text, i) {
  while (i >= 0 && /[ \t]/.test(text[i])) {
    i--;
  }
  if (text[i] === '\n') {
    let j = i - 1;
    while (j >= 0 && /[ \t]/.test(text[j])) {
      j--;
    }
    if (text[j] !== '\n') {
      i = j;
    }
  }
  return i;
}

function quotedNameEndingAt(text, close) {
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
  return { name: normalizeCitedName(text.slice(i + 1, close)), open: i };
}

function quotedNamesBefore(text, index) {
  const names = [];
  let cursor = index;
  while (names.length < 20) {
    const close = skipSpaceBack(text, cursor - 1);
    if (text[close] !== '"') {
      break;
    }
    const quoted = quotedNameEndingAt(text, close);
    if (quoted === null) {
      break;
    }
    names.unshift(quoted.name);
    const before = skipSpaceBack(text, quoted.open - 1);
    if (text[before] === ',') {
      cursor = before;
      continue;
    }
    if (
      before >= 2 &&
      text.slice(before - 2, before + 1) === 'and' &&
      (before < 3 || !/\w/.test(text[before - 3]))
    ) {
      cursor = before - 2;
      continue;
    }
    break;
  }
  return names;
}

function takeTitle(text, from) {
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
  return { name: normalizeCitedName(text.slice(i + 2, end)), end: end + 2 };
}

// The closing quote of a title cited after its file: a quote followed by
// punctuation, white space or the end of the text. A quote inside a title
// ("exactly "true"") is followed by a letter or another quote, so it does not
// end the title.
function titleCloseAfter(text, open) {
  let i = open + 1;
  while (i < text.length && i - open <= 600) {
    if (text[i] === '\n' && text[i + 1] === '\n') {
      return -1;
    }
    if (text[i] === '"' && (i + 1 >= text.length || /[\s),.:;]/.test(text[i + 1]))) {
      return i;
    }
    i++;
  }
  return -1;
}

// Titles cited straight after a test file with no line number:
// FILE ("title"), FILE, "title", FILE's "title", FILE (describe block
// "title"), and a list of them joined by commas or "and". Each one is checked
// as the title of a runnable test or describe block in that file.
export function titlesAfterFile(text, from) {
  const rest = text.slice(from);
  const lead = rest.match(/^(?:'s)?,?[ \t]*(?:\n[ \t]*)?(?:\([ \t]*(?:describe block[ \t]*(?:\n[ \t]*)?)?)?"/);
  if (!lead) {
    return [];
  }
  const names = [];
  let open = from + lead[0].length - 1;
  while (names.length < 20) {
    const close = titleCloseAfter(text, open);
    if (close === -1) {
      break;
    }
    names.push(normalizeCitedName(text.slice(open + 1, close)));
    const sep = text
      .slice(close + 1)
      .match(/^[ \t]*(?:\n[ \t]*)?(?:,[ \t]*(?:\n[ \t]*)?)?(?:and[ \t]*(?:\n[ \t]*)?)?(?:,?[ \t]*(?:\n[ \t]*)?separately,[ \t]*(?:\n[ \t]*)?)?"/);
    if (!sep || sep[0].trim() === '"') {
      break;
    }
    open = close + sep[0].length;
  }
  return names;
}

function skipParens(text, open) {
  let depth = 0;
  let i = open;
  while (i < text.length) {
    const c = text[i];
    if (c === "'" || c === '"' || c === '`') {
      i = skipString(text, i);
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

function followSpan(match, at) {
  const start = Number(match[1]);
  const end = match[2] === undefined ? start : Number(match[2]);
  const suffix = match[0].match(RANGE_AT_END)[0];
  return { start, end, endIndex: at + match[0].length, numberAt: at + match[0].length - suffix.length };
}

function nextContinuation(text, pos) {
  let i = pos;
  while (i < text.length) {
    const rest = text.slice(i);
    const tight = rest.match(TIGHT_FOLLOW);
    if (tight) {
      return followSpan(tight, i);
    }
    const gloss = rest.match(/^\s*\(/);
    if (gloss && !/^\s*\("/.test(rest)) {
      const open = i + gloss[0].length - 1;
      const after = skipParens(text, open);
      if (after <= i) {
        return null;
      }
      i = after;
      continue;
    }
    const forThe = rest.match(FOR_THE_FOLLOW);
    if (forThe) {
      return followSpan(forThe, i);
    }
    const andBy = rest.match(AND_BY_FOLLOW);
    if (andBy && !/(?:src|tests|scripts)\/|action\.yml:/.test(andBy[0])) {
      return followSpan(andBy, i);
    }
    return null;
  }
  return null;
}

// A quoted title straight after FILE:LINE with no parentheses, FILE:LINE,
// "title" or FILE:LINE "title". The checked form is FILE:LINE ("title").
const BARE_TITLE_AFTER_LINE = /^,?[ \t]*(?:\n[ \t]*)?"/;

function unreadTitleAfterLine(docPath, line, shown) {
  return `${docPath}:${line}: ${shown} is followed by a quoted title outside parentheses, a citation form this check does not read; cite FILE:LINE ("title")`;
}

function rangeProblem(docPath, line, file, start, end, length, shown) {
  if (length === undefined) {
    return `${docPath}:${line}: ${shown} cites ${file}, which is not a source file`;
  }
  if (start < 1 || end < 1) {
    return `${docPath}:${line}: ${shown} cites a line before 1`;
  }
  if (start > length || end > length || end < start) {
    return `${docPath}:${line}: ${shown} exceeds ${file} (${length} lines)`;
  }
  return null;
}

function nameFindings(docPath, line, file, name, cite, decls, start, end, withDescribe = false) {
  const matches = (decls ?? []).filter(
    (decl) => decl.name === name && (withDescribe || decl.kind !== 'describe')
  );
  const live = matches.filter((decl) => !decl.skipped);
  if (live.length === 0) {
    if (matches.length > 0) {
      return [`${docPath}:${line}: ${file} has no runnable test named "${name}"`];
    }
    return [`${docPath}:${line}: ${file} has no test named "${name}"`];
  }
  if (start === undefined) {
    return [];
  }
  const hit = live.find((decl) => start >= decl.start && end <= decl.end);
  if (hit) {
    return [];
  }
  const decl = live[0];
  const where = cite ?? file;
  return [
    `${docPath}:${line}: ${where} ("${name}") is outside that test (lines ${decl.start}-${decl.end})`,
  ];
}

export function citationFindings(text, lineCount, docPath = DOC, testsIn = () => undefined) {
  const findings = [];

  for (const match of text.matchAll(DOT_SLASH)) {
    const line = lineNumberAt(text, match.index);
    findings.push(`${docPath}:${line}: ${match[0]} is a citation form this check does not read`);
  }

  for (const match of text.matchAll(TITLE_WITHOUT_IN)) {
    const line = lineNumberAt(text, match.index);
    findings.push(`${docPath}:${line}: ${match[0]} cites a test title with no "in"`);
  }

  for (const match of text.matchAll(CITE)) {
    const file = match[1];
    const start = Number(match[2]);
    const end = match[3] === undefined ? start : Number(match[3]);
    const cite = match[0];
    const line = lineNumberAt(text, match.index);
    const length = lineCount(file);
    const primary = rangeProblem(docPath, line, file, start, end, length, cite);
    if (primary) {
      findings.push(primary);
    }

    let pos = match.index + match[0].length;
    if (TEST_FILE.test(file)) {
      const titled = takeTitle(text, pos);
      if (titled) {
        findings.push(...nameFindings(docPath, line, file, titled.name, cite, testsIn(file), start, end));
        pos = titled.end;
      } else if (BARE_TITLE_AFTER_LINE.test(text.slice(pos))) {
        findings.push(unreadTitleAfterLine(docPath, line, cite));
      }
    }

    while (pos < text.length) {
      const step = nextContinuation(text, pos);
      if (!step) {
        break;
      }
      const stepLine = lineNumberAt(text, step.numberAt);
      const shown = step.end === step.start ? `${file}:${step.start}` : `${file}:${step.start}-${step.end}`;
      const problem = rangeProblem(docPath, stepLine, file, step.start, step.end, length, shown);
      if (problem) {
        findings.push(problem);
      }
      pos = step.endIndex;
      if (TEST_FILE.test(file)) {
        const titled = takeTitle(text, pos);
        if (titled) {
          findings.push(
            ...nameFindings(docPath, stepLine, file, titled.name, shown, testsIn(file), step.start, step.end)
          );
          pos = titled.end;
        } else if (BARE_TITLE_AFTER_LINE.test(text.slice(pos))) {
          findings.push(unreadTitleAfterLine(docPath, stepLine, shown));
        }
      }
    }
  }

  for (const match of text.matchAll(LINE_AFTER_TITLE)) {
    const line = lineNumberAt(text, match.index);
    findings.push(
      `${docPath}:${line}: a line number in parentheses after a quoted title is a citation form this check does not read; cite FILE:LINE ("title")`
    );
  }

  const mentions = [...text.matchAll(TEST_MENTION)];

  for (const mention of mentions) {
    const file = mention[1];
    const after = mention.index + mention[0].length;
    if (text[after] === ':' && /\d/.test(text[after + 1] ?? '')) {
      continue;
    }
    const titles = titlesAfterFile(text, after);
    const line = lineNumberAt(text, mention.index);
    for (const name of titles) {
      findings.push(...nameFindings(docPath, line, file, name, null, testsIn(file), undefined, undefined, true));
    }
  }

  for (const match of text.matchAll(NAME_IN_FILE)) {
    let anchor = match.index;
    if (match[1] !== undefined) {
      const comma = skipSpaceBack(text, anchor - 1);
      if (text[comma] === ',') {
        anchor = comma;
      }
    }
    const line = lineNumberAt(text, match.index);
    let file = match[2];
    if (file === undefined) {
      const names = quotedNamesBefore(text, anchor);
      if (names.length === 0) {
        continue;
      }
      const previous = mentions.filter((m) => m.index < anchor).pop();
      if (previous === undefined) {
        findings.push(
          `${docPath}:${line}: "${names[0]}" is cited in the same file, but no test file is named before it`
        );
        continue;
      }
      file = previous[1];
    }
    const closer = text[skipSpaceBack(text, anchor - 1)];
    if (closer === "'") {
      findings.push(
        `${docPath}:${line}: ${file} is cited with a '-quoted title, which this check does not read`
      );
      continue;
    }
    if (closer === '`') {
      findings.push(
        `${docPath}:${line}: ${file} is cited with a backtick-quoted title, which this check does not read`
      );
      continue;
    }
    for (const name of quotedNamesBefore(text, anchor)) {
      findings.push(...nameFindings(docPath, line, file, name, null, testsIn(file)));
    }
  }

  return findings;
}

export function citationSources(root = ROOT) {
  const counts = new Map([
    ...lineCountsUnder(path.join(root, 'src')),
    ...lineCountsUnder(path.join(root, 'tests')),
    ...lineCountsUnder(path.join(root, 'scripts'), ['.mjs']),
  ]);
  const action = readFileSync(path.join(root, 'action.yml'), 'utf8');
  counts.set('action.yml', countLines(action));
  const tests = new Map([
    ...indexTests(path.join(root, 'tests'), ['.ts']),
    ...indexTests(path.join(root, 'scripts'), ['.mjs']),
  ]);
  const symbols = new Map();
  return {
    lineCount: (file) => counts.get(file),
    testsIn: (file) => tests.get(file),
    symbolsIn: (file) => {
      if (!counts.has(file)) {
        return undefined;
      }
      if (!symbols.has(file)) {
        const source = file === 'action.yml' ? action : readFileSync(path.join(root, file), 'utf8');
        symbols.set(
          file,
          file === 'action.yml' ? yamlKeyPaths(source) : topLevelDeclarations(source).map((decl) => decl.name)
        );
      }
      return symbols.get(file);
    },
  };
}

// Everything this check reports about a document: line, title and symbol
// citations, and every line citation as well once LINE_CITATIONS_REFUSED is
// true.
export function allFindings(text, sources, docPath = DOC, refuseLines = LINE_CITATIONS_REFUSED) {
  return [
    ...(refuseLines ? lineCitationFindings(text, docPath) : []),
    ...citationFindings(text, sources.lineCount, docPath, sources.testsIn),
    ...symbolFindings(text, sources.symbolsIn, docPath),
  ];
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
  const findings = allFindings(text, sources);

  if (findings.length > 0) {
    for (const finding of findings) {
      console.error(`x ${finding}`);
    }
    console.error(
      '\ncheck-invariant-citations: a cited symbol or key path is not in its file, a cited test name is not a runnable test in that file, a line is cited, or the citation is a form this check does not read. Re-derive it from the function or test the sentence describes.'
    );
    process.exit(1);
  }

  console.log(
    'check-invariant-citations: every cited symbol and key path in docs/INVARIANTS.md is declared in its file, and every cited test title exists in its file.'
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
