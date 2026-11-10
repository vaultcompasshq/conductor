// The pull-request comment surface: conductor's existing TEXT REPORT, posted
// (and kept up to date) as a pull request comment when a consumer opts in.
//
// The one thing worth testing here is NOT the report's content -- that
// belongs to output-text.test.ts, which already covers it -- it is the
// posting logic: the marker that makes the comment STICKY across re-runs,
// the report going to `gh` BY FILE rather than interpolated into a command,
// and the FORK-SAFE degrade: a posting failure must warn and never throw, so
// the pull-request comment step can never fail the action or change the
// gate's verdict.
//
// `run` is the one seam that reaches the network (a `gh` invocation). Every
// case here hands `postReport` a recording stand-in for it, so nothing in
// this file makes a real network call.

import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';

import {
  COMMENT_LIMIT,
  MARKER,
  PREVIEW_HEADER,
  buildCommentBody,
  createCommentArgs,
  fenceReport,
  findMarkedCommentId,
  headBlock,
  listCommentsArgs,
  postReport,
  truncateReport,
  updateCommentArgs,
} from '../lib/pr-comment.mjs';

describe('fenceReport', () => {
  it('wraps the report in a text code fence', () => {
    const fenced = fenceReport('conductor: clean, nothing blocked. 2 gate(s) ran.');
    expect(fenced).toMatch(/^```text\n/);
    expect(fenced).toMatch(/\n```$/);
    expect(fenced).toContain('conductor: clean, nothing blocked. 2 gate(s) ran.');
  });

  it('widens a literal triple backtick in the report so it cannot close the fence early', () => {
    // The report is conductor's own output, but it can carry a finding's own
    // text or a scanned path verbatim. Content is never trusted to be free of
    // the one sequence that would let it escape the fence it is inside.
    const fenced = fenceReport('a report line containing ``` right here');
    const lines = fenced.split('\n');
    // Exactly two fence delimiters: the opening and closing ones this
    // function itself wrote. Anything from the report that would have been a
    // third is neutralised.
    const fenceLines = lines.filter((line) => line.trim() === '```text' || line.trim() === '```');
    expect(fenceLines).toEqual(['```text', '```']);
  });
});

describe('buildCommentBody', () => {
  it('puts the hidden marker in the body, ahead of the fenced report', () => {
    const body = buildCommentBody('conductor: clean, nothing blocked. 2 gate(s) ran.', MARKER);
    expect(body.indexOf(MARKER)).toBe(0);
    expect(body).toContain('```text');
    expect(body).toContain('conductor: clean, nothing blocked. 2 gate(s) ran.');
  });

  it('renders the marker as an HTML comment, so it stays invisible on the pull request', () => {
    expect(MARKER.startsWith('<!--')).toBe(true);
    expect(MARKER.endsWith('-->')).toBe(true);
  });
});

