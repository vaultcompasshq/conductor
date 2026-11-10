// The pull-request comment surface: conductor's own TEXT REPORT, posted as a
// pull request comment for an advisory (non-required) run whose findings
// would otherwise live only in a job's exit code and log.
//
// STICKY, not "one comment per run". A hidden HTML-comment marker at the top
// of the body identifies conductor's own comment; a re-run searches for it
// and PATCHes that comment in place rather than adding a new one each push.
//
// FORK-SAFE, not "best effort with a stack trace in the log". On a fork
// pull_request the default GITHUB_TOKEN is read-only, so posting fails.
// postReport() below never throws: a posting failure comes back as
// `{ posted: false, warning }`, so the caller can print the warning and
// continue. The gate's own pass/fail is decided elsewhere (the gates step in
// action.yml) and nothing here can change it.
//
// The report reaches `gh` BY FILE, never interpolated into a command line.
// The report is conductor's own output, but it can carry a finding's text or
// a path out of the scanned repository, and a command line is not a safe
// place for either.

/**
 * The hidden marker that makes the comment findable and sticky. An HTML
 * comment, so it renders as nothing on the pull request itself.
 */
export const MARKER = '<!-- conductor-report: pr-comment -->';

/**
 * Wraps the report in a `text` code fence, so nothing in it renders as
 * active markdown or breaks out of the block conductor's own comment lives
 * in.
 *
 * The report is conductor's own output, not arbitrary input, but it can
 * carry a finding's own text or a path taken from the scanned repository
 * verbatim, and neither is a place this trusts to be free of a literal
 * triple backtick. One is widened with a zero-width space so it cannot close
 * the fence early; nothing about the report's own content is otherwise
 * changed.
 */
