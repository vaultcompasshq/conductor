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
    expect(script).toMatch(/--stage \$STAGE/);
  });

  it('asks for SARIF into a file the caller can upload', () => {
    expect(script).toMatch(/--format sarif/);
    expect(script).toMatch(/--output/);
  });

  it('exposes that path as an output rather than making the caller guess it', () => {
    expect(action.outputs?.sarif?.value).toContain('inputs.output');
  });

  it('runs the conductor already in the repository, never one it installs', () => {
    // The package is unpublished, so an install step would either fail or
    // silently fetch something else. Failing with a sentence beats both.
    expect(script).toMatch(/node_modules\/\.bin\/conductor/);
    expect(script).not.toMatch(/npm install|pnpm add|npm i |yarn add/);
  });

  it('fails with a message rather than skipping when conductor is not installed', () => {
    expect(script).toMatch(/exit 1/);
    expect(script).toMatch(/devDependency/);
  });

  it('plumbs through the three variables the pull-request flow reads', () => {
    const env = steps.flatMap((step) => Object.keys(step.env ?? {}));
    expect(env).toContain('GITHUB_EVENT_PATH');
    expect(env).toContain('GITHUB_BASE_REF');
    expect(env).toContain('GITHUB_HEAD_REF');
  });

  it('passes --base only when a ref was actually named', () => {
    // github.base_ref is empty outside a pull request, so an unconditional
    // --base would hand the gate the ref "origin/" on every push build and
    // fail it closed for no reason.
    expect(script).toMatch(/if \[ -n "\$BASE_REF" \]/);
  });

  it('takes the exit code from conductor rather than from the last thing in the script', () => {
    expect(script).toMatch(/set -eu/);
  });
});