// Issue 102, first cut: a verdict line, one row per gate, the findings by
// name, and the report itself collapsed under them.
describe('the comment above the collapsed report', () => {
  const RAN = 'gate dependencies (dep-guard 0.20.0): ran, exit 0, 0 blocking';
  const BLOCKED = 'gate secrets (vault-guard 1.13.3): ran, exit 1, 1 blocking';
  const MISSING = 'gate vulnerabilities (osv-scanner version unknown): did not run (binary-missing)';
  const COUNT = 'findings: 3 (1 blocking), the first 2:';
  const NAMED = 'finding: BLOCKING vault-guard vault-guard/aws-key src/a_b.ts:3: an AWS access key';
  const NEW = 'new in this pull request: 1 (vulnerabilities gate; 4 already on the base)';
  const PRESENT = 'present-on-base: 4 reported, not blocking';
  const REST = 'conductor run: 2 gate(s), 3 finding(s)\n\nsecrets  vault-guard 1.13.3  exit 1\n\nverdict: exit 1.\n';
  const report = (...head) => ['conductor 9.9.9', ...head, REST].join('\n');

  it('leads with the verdict, then a row per gate, then the findings, then the whole report collapsed', () => {
    const text = report('verdict-token: blocked (1)', RAN, BLOCKED, COUNT, NAMED, 'and 1 more blocking');
    expect(buildCommentBody(text).split('\n')).toEqual([
      MARKER,
      '### Conductor report',
      '',
      'conductor verdict: blocked (1)',
      '',
      '```text',
      RAN,
      BLOCKED,
      '```',
      '',
      '```text',
      COUNT,
      NAMED,
      'and 1 more blocking',
      '```',
      '',
      '<details>',
      '<summary>Full report</summary>',
      '',
      '```text',
      ...text.split('\n'),
      '```',
      '',
      '</details>',
      '',
    ]);
  });

  it('leads the run-level lines with what this pull request introduced, when the report has that line', () => {
    const body = buildCommentBody(report('verdict-token: pass', PRESENT, NEW, RAN));
    expect(body.split('\n').slice(3, 9)).toEqual(['conductor verdict: pass', '', NEW, '', PRESENT, '']);
  });

  it('starts the report open on a run with no trust base, and collapsed on every other', () => {
    const REFUSED = 'gate secrets (vault-guard): did not run (trust base refused)';
    for (const line of [
      'trust-base: refused, no rules were read and no gate ran',
      'trust-base: not given on a pull-request job, no rules were read and no gate ran',
    ]) {
      const lines = buildCommentBody(report('verdict-token: could-not-run', line, REFUSED)).split('\n');
      expect([line, lines.filter((each) => each.startsWith('<details'))]).toEqual([line, ['<details open>']]);
    }
    // A could-not-run with a trust base, and a line worded like the fixed
    // one where a finding can put it, both stay collapsed.
    for (const text of [
      report('verdict-token: could-not-run', MISSING),
      report('verdict-token: blocked (1)', BLOCKED) + 'trust-base: refused, no rules were read and no gate ran\n',
    ]) {
      expect(buildCommentBody(text).split('\n').filter((each) => each.startsWith('<details'))).toEqual(['<details>']);
    }
  });

  it('posts a body with no head block exactly as before: fenced, not collapsed', () => {
    for (const text of [
      'Conductor could not run. The gate packages were not verified.\n',
      'conductor: clean, nothing blocked. 2 gate(s) ran.\n',
      `conductor 9.9.9\nverdict-token: passed\n${RAN}\n`,
      `verdict-token: pass\n${RAN}\n`,
      `conductor 9.9.9 <b>\nverdict-token: pass\n${RAN}\n`,
    ]) {
      expect([text, buildCommentBody(text)]).toEqual([
        text,
        [MARKER, '### Conductor report', '', fenceReport(text), ''].join('\n'),
      ]);
      expect([text, headBlock(text)]).toEqual([text, null]);
    }
  });

  // A report with a version and a token and no per-gate line is one from a
  // conductor older than the head block (or a run that named no gate). There
  // is nothing to lead with, so it is not collapsed behind a bare verdict.
  it('posts a report with no per-gate line exactly as before, as a conductor without the head block writes it', () => {
    const older =
      'conductor 0.18.1\nverdict-token: blocked (1)\nconductor run: 2 gate(s), 1 finding(s)\n\n' +
      'secrets  vault-guard 1.13.3  exit 1\n  BLOCKING  critical  vault-guard/aws-key  src/a.ts:3\n\nverdict: exit 1.\n';
    for (const text of [
      older,
      // The two lines an older conductor could print under the token.
      older.replace('conductor run:', `${PRESENT}\nconductor run:`),
      // And a count line with no gate line above it.
      older.replace('conductor run:', `${COUNT}\n${NAMED}\nconductor run:`),
    ]) {
      expect([text, headBlock(text)?.gates]).toEqual([text, []]);
      const body = buildCommentBody(text);
      expect(body).toBe([MARKER, '### Conductor report', '', fenceReport(text), ''].join('\n'));
      expect(body).not.toContain('<details');
    }
  });

  // Kills: searching the report for a gate-shaped or verdict-shaped line
  // instead of reading the head block by position.
  it('never lifts a line from below the head block, where a finding can write one', () => {
    const forgedGate = 'gate vulnerabilities (osv-scanner 2.6.0): ran, exit 0, 0 blocking';
    const text = [
      'conductor 9.9.9',
      'verdict-token: could-not-run',
      MISSING,
      'conductor run: 1 gate(s), 1 finding(s)',
      forgedGate,
      'verdict-token: pass',
      COUNT,
      NAMED,
      NEW,
      '',
    ].join('\n');
    expect(headBlock(text)).toEqual({ token: 'could-not-run', runLevel: [], gates: [MISSING], findings: [] });
    const above = buildCommentBody(text).split('<details>')[0];
    expect(above).not.toContain('ran, exit 0');
    expect(above).not.toContain('pass');
    expect(above).not.toContain('finding:');
  });

  it('takes a gate line only when the whole line is the closed shape, and stops at the first that is not', () => {
    for (const bad of [
      `${RAN} ::error::x`,
      ` ${RAN}`,
      `${RAN}\r`,
      'gate dependencies (dep-guard 0.20.0): ran',
      'gate dependencies (dep-guard `0.20.0`): ran, exit 0, 0 blocking',
      'gate dependencies (dep-guard <b>): ran, exit 0, 0 blocking',
      'gate dependencies (evil-guard 0.20.0): ran, exit 0, 0 blocking',
      'gate dependencies (dep-guard 0.20.0): did not run ([x](http://example.com))',
      '**gate dependencies (dep-guard 0.20.0): ran, exit 0, 0 blocking**',
    ]) {
      expect([bad, headBlock(report('verdict-token: pass', bad, RAN))]).toEqual([
        bad,
        { token: 'pass', runLevel: [], gates: [], findings: [] },
      ]);
    }
  });

  it('closes the run-level slot at the first gate line', () => {
    expect(headBlock(report('verdict-token: pass', PRESENT, RAN, NEW, BLOCKED))).toEqual({
      token: 'pass',
      runLevel: [PRESENT],
      gates: [RAN],
      findings: [],
    });
  });

  it('replaces a finding line holding a backtick or anything unprintable, and copies at most 25', () => {
    for (const bad of [
      'finding: BLOCKING x `y` z',
      'finding: BLOCKING x‮y',
      'finding: BLOCKING x\ty',
      'finding: BLOCKING src/café.ts:3: señor',
      'finding: maybe x',
      // Only what blocks is named, so the other word is not a finding line.
      'finding: report x rule: y',
    ]) {
      const head = headBlock(report('verdict-token: blocked (1)', BLOCKED, COUNT, bad, NAMED));
      expect([bad, head.findings]).toEqual([bad, [COUNT, 'finding: (line omitted: unsafe characters)', NAMED]]);
    }
    const many = Array.from({ length: 30 }, (_, i) => `finding: BLOCKING x rule-${i}: y`);
    const head = headBlock(report('verdict-token: blocked (1)', BLOCKED, COUNT, ...many, 'and 4 more blocking'));
    expect(head.findings).toHaveLength(27);
    expect(head.findings.at(-1)).toBe('and 4 more blocking');
    // The closing line in any other words ends the block and is not copied.
    for (const closing of ['and 4 more', 'and 4 more blocking ', 'and many more blocking', 'and 4 more blocking\r']) {
      const other = headBlock(report('verdict-token: blocked (1)', BLOCKED, COUNT, NAMED, closing, NAMED));
      expect([closing, other.findings]).toEqual([closing, [COUNT, NAMED]]);
    }
  });

  it('takes the count line alone when nothing blocks, and nothing under it', () => {
    const NONE = 'findings: 77 (0 blocking)';
    const head = headBlock(report('verdict-token: pass', RAN, NONE, NAMED, RAN));
    expect(head).toEqual({ token: 'pass', runLevel: [], gates: [RAN], findings: [NONE] });
    expect(buildCommentBody(report('verdict-token: pass', RAN, NONE)).split('\n').slice(3, 13)).toEqual([
      'conductor verdict: pass',
      '',
      '```text',
      RAN,
      '```',
      '',
      '```text',
      NONE,
      '```',
      '',
    ]);
    // Without the colon only for a count of none blocking.
    expect(headBlock(report('verdict-token: blocked (1)', BLOCKED, 'findings: 3 (1 blocking)', NAMED)).findings).toEqual([]);
  });

  it('takes a version only of version characters, whatever letters a locale would call letters', () => {
    for (const bad of [
      'gate secrets (vault-guard 1.13.3é): ran, exit 1, 1 blocking',
      'gate secrets (vault-guard 1.13.3а): ran, exit 1, 1 blocking',
      'gate secrets (vault-guard 1.13.3): did not run (version-skew), the action pinned 1.13.é',
    ]) {
      expect([bad, headBlock(report('verdict-token: blocked (1)', bad, RAN)).gates]).toEqual([bad, []]);
    }
  });

  // The two bounds on the scan: it reads no further than line 100 of the
  // report and stops at a line over 600 characters, whatever the lines are.
  it('reads no further than line 100 of the report', () => {
    const rows = Array.from({ length: 120 }, () => RAN);
    const head = headBlock(report('verdict-token: pass', ...rows));
    // Lines 3 to 100.
    expect(head.gates).toHaveLength(98);
    const late = headBlock(report('verdict-token: pass', ...rows.slice(0, 98), COUNT, NAMED));
    expect(late.findings).toEqual([]);
    const inTime = headBlock(report('verdict-token: pass', ...rows.slice(0, 96), COUNT, NAMED));
    expect(inTime.findings).toEqual([COUNT, NAMED]);
  });

  it('stops at a line over 600 characters, and takes one of exactly 600', () => {
    const fill = (length) => `finding: BLOCKING x rule: ${'y'.repeat(length - 'finding: BLOCKING x rule: '.length)}`;
    expect(fill(600)).toHaveLength(600);
    expect(headBlock(report('verdict-token: blocked (1)', BLOCKED, COUNT, fill(600), NAMED)).findings).toEqual([
      COUNT,
      fill(600),
      NAMED,
    ]);
    // Not replaced by the placeholder and carried on from: the scan ends.
    expect(headBlock(report('verdict-token: blocked (1)', BLOCKED, COUNT, fill(601), NAMED)).findings).toEqual([COUNT]);
    expect(headBlock(report('verdict-token: pass', RAN, 'x'.repeat(601), BLOCKED)).gates).toEqual([RAN]);
  });

  it('takes a finding line only from the block the count line opens, and ends it at any other line', () => {
    expect(headBlock(report('verdict-token: blocked (1)', BLOCKED, NAMED)).findings).toEqual([]);
    expect(headBlock(report('verdict-token: blocked (1)', BLOCKED, 'would pass: 1 (0 blocking):', NAMED)).findings).toEqual([]);
    expect(headBlock(report('verdict-token: blocked (1)', BLOCKED, COUNT, NAMED, RAN, NAMED)).findings).toEqual([COUNT, NAMED]);
  });

  it('keeps the report fenced inside the collapsed block whatever it carries', () => {
    const hostile = '```\n</details>\n<details open>\n# pwn\n' + MARKER;
    const body = buildCommentBody(report('verdict-token: blocked (1)', BLOCKED) + hostile);
    const lines = body.split('\n');
    // The fences this function wrote, and no other: the head's one block and
    // the report's, each opened and closed once.
    expect(lines.filter((line) => line.trim() === '```text' || line.trim() === '```')).toEqual([
      '```text',
      '```',
      '```text',
      '```',
    ]);
    expect(lines.filter((line) => line === '<details>')).toHaveLength(1);
    expect(lines.at(-2)).toBe('</details>');
    expect(lines.at(-4)).toBe('```');
  });

  it('takes the room the head uses out of the report, so the body stays under the comment limit', () => {
    const many = Array.from({ length: 25 }, (_, i) => `finding: BLOCKING x rule-${i}: ${'y'.repeat(500)}`);
    const text = report('verdict-token: blocked (1)', BLOCKED, COUNT, ...many) + 'z'.repeat(70000);
    const body = buildCommentBody(text);
    expect(body.length).toBeLessThan(65536);
    expect(body).toContain('(report truncated at ');
    expect(body).toContain('</details>');
  });
});

