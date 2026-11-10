// Pure text sanitizers with no dependency on any other module here, so a
// renderer or the gate runner can import them without importing the policy
// diff or anything heavier.

/**
 * Every character outside printable ASCII as a \uXXXX escape (an astral
 * character as its two surrogate escapes), so head-chosen text cannot smuggle
 * a bidi override or a zero-width character into the report. Used for a head
 * policy value (renderValue, src/policy-diff.ts), and for every preview line
 * (cleanPreviewLine, src/gate-runner.ts), whose gate text the head's own
 * control files can choose (audit 2026-10-27, N3).
 */
export function escapeNonAscii(text: string): string {
  return text.replace(/[^\x20-\x7e]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/**
 * ONE FIELD OF A NAMED-FINDING LINE, made safe for the three places such a
 * line is printed: the job log, the step summary and the pull request
 * comment (issue 144). A finding's rule, path, package name and message are
 * all text a pull request can choose, so every one of them goes through
 * here, and nothing else writes a field of those lines.
 *
 * What comes back is one line of printable ASCII, at most `max` characters:
 *
 *  - every character outside printable ASCII is a \uXXXX escape: a newline,
 *    a carriage return and a tab cannot start a second line, and a bidi
 *    override or a zero-width character is visible;
 *  - a backtick, an angle bracket and an ampersand are escaped the same way.
 *    The lines are printed inside a fenced code block, where a backtick run
 *    is the only thing that could end the fence, and no HTML tag, comment or
 *    entity survives outside one either;
 *  - "::" and "##[" are broken up with a space, so a job log reader sees no
 *    workflow command;
 *  - runs of spaces are collapsed and the result is trimmed and cut at `max`
 *    with a "..." marker, escapes counted.
 *
 * NOT escaped: the rest of markdown's punctuation (an underscore, a star, a
 * bracket). A path is full of it, and it is inert inside the fence both
 * consumers print these lines in; they check that for themselves and omit a
 * line holding a backtick or anything unprintable.
 */
export function summaryField(raw: string, max: number): string {
  const flat = escapeNonAscii(raw)
    .replace(/[`<>&]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`)
    .replace(/:(?=:)/g, ': ')
    .replace(/#(?=#\[)/g, '# ')
    .replace(/ {2,}/g, ' ')
    .trim();
  return flat.length > max ? `${flat.slice(0, Math.max(0, max - 3))}...` : flat;
}
