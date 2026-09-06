// The composite Action, read as a file rather than trusted as prose.
//
// Nothing in CI type-checks a workflow file, and a broken one fails on
// somebody else's pull request rather than on this repository's suite. So
// the action is parsed here and the command line it builds is asserted, the
// same way every other command line in this package is.

import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

interface ActionFile {
  name?: string;
  description?: string;
  inputs?: Record<string, { default?: string; description?: string; required?: boolean }>;
  outputs?: Record<string, { value?: string; description?: string }>;
  runs?: {
    using?: string;
    steps?: Array<{
      name?: string;
      shell?: string;
      run?: string;
      env?: Record<string, string>;
      id?: string;
    }>;
  };
}

const action = parseYaml(readFileSync(path.join(ROOT, 'action.yml'), 'utf8')) as ActionFile;

const steps = action.runs?.steps ?? [];
const script = steps.map((step) => step.run ?? '').join('\n');

// Each step's own script, by id. Not "the step mentioning conductor": the
// guard step names the same binary as the gates step, so a search like that
// returns the wrong one and proves nothing about the one under test.
//
// `script` (every step joined) is for claims that are genuinely about the
// whole file, such as "no step installs anything". A claim about what the
// gates are RUN with belongs to gatesScript, or it passes on a line in
// another step that happens to look similar.
const gatesScript = steps.find((step) => step.id === 'gates')?.run ?? '';
const guardScript = steps.find((step) => step.id !== 'gates')?.run ?? '';