export function fenceReport(reportText) {
  const safe = String(reportText).replace(/```/g, '``​`');
  return ['```text', safe, '```'].join('\n');
}

/**
 * The longest report a comment carries, in characters. GitHub refuses a
 * comment body over 65536 characters, and the marker, the heading and the
 * fence take a few of those.
 */
export const COMMENT_LIMIT = 60000;

/**
 * The preview block's header, spelled exactly as src/output-text.ts spells
 * it (a test pins the two together).
 */
export const PREVIEW_HEADER = 'Preview under the proposed rules (does not affect the verdict)';

/**
 * The report cut to fit a comment. Unchanged at or under the limit. Over it,
 * the preview block goes first, because it decides nothing and the primary
 * report above it is the run's answer: everything from the blank line before
 * the preview header is replaced by one line saying it was omitted. Only when
 * that is still over the limit, or there is no preview block, is the report
 * itself cut at the limit, with a note.
 */
export function truncateReport(reportText, limit = COMMENT_LIMIT) {
  const text = String(reportText);
  if (text.length <= limit) {
    return text;
  }
  // The LAST one: the preview is the report's last block and its lines are
  // cleaned to one line each, so a header-shaped line that text from the
  // scanned repository put higher up cannot cut the primary report short.
  const at = text.lastIndexOf(`\n\n${PREVIEW_HEADER}\n`);
  if (at !== -1) {
    const cut =
      text.slice(0, at + 1) +
      `\n(preview under the proposed rules omitted: the report is over ${limit} characters)\n`;
    if (cut.length <= limit) {
      return cut;
    }
  }
  return `${text.slice(0, limit)}\n\n(report truncated at ${limit} characters)`;
}

// THE HEAD BLOCK of a text report, as src/output-text.ts writes it
// (headerLines): the version, the verdict token, the run-level fixed lines,
// one line per gate, then the named findings. The shapes below are the ones
// the gates step in action.yml checks before it copies the same lines to the
// step summary; tests feed what the renderer prints through both.
//
// Everything down to the last per-gate line is a CLOSED SHAPE: conductor's
// own words, numbers, and a version of version characters. A named-finding
// line is not: its fields are text a pull request can choose, escaped and
// capped by conductor (summaryField, src/escape.ts). So the lines here are
// only ever placed inside a code fence, and one holding a backtick or
// anything unprintable is replaced, whatever the report says.
const VERSION = '[0-9A-Za-z.+-]{1,64}';
const VERSION_LINE = new RegExp(`^conductor ${VERSION}$`);
const TOKEN_LINE =
  /^verdict-token: (pass|nothing-checked|could-not-run|(?:advisory-blocked|unenforced-findings|blocked) \([0-9]+\))$/;
const NEW_IN_PR_LINE = /^new in this pull request: [0-9]+ \(vulnerabilities gate; [0-9]+ already on the base\)$/;
const TRUST_BASE_LINE = /^trust-base: (?:refused|not given on a pull-request job), no rules were read and no gate ran$/;
const RUN_LEVEL_LINE = new RegExp(
  '^(?:present-on-base: [0-9]+ reported, not blocking' +
    '|intent-spec: (?:none chosen, two or more specs matched the branch equally' +
    '|none chosen, this branch chose a spec before conductor 0\\.11\\.0' +
    '|a different spec chosen than before conductor 0\\.11\\.0, see the report' +
    '|weak match, see the intent gate in the report)' +
    '|trust-base: (?:refused|not given on a pull-request job), no rules were read and no gate ran' +
    '|new in this pull request: [0-9]+ \\(vulnerabilities gate; [0-9]+ already on the base\\))$'
);
const GATE_REASON =
  'binary-missing|configured-command-missing|spawn-failed|gate-error|unparseable-output|preparation-failed' +
  '|trust-base-unverified|gate-program-refused|gate-version-unsupported|report-missing|history-shallow|timed-out' +
  '|lockfile-emptied|version-skew|version-unverified|lockfile-emptied-unverified|trust base refused';
const GATE_LINE = new RegExp(
  '^gate (?:dependencies|secrets|intent|secrets-history|vulnerabilities) ' +
    `\\((?:dep-guard|vault-guard|intent-guard|gitleaks|osv-scanner)(?: (?:${VERSION}|version unknown))?\\): (?:` +
    'ran, (?:exit [0-9]{1,3}|no exit code), [0-9]{1,6} blocking(?:, checked nothing)?(?:, not enforced)?' +
    `|did not run \\((?:${GATE_REASON})\\)(?:, the action pinned ${VERSION})?(?:, not enforced)?` +
    '|skipped \\((?:deferred to stage (?:commit|push|ci)|no contract|spec waived|spec ambiguous' +
    '|--gate did not name it|head tree equals the base tree)\\)' +
    '|disabled \\(enabled: false\\))$'
);
const FINDINGS_LINE = /^(?:findings): [0-9]{1,7} \([0-9]{1,7} blocking\)(?:, the first [0-9]{1,3})?:$/;
// When nothing blocks, the count line stands alone, without its colon.
const NONE_BLOCKING_LINE = /^(?:findings): [0-9]{1,7} \(0 blocking\)$/;
const FINDING_LINE = /^finding: BLOCKING [ -~]+$/;
const MORE_LINE = /^and [0-9]{1,7} more blocking$/;

/** The most lines of the head block that are read, and the longest one. */
const HEAD_LINES_MAX = 100;
const HEAD_LINE_MAX = 600;
const FINDING_LINES_MAX = 25;

/**
 * The head block of a report, or null when the text does not start with a
 * version line and a verdict-token line in the closed set (the notes the
 * render step writes when conductor could not run, a report from a
 * conductor older than the token, a one-line summary).
 *
 * READ BY POSITION, exactly as the gates step reads it: line 2 is the token,
 * and from line 3 each line is taken only while the whole of it is one of
 * the shapes above. The first line that is not ends the block, so a line
 * further down the report, where a finding's own text can be written to
 * look like any of these, is never lifted out of the fenced report.
 */
export function headBlock(reportText) {
  const lines = String(reportText).split('\n');
  const token = TOKEN_LINE.exec(lines[1] ?? '');
  if (!VERSION_LINE.test(lines[0] ?? '') || token === null) {
    return null;
  }
  const head = { token: token[1], runLevel: [], gates: [], findings: [] };
  let named = 0;
  for (let i = 2; i < lines.length && i < HEAD_LINES_MAX; i += 1) {
    const line = lines[i];
    if (line.length > HEAD_LINE_MAX) {
      break;
    }
    if (head.findings.length > 0) {
      if (line.startsWith('finding: ')) {
        named += 1;
        if (named <= FINDING_LINES_MAX) {
          head.findings.push(
            line.includes('`') || !FINDING_LINE.test(line) ? 'finding: (line omitted: unsafe characters)' : line
          );
        }
        continue;
      }
      if (MORE_LINE.test(line)) {
        head.findings.push(line);
      }
      break;
    }
    if (head.gates.length === 0 && RUN_LEVEL_LINE.test(line)) {
      head.runLevel.push(line);
    } else if (GATE_LINE.test(line)) {
      head.gates.push(line);
    } else if (FINDINGS_LINE.test(line)) {
      head.findings.push(line);
    } else if (NONE_BLOCKING_LINE.test(line)) {
      head.findings.push(line);
      break;
    } else {
      break;
    }
  }
  return head;
}

/**
 * The lines above the collapsed report (issue 102, first cut): the verdict,
 * what this pull request introduced when conductor computed that, the other
 * run-level lines, one row per gate, and the findings by name. Empty for a
 * body with no head block.
 */
function headLines(head) {
  if (head === null) {
    return [];
  }
  const fenced = (lines) => (lines.length === 0 ? [] : ['```text', ...lines, '```', '']);
  return [
    `conductor verdict: ${head.token}`,
    '',
    // Led with, when it is there: it is the line adopters asked to read first.
    ...head.runLevel.filter((line) => NEW_IN_PR_LINE.test(line)).flatMap((line) => [line, '']),
    ...head.runLevel.filter((line) => !NEW_IN_PR_LINE.test(line)).flatMap((line) => [line, '']),
    ...fenced(head.gates),
    ...fenced(head.findings),
  ];
}

/**
 * The full comment body: the marker first, so `findMarkedCommentId` can
 * find it in the body GitHub hands back, then the fenced report, cut to fit
 * a comment by truncateReport.
 *
 * A report with a head block gets the verdict line, one row per gate and the
 * named findings above the report, and the report itself collapsed under
 * them: still whole, still fenced, one click away. Any other body (a note
 * that conductor could not run, a report with no per-gate line) is posted
 * as it always was. The room the
 * head takes comes out of the report's limit, so the body stays under what
 * GitHub accepts.
 */
export function buildCommentBody(reportText, marker = MARKER) {
  const block = headBlock(reportText);
  const head = headLines(block);
  // No gate row, no new layout: a report from a conductor older than the head
  // block has the version and the token and nothing else to lead with, and
  // collapsing it would hide the whole answer behind a bare verdict line.
  if (block === null || block.gates.length === 0) {
    return [marker, '### Conductor report', '', fenceReport(truncateReport(reportText)), ''].join('\n');
  }
  const room = Math.max(1000, COMMENT_LIMIT - head.join('\n').length);
  return [
    marker,
    '### Conductor report',
    '',
    ...head,
    // A run with no trust base is the one whose report IS the answer: why it
    // was refused and what to do, a few lines long. It starts open. Decided
    // by a fixed line of the head block and by nothing the report can word.
    block.runLevel.some((line) => TRUST_BASE_LINE.test(line)) ? '<details open>' : '<details>',
    '<summary>Full report</summary>',
    '',
    fenceReport(truncateReport(reportText, room)),
    '',
    '</details>',
    '',
  ].join('\n');
}

/**
 * The GitHub Actions bot's own identity on a comment the default
 * `GITHUB_TOKEN` posts: `user.login` is `github-actions[bot]` and
 * `user.type` is `Bot`. Both are checked, not just one, so a comment is
 * only ever treated as conductor's own when it carries the exact identity
 * conductor's own posts under.
 *
 * LATENT COUPLING: this literal is correct only because action.yml pins the
 * comment step's `GH_TOKEN` to `${{ github.token }}`, so the step always
 * posts as github-actions[bot] and always matches its own comments. If the
 * step's token is ever made configurable (an App token or a PAT authors
 * comments under a different login), this gate must change in lockstep, or
 * conductor stops recognizing its own comment and creates a new one every
 * run. Keep the two in step.
 */
const BOT_LOGIN = 'github-actions[bot]';

function isPostedByTheActionsBot(comment) {
  const user = comment?.user;
  return user?.type === 'Bot' && user?.login === BOT_LOGIN;
}

/**
 * The id of the comment carrying the marker AND authored by the GitHub
 * Actions bot, or null when no such comment exists.
 *
 * `comments` is the parsed JSON array `gh api .../issues/:pr/comments`
 * returns: each entry at minimum `{ id, body, user: { login, type } }`.
 * Null means "no prior conductor comment on this pull request", which is
 * exactly the signal to create one rather than update one.
 *
 * The bot-identity check matters most on `pull_request_target`, which hands
 * this step a write token even though the pull request itself is
 * untrusted: anyone who can comment on the pull request can plant the
 * marker in a comment THEY author before conductor's first run. Matching on
 * the marker alone would then have conductor repeatedly PATCH the
 * attacker's own comment, which they can edit afterward to display a
 * forged clean report. Requiring the marker AND the bot identity closes
 * that: a marker in a human-authored comment is never matched, so
 * conductor creates its own comment instead, exactly as if no marked
 * comment existed at all.
 */
export function findMarkedCommentId(comments, marker = MARKER) {
  for (const comment of comments ?? []) {
    if (
      typeof comment?.body === 'string' &&
      comment.body.includes(marker) &&
      isPostedByTheActionsBot(comment)
    ) {
      return comment.id;
    }
  }
  return null;
}

/** Every existing comment on the pull request, oldest marked one wins. */
export function listCommentsArgs(repo, pr) {
  return ['api', `repos/${repo}/issues/${pr}/comments`, '--paginate'];
}

/**
 * Creates a new comment. `bodyFile` is a path; `gh api`'s `@file` value form
 * reads the body from it, which is what keeps the report out of the
 * argument vector.
 *
 * -F/--field, deliberately, never -f/--raw-field: gh's `@<path>` file-read
 * form is only recognized by -F. -f sends the value as a literal string, so
 * `-f body=@/tmp/x` would post the literal text "@/tmp/x" as the comment
 * body instead of the file's contents, silently defeating both the report
 * and the marker-based stickiness (the literal path carries no marker, so
 * every run would create a new comment rather than updating one).
 */
export function createCommentArgs(repo, pr, bodyFile) {
  return ['api', `repos/${repo}/issues/${pr}/comments`, '-F', `body=@${bodyFile}`];
}

/** Updates an existing comment in place, also by file, also via -F. */
export function updateCommentArgs(repo, commentId, bodyFile) {
  return ['api', `repos/${repo}/issues/comments/${commentId}`, '-X', 'PATCH', '-F', `body=@${bodyFile}`];
}

/**
 * Posts, or updates, conductor's text report as a pull request comment.
 *
 * `run(argv)` is the one seam that reaches the network: a `gh` argument
 * vector in, `{ stdout }` out, or a throw on failure. The default CLI
 * wrapper (`scripts/pr-comment.mjs`) passes a real `gh` invocation; the test
 * suite passes a recorder, so every case is provable without a network call.
 *
 * `writeBodyFile(body)` writes the comment body somewhere on disk and
 * returns the path, so the report reaches `gh` by file rather than by
 * argument. Injected rather than hardcoded to `node:fs` so a test can assert
 * on exactly what was written without touching a real filesystem.
 *
 * NEVER THROWS. A posting failure -- most commonly the read-only
 * `GITHUB_TOKEN` Actions hands a fork `pull_request`, but also a rate limit
 * or a transient API error -- is exactly the case this exists to degrade
 * gracefully from. The caller gets `{ posted: false, warning }` rather than
 * an exception, and nothing here can fail the action or change the gate's
 * own verdict.
 */
export function postReport({ run, repo, pr, reportText, marker = MARKER, writeBodyFile }) {
  try {
    const bodyFile = writeBodyFile(buildCommentBody(reportText, marker));

    const listed = run(listCommentsArgs(repo, pr));
    const comments = JSON.parse(listed.stdout || '[]');
    const existingId = findMarkedCommentId(comments, marker);

    if (existingId !== null && existingId !== undefined) {
      run(updateCommentArgs(repo, existingId, bodyFile));
      return { posted: true, updated: true, commentId: existingId };
    }

    const created = run(createCommentArgs(repo, pr, bodyFile));
    let commentId = null;
    try {
      const parsed = JSON.parse(created.stdout || '{}');
      commentId = typeof parsed?.id === 'number' ? parsed.id : null;
    } catch {
      // gh's own stdout on a successful create is JSON; if it were not, the
      // comment still posted and the id is just not worth failing over.
      commentId = null;
    }
    return { posted: true, updated: false, commentId };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      posted: false,
      warning:
        'conductor: could not post the report as a pull request comment (no write token, ' +
        'likely a fork pull request, or the GitHub API was unreachable). The gate\'s own ' +
        `verdict is unaffected. (${detail})`,
    };
  }
}