const BOT_AUTHOR = { login: 'github-actions[bot]', type: 'Bot' };
const HUMAN_AUTHOR = { login: 'someone', type: 'User' };

describe('truncateReport', () => {
  const PRIMARY = 'conductor 9.9.9\nverdict-token: pass\n' + 'x'.repeat(1000) + '\n\nconductor verdict: pass\n';

  it('a comment over 60000 characters keeps the primary report and cuts the preview first', () => {
    const text = PRIMARY + '\n' + PREVIEW_HEADER + '\n' + 'y'.repeat(70000) + '\n';
    expect(truncateReport(text)).toBe(
      PRIMARY + '\n(preview under the proposed rules omitted: the report is over 60000 characters)\n'
    );
    expect(buildCommentBody(text)).toContain(PRIMARY.trimEnd());
    expect(buildCommentBody(text)).not.toContain('yyyy');
  });

  it('leaves a report at or under 60000 characters alone, and cuts a primary report over it with a note', () => {
    expect(COMMENT_LIMIT).toBe(60000);
    expect(truncateReport('a'.repeat(60000))).toBe('a'.repeat(60000));
    expect(truncateReport('a'.repeat(70000))).toBe('a'.repeat(60000) + '\n\n(report truncated at 60000 characters)');
  });

  it('cuts the primary report too when it alone is over the limit, preview block or not', () => {
    const big = 'conductor 9.9.9\n' + 'a'.repeat(65000) + '\n';
    const text = big + '\n' + PREVIEW_HEADER + '\n' + 'y'.repeat(10) + '\n';
    expect(truncateReport(text)).toBe(text.slice(0, 60000) + '\n\n(report truncated at 60000 characters)');
  });

  it('cuts at the last preview header, so a header-shaped line in the primary report cannot cut it short', () => {
    const primary = 'conductor 9.9.9\n\n' + PREVIEW_HEADER + '\n' + 'x'.repeat(1000) + '\n\nconductor verdict: pass\n';
    const text = primary + '\n' + PREVIEW_HEADER + '\n' + 'y'.repeat(70000) + '\n';
    expect(truncateReport(text)).toBe(
      primary + '\n(preview under the proposed rules omitted: the report is over 60000 characters)\n'
    );
  });

  it('spells PREVIEW_HEADER exactly as src/output-text.ts does', () => {
    expect(PREVIEW_HEADER).toBe('Preview under the proposed rules (does not affect the verdict)');
    const source = readFileSync(new URL('../../src/output-text.ts', import.meta.url), 'utf8');
    expect(source).toContain(`export const PREVIEW_HEADER = '${PREVIEW_HEADER}';`);
  });
});