describe('action.yml', () => {
  it('is a composite action, so it adds no container and no second runner', () => {
    expect(action.runs?.using).toBe('composite');
  });

  it('gives every step an explicit shell, which composite steps require', () => {
    expect(steps.length).toBeGreaterThan(0);
    for (const step of steps) {
      expect(step.shell).toBe('bash');
    }
  });

  it('runs the ci stage by default, so every enabled gate runs', () => {
    expect(action.inputs?.stage?.default).toBe('ci');
    expect(gatesScript).toMatch(/--stage "\$STAGE"/);
  });

  it('asks for SARIF into a file the caller can upload', () => {
    expect(gatesScript).toMatch(/--format sarif/);
    expect(gatesScript).toMatch(/--output/);
  });

  it('exposes that path as an output rather than making the caller guess it', () => {
    expect(action.outputs?.sarif).toBeDefined();
    expect(action.outputs?.sarif?.value).toContain('outputs.sarif');
  });

  it('runs the conductor already in the repository, never one it installs', () => {
    // The package is unpublished, so an install step would either fail or
    // silently fetch something else. Failing with a sentence beats both.
    expect(script).toMatch(/node_modules\/\.bin\/conductor/);
    expect(script).not.toMatch(/npm install|pnpm add|npm i |yarn add/);
  });

  it('fails with a message rather than skipping when conductor is not installed', () => {
    expect(guardScript).toMatch(/exit 1/);
    expect(guardScript).toMatch(/devDependency/);
  });

  it('plumbs through the three variables the pull-request flow reads', () => {
    const env = steps.flatMap((step) => Object.keys(step.env ?? {}));
    expect(env).toContain('GITHUB_EVENT_PATH');
    expect(env).toContain('GITHUB_BASE_REF');
    expect(env).toContain('GITHUB_HEAD_REF');
  });

  it('passes --base only when a ref was actually named', () => {
    // The base-ref input, not github.base_ref: left empty, the umbrella reads
    // GITHUB_BASE_REF itself and treats an empty value as "not a pull
    // request". Passing --base unconditionally would hand it the literal ref
    // "origin/" on every push build and fail it closed for no reason.
    expect(gatesScript).toMatch(/if \[ -n "\$BASE_REF" \]/);
  });

  it('takes the exit code from conductor rather than from the last thing in the script', () => {
    expect(gatesScript).toMatch(/set -eu/);
  });

  it('builds its arguments as an array and expands it quoted', () => {
    // A string built with += and expanded bare is word-split and then
    // glob-expanded by the shell. An output or spec input containing a space
    // becomes two arguments, and one containing a bracket or a star is
    // matched against the workspace, so the gate is handed whatever happens
    // to be checked out.
    expect(gatesScript).toMatch(/ARGS=\(/);
    expect(gatesScript).toMatch(/"\$\{ARGS\[@\]\}"/);
    expect(gatesScript).not.toMatch(/conductor \$ARGS/);
    expect(gatesScript).not.toMatch(/ARGS="\$ARGS/);
  });

  it('quotes every input it puts into the argument list', () => {
    // Only the lines that build or run the argument list: those are where an
    // unquoted expansion changes what the gate is asked to do.
    const argumentLines = gatesScript
      .split('\n')
      .filter((line) => line.includes('ARGS'))
      .join('\n');

    for (const name of ['BASE_REF', 'TRUST_BASE', 'SPEC', 'STAGE', 'OUTPUT']) {
      const quoted = new RegExp(`"\\$${name}"`, 'g');
      expect(argumentLines.replace(quoted, '')).not.toContain(`$${name}`);
    }
  });

  it('reports the SARIF path relative to the workspace, not to the working directory', () => {
    // A caller whose checkout is in a subdirectory otherwise gets a path that
    // does not resolve from where the upload step runs.
    expect(action.outputs?.sarif?.value).toMatch(/steps\./);
    expect(gatesScript).toMatch(/GITHUB_OUTPUT/);
    expect(gatesScript).toMatch(/WORKDIR/);
  });

  it('publishes that path before running the gates, so a failed run still has one', () => {
    // The log is most worth uploading on the run that failed, and the
    // caller's upload step is the one with if: always() on it.
    expect(gatesScript.indexOf('GITHUB_OUTPUT')).toBeGreaterThan(-1);
    expect(gatesScript.indexOf('GITHUB_OUTPUT')).toBeLessThan(
      gatesScript.indexOf('"${ARGS[@]}"')
    );
  });
});

/**
 * Pull-request mode, as the action enters it.
 *
 * Nothing in CI type-checks a workflow file, so the shape of the command line
 * this builds is asserted here or nowhere. The one that would be silent is
 * passing a SHA: a run with `--trust-base ${{ github.sha }}` reports
 * pull-request mode as on while every rule still comes from the tree being
 * judged. The umbrella refuses that, but the action must not produce it.
 */
describe('action.yml enters pull-request mode', () => {
  it('passes origin/GITHUB_BASE_REF when the event set one', () => {
    expect(gatesScript).toMatch(/--trust-base "origin\/\$GITHUB_BASE_REF"/);
  });

  it('passes nothing when GITHUB_BASE_REF is empty, which is every push build', () => {
    // Actions defines the variable and leaves it EMPTY outside a pull
    // request, so an unconditional pass would hand every push the literal
    // ref "origin/" and fail it closed for no reason.
    expect(gatesScript).toMatch(/elif \[ -n "\$\{GITHUB_BASE_REF:-\}" \]/);
  });

  it('never builds the ref out of a commit SHA', () => {
    // github.sha on a pull_request event IS the merge commit, which is HEAD,
    // and head.sha is a different commit carrying HEAD's tree whenever the
    // base has not moved. Either one puts the rules back in the tree being
    // judged.
    // Comment lines are stripped first: the comment in the action explains
    // why neither SHA is used, and a rule that fired on the explanation would
    // push the explanation out of the file.
    const code = [
      ...steps.flatMap((step) => Object.values(step.env ?? {})),
      ...script.split('\n').filter((line) => !line.trim().startsWith('#')),
    ].join('\n');

    expect(code).not.toMatch(/github\.sha/);
    expect(code).not.toMatch(/head\.sha/);
  });

  it('reads every value from the environment rather than expanding it into the script', () => {
    // An expression expanded inside a run block is pasted in as source text
    // before the shell sees it, so a value carrying a quote rewrites the
    // script. The trust base decides where the rules come from, which makes
    // it the worst possible place for that.
    const env = steps.flatMap((step) => Object.keys(step.env ?? {}));
    expect(env).toContain('TRUST_BASE');
    expect(gatesScript).not.toMatch(/\$\{\{/);
  });

  it('lets a caller name the ref explicitly', () => {
    expect(action.inputs?.['trust-base']).toBeDefined();
    expect(action.inputs?.['trust-base']?.default).toBe('');
    expect(gatesScript).toMatch(/if \[ -n "\$TRUST_BASE" \]/);
  });

  it('offers no value that switches pull-request mode off', () => {
    // Base-ref judging is the floor, not a knob. On a pull_request event the
    // workflow file itself runs from the pull request's own ref, so an
    // opt-out input would be settable by the pull request the mode exists to
    // judge: the knob and the thing it protects against are the same file.
    expect(gatesScript).not.toMatch(/"\$TRUST_BASE" = "off"/);
    expect(String(action.inputs?.['trust-base']?.description)).toMatch(
      /no value that turns pull-request mode off/
    );
  });
});
