// Drift check for the load-bearing hardening in action.yml.
//
// The install suite runs the step and checks what npm was asked. That can
// stay green while the source of the step drifts: a second, weaker copy of
// the version shape, a floor comment that no longer matches the comparison,
// or an install that dropped --ignore-scripts and grew a lookalike later.
// This file reads the workflow text and pins the values themselves.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@jest/globals';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const actionYml = readFileSync(path.join(ROOT, 'action.yml'), 'utf8');

// The shape the sibling scanners use. It appears twice in action.yml: once
// in the comment that names the rule, and once as the SEMVER assignment the
// step actually matches. A third copy, or a quieter edit of either one, is
// the drift this count exists to catch.
const VERSION_SHAPE = String.raw`^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$`;
const VERSION_SHAPE_OCCURRENCES = 2;

describe('action.yml hardening drift check', () => {
  it('keeps the npm signature floor at 10.5.2', () => {
    expect(actionYml).toContain('npm 10.5.2 or newer');
    expect(actionYml).toContain('[ "$NPM_MAJOR" -gt 10 ]');
    expect(actionYml).toContain('[ "$NPM_MAJOR" -eq 10 ]');
    expect(actionYml).toContain('[ "$NPM_MINOR" -gt 5 ]');
    expect(actionYml).toContain('[ "$NPM_MINOR" -eq 5 ]');
    expect(actionYml).toContain('[ "$NPM_PATCH" -ge 2 ]');
  });

  it('keeps the version shape regex, and only at its current count', () => {
    const hits = actionYml.split(VERSION_SHAPE).length - 1;
    expect(hits).toBe(VERSION_SHAPE_OCCURRENCES);
    expect(actionYml).toContain(`SEMVER='${VERSION_SHAPE}'`);
  });

  it('puts the install on PATH only after the signature audit has passed', () => {
    // Audit finding F1 (2026-10-12). The render and post steps run if:
    // always(), so they run after a FAILED install step, and a file command
    // that step wrote before failing is still honoured. Written before the
    // audit, the PATH entry put a package that failed verification ahead of
    // the system's own node, gh and bash in the step that holds the job
    // token. So the write must sit after the audit's failure exit and before
    // verification-ok, which is what later steps are allowed to act on.
    // Scoped to the install step's own script, and trailing comments are
    // stripped as well as whole-line ones. Both matter: searching the whole
    // file means any later line mentioning GITHUB_PATH makes this vacuous,
    // and a whole-line-only filter is defeated by appending
    // `# ... >> "$GITHUB_PATH" ...` to some other line.
    const stepStart = actionYml.indexOf('- name: Install the gates outside the workspace');
    const stepEnd = actionYml.indexOf('- name: Fetch the trust base');
    expect(stepStart).toBeGreaterThan(-1);
    expect(stepEnd).toBeGreaterThan(stepStart);
    const executable = actionYml
      .slice(stepStart, stepEnd)
      .split('\n')
      .map((line) => line.split('#')[0].trim())
      .filter((line) => line.length > 0);
    const pathWrites = executable.filter((line) => line.includes('GITHUB_PATH'));
    const pathIndex = executable.findIndex((line) => line.includes('>> "$GITHUB_PATH"'));
    const lastAuditIndex = executable.reduce(
      (last, line, index) => (line.includes('npm audit signatures') ? index : last),
      -1
    );
    const failExitIndex = executable.findIndex((line) => line === 'exit "$audit_status"');
    const okIndex = executable.findIndex((line) => line.includes("'verification-ok=true\\n'"));
    expect(pathWrites).toHaveLength(1);
    expect(pathIndex).toBeGreaterThan(-1);
    expect(lastAuditIndex).toBeGreaterThan(-1);
    expect(failExitIndex).toBeGreaterThan(lastAuditIndex);
    expect(okIndex).toBeGreaterThan(-1);
    expect(pathIndex).toBeGreaterThan(failExitIndex);
    expect(pathIndex).toBeLessThan(okIndex);
  });

  it('installs with --ignore-scripts and then audits signatures', () => {
    expect(actionYml).toContain('npm install -g --ignore-scripts');
    // The phrase "npm audit signatures" also appears in comments. The pin is
    // the invocation inside the cd subshell, so a comment copy cannot keep
    // this green after the call itself is removed.
    expect(actionYml).toContain('( cd "$npm_config_prefix/lib" && npm audit signatures )');
  });
});
