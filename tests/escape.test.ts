// summaryField: the ONE function every pull-request-controlled field goes
// through on its way to a named-finding line (issue 144). Those lines reach
// the job log, the step summary and the pull request comment, and the last
// two render markdown, so each class of injection has a case here.

import { describe, expect, it } from '@jest/globals';

import { summaryField } from '../src/escape.js';

describe('summaryField', () => {
  it('leaves an ordinary path, package name and sentence as they were', () => {
    expect(summaryField('src/app_main/index.test.ts:12', 160)).toBe('src/app_main/index.test.ts:12');
    expect(summaryField('@scope/left-pad@1.3.0 (packages/web/package.json)', 160)).toBe(
      '@scope/left-pad@1.3.0 (packages/web/package.json)'
    );
    expect(summaryField("Possible secret of type 'github-token'", 160)).toBe("Possible secret of type 'github-token'");
  });

  it('never returns a newline, a carriage return, a tab or any other control character', () => {
    const out = summaryField('a\nb\rc\td\u0000e\u001b[31mf\u007fg\u0085h i j', 400);
    expect(out).toMatch(/^[\x20-\x7e]*$/);
    expect(out.split('\n')).toHaveLength(1);
    expect(out).toContain('a\\u000ab\\u000dc\\u0009d');
  });

  it('never returns a backtick, so the field cannot close the code fence it is printed in', () => {
    const out = summaryField('x\n```\n# heading\n```js\n`inline`', 400);
    expect(out).not.toContain('`');
    expect(out).toContain('\\u0060\\u0060\\u0060');
  });

  it('never returns an angle bracket or an ampersand, so no HTML tag, comment or entity survives', () => {
    const out = summaryField('<img src=x onerror=alert(1)></details><!-- conductor-report: pr-comment -->&lt;b&gt;', 400);
    expect(out).not.toMatch(/[<>&]/);
    expect(out).toContain('\\u003cimg src=x');
  });

  it('breaks up workflow commands, in both spellings', () => {
    for (const raw of ['::error::x', '::set-output name=a::b', ':::warning:::y', '##[error]z', '###[group]w']) {
      const out = summaryField(raw, 400);
      expect([raw, out.includes('::')]).toEqual([raw, false]);
      expect([raw, out.includes('##[')]).toEqual([raw, false]);
    }
  });

  it('escapes everything outside ASCII, a bidi override and a zero-width character included', () => {
    const out = summaryField('safe‮gpj.exe​é😀', 400);
    expect(out).toBe('safe\\u202egpj.exe\\u200b\\u00e9\\ud83d\\ude00');
  });

  it('collapses runs of spaces and trims, so a field cannot pad a line into another shape', () => {
    expect(summaryField('   a     b   ', 400)).toBe('a b');
  });

  it('caps the result, counting the escapes, and marks the cut', () => {
    const out = summaryField('`'.repeat(500), 60);
    expect(out.length).toBe(60);
    expect(out.endsWith('...')).toBe(true);
    expect(summaryField('x'.repeat(60), 60)).toBe('x'.repeat(60));
    expect(summaryField('x'.repeat(61), 60)).toBe(`${'x'.repeat(57)}...`);
  });

  it('returns its own output unchanged', () => {
    const once = summaryField('a`b<c>\n::d', 400);
    expect(summaryField(once, 400)).toBe(once);
  });
});