describe('findMarkedCommentId', () => {
  it('finds the id of the bot-authored comment carrying the marker', () => {
    const comments = [
      { id: 1, body: 'an unrelated comment', user: HUMAN_AUTHOR },
      { id: 2, body: `${MARKER}\nprior conductor report`, user: BOT_AUTHOR },
      { id: 3, body: 'another unrelated comment', user: HUMAN_AUTHOR },
    ];
    expect(findMarkedCommentId(comments, MARKER)).toBe(2);
  });

  it('returns null when no comment carries the marker, so a fresh one is created', () => {
    const comments = [{ id: 1, body: 'an unrelated comment', user: HUMAN_AUTHOR }];
    expect(findMarkedCommentId(comments, MARKER)).toBeNull();
  });

  it('returns null on an empty comment list', () => {
    expect(findMarkedCommentId([], MARKER)).toBeNull();
  });

  it('does NOT match a marker planted in a comment authored by a human, so conductor never PATCHes it', () => {
    // On pull_request_target with a write token, anyone who can comment on
    // the pull request can plant the marker in a comment they author before
    // conductor's first run. Matching on the marker alone would then have
    // conductor repeatedly PATCH the attacker's own comment -- which they
    // can edit afterward to display a forged clean report. Requiring the
    // bot identity closes that: a human-authored comment carrying the
    // marker is never matched, so conductor creates its own instead.
    const comments = [
      { id: 1, body: `${MARKER}\nforged clean report`, user: HUMAN_AUTHOR },
    ];
    expect(findMarkedCommentId(comments, MARKER)).toBeNull();
  });

  it('matches a marker in a comment authored by the GitHub Actions bot', () => {
    const comments = [
      { id: 4, body: `${MARKER}\nprior conductor report`, user: BOT_AUTHOR },
    ];
    expect(findMarkedCommentId(comments, MARKER)).toBe(4);
  });

  it('does not match a marked comment with no user field at all', () => {
    const comments = [{ id: 5, body: `${MARKER}\nprior conductor report` }];
    expect(findMarkedCommentId(comments, MARKER)).toBeNull();
  });
});

