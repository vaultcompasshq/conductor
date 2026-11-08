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