describe('the gh argument vectors', () => {
  it('lists comments by owner/repo and pull request number', () => {
    expect(listCommentsArgs('acme/widgets', 42)).toEqual([
      'api',
      'repos/acme/widgets/issues/42/comments',
      '--paginate',
    ]);
  });

  it('creates a comment with the body read from a file via -F, never -f', () => {
    // gh's `@<path>` file-read form only works with -F/--field. -f/--raw-field
    // sends the literal string, so `-f body=@/tmp/body.md` would post the
    // literal text "@/tmp/body.md" as the comment body instead of the file's
    // contents.
    const args = createCommentArgs('acme/widgets', 42, '/tmp/body.md');
    expect(args).toEqual(['api', 'repos/acme/widgets/issues/42/comments', '-F', 'body=@/tmp/body.md']);
    expect(args).not.toContain('-f');
    // No element of the argument vector carries report-shaped prose: the only
    // way the body reaches gh is the @-file reference.
    for (const arg of args) {
      expect(arg).not.toContain('conductor:');
    }
  });

  it('updates the existing comment by id, also by file via -F, with PATCH', () => {
    const args = updateCommentArgs('acme/widgets', 2, '/tmp/body.md');
    expect(args).toEqual([
      'api',
      'repos/acme/widgets/issues/comments/2',
      '-X',
      'PATCH',
      '-F',
      'body=@/tmp/body.md',
    ]);
    expect(args).not.toContain('-f');
  });
});

/** A recording stand-in for the one seam that reaches the network. */
function recordingRunner(responses) {
  const calls = [];
  const run = (argv) => {
    calls.push(argv);
    const next = responses.shift();
    if (next === undefined) {
      return { stdout: '{}' };
    }
    if (next instanceof Error) {
      throw next;
    }
    return next;
  };
  return { run, calls };
}

function recordingBodyWriter() {
  const writes = [];
  const writeBodyFile = (body) => {
    const file = `/tmp/conductor-pr-comment-${writes.length}.md`;
    writes.push({ file, body });
    return file;
  };
  return { writeBodyFile, writes };
}

describe('postReport', () => {
  it('creates a new comment when no prior marked comment exists', () => {
    const { run, calls } = recordingRunner([
      { stdout: JSON.stringify([{ id: 1, body: 'unrelated' }]) },
      { stdout: JSON.stringify({ id: 99 }) },
    ]);
    const { writeBodyFile, writes } = recordingBodyWriter();

    const result = postReport({
      run,
      repo: 'acme/widgets',
      pr: 42,
      reportText: 'conductor: clean, nothing blocked. 2 gate(s) ran.',
      writeBodyFile,
    });

    expect(result).toEqual({ posted: true, updated: false, commentId: 99 });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(listCommentsArgs('acme/widgets', 42));
    expect(calls[1]).toEqual(createCommentArgs('acme/widgets', 42, writes[0].file));
    // The report reached gh only through the file the body writer produced.
    expect(writes[0].body).toContain('conductor: clean, nothing blocked. 2 gate(s) ran.');
    expect(writes[0].body.indexOf(MARKER)).toBe(0);
  });

  it('updates the existing marked comment in place instead of creating a second one', () => {
    const { run, calls } = recordingRunner([
      { stdout: JSON.stringify([{ id: 7, body: `${MARKER}\nold report`, user: BOT_AUTHOR }]) },
      { stdout: '{}' },
    ]);
    const { writeBodyFile, writes } = recordingBodyWriter();

    const result = postReport({
      run,
      repo: 'acme/widgets',
      pr: 42,
      reportText: 'conductor: 1 gate blocked.',
      writeBodyFile,
    });

    expect(result).toEqual({ posted: true, updated: true, commentId: 7 });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual(updateCommentArgs('acme/widgets', 7, writes[0].file));
  });

  it('degrades gracefully on a posting failure: warns, never throws, reports posted: false', () => {
    // The shape of a fork pull_request: the default GITHUB_TOKEN is
    // read-only, so `gh api` exits non-zero and this is the one seam that
    // sees it.
    const { run } = recordingRunner([
      new Error('HTTP 403: Resource not accessible by integration'),
    ]);
    const { writeBodyFile } = recordingBodyWriter();

    let thrown = null;
    let result;
    try {
      result = postReport({
        run,
        repo: 'acme/widgets',
        pr: 42,
        reportText: 'conductor: clean, nothing blocked.',
        writeBodyFile,
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeNull();
    expect(result.posted).toBe(false);
    expect(result.warning).toMatch(/could not post/i);
    expect(result.warning).toMatch(/fork/i);
    // The underlying cause is folded in, so a reader is not left guessing.
    expect(result.warning).toContain('403');
  });

  it('also degrades gracefully when the failure happens on the update path', () => {
    const { run } = recordingRunner([
      { stdout: JSON.stringify([{ id: 7, body: `${MARKER}\nold report`, user: BOT_AUTHOR }]) },
      new Error('HTTP 403: Resource not accessible by integration'),
    ]);
    const { writeBodyFile } = recordingBodyWriter();

    const result = postReport({
      run,
      repo: 'acme/widgets',
      pr: 42,
      reportText: 'conductor: clean, nothing blocked.',
      writeBodyFile,
    });

    expect(result.posted).toBe(false);
    expect(result.warning).toMatch(/could not post/i);
  });

  it('creates its own comment rather than adopting a marker an attacker planted in a human comment', () => {
    // pull_request_target hands conductor's step a write token; anyone who
    // can comment on the pull request can author a comment carrying the
    // marker before conductor's own first run. If postReport matched on the
    // marker alone it would PATCH that attacker-authored comment forever
    // after, which the attacker can then edit to show a forged clean
    // report. It must create its own comment instead.
    const { run, calls } = recordingRunner([
      {
        stdout: JSON.stringify([
          { id: 1, body: `${MARKER}\nforged clean report`, user: HUMAN_AUTHOR },
        ]),
      },
      { stdout: JSON.stringify({ id: 99 }) },
    ]);
    const { writeBodyFile } = recordingBodyWriter();

    const result = postReport({
      run,
      repo: 'acme/widgets',
      pr: 42,
      reportText: 'conductor: 1 gate blocked.',
      writeBodyFile,
    });

    expect(result).toEqual({ posted: true, updated: false, commentId: 99 });
    expect(calls[1]).toEqual([
      'api',
      'repos/acme/widgets/issues/42/comments',
      '-F',
      expect.stringMatching(/^body=@/),
    ]);
  });
});
